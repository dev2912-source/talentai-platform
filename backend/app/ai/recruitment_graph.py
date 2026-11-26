from datetime import datetime, timedelta, timezone
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from app.ai.llm import (
    COMMUNICATOR_PROMPT,
    NvidiaNIMChatClient,
    SCHEDULER_PROMPT,
    SCREENER_PROMPT,
    get_llm,
)
from app.ai.vector_store import ingest_resumes_to_pgvector, search_resumes_pgvector
from app.config import get_settings
from app.db import get_supabase

logger = logging.getLogger(__name__)

_SENTINEL_CANDIDATE_NAMES = {"", "unknown", "unknown candidate"}


class HRState(TypedDict, total=False):
    """Typed state flowing through the 4-node HITL recruitment LangGraph."""

    job_id: str
    job_title: str
    job_description: str
    required_skills: str
    experience_years: int
    min_score: float
    uploaded_files: List[Dict[str, Any]]
    supabase: Any

    ingested_docs: List[Dict[str, Any]]
    retrieved_chunks: List[Dict[str, Any]]
    shortlisted_candidates: List[Dict[str, Any]]
    scheduled_candidates: List[Dict[str, Any]]
    email_drafts: List[Dict[str, Any]]
    error: Optional[str]


def _parse_json_from_llm(text: str) -> list[dict[str, Any]]:
    """Robustly parse a JSON array from LLM output that may include markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        first_newline = cleaned.index("\n") if "\n" in cleaned else 3
        cleaned = cleaned[first_newline + 1 :]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        direct = json.loads(cleaned)
        if isinstance(direct, list):
            return direct
        if isinstance(direct, dict):
            for key in ("candidates", "shortlisted", "shortlisted_candidates", "results", "data"):
                if isinstance(direct.get(key), list):
                    return direct[key]
    except json.JSONDecodeError:
        pass

    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start != -1 and end != -1 and end > start:
        json_str = cleaned[start : end + 1]
        try:
            parsed = json.loads(json_str)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError as exc:
            logger.error("JSON decode error: %s\nRaw: %s", exc, json_str[:500])
            return []
    logger.warning("No JSON array found in LLM output: %s", cleaned[:300])
    return []


def _parse_score(raw_score: Any) -> float:
    """Safely parse match_score values like 85, '85%', '85/100', or 85.5."""
    if raw_score is None or isinstance(raw_score, bool):
        return 0.0
    if isinstance(raw_score, (int, float)):
        return max(0.0, min(100.0, float(raw_score)))
    match = re.search(r"(\d+(?:\.\d+)?)", str(raw_score))
    if not match:
        return 0.0
    return max(0.0, min(100.0, float(match.group(1))))


def _format_skills(raw_skills: Any) -> str:
    """Normalize matched_skills whether the LLM returns a list or string."""
    if isinstance(raw_skills, list):
        return ", ".join(str(s).strip() for s in raw_skills if str(s).strip())
    return str(raw_skills or "").strip()


def _is_rate_limit_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "rate-limit" in msg or "rate limit" in msg or "timed out" in msg


def _invoke_llm_resilient(messages: Any, temperature: float) -> Any:
    """Invoke configured NVIDIA NIM LLM, retrying once or falling back on HTTP 429/timeout."""
    llm = get_llm(temperature=temperature)
    try:
        return llm.invoke(messages)
    except Exception as exc:
        if not _is_rate_limit_error(exc):
            raise
        logger.warning("LLM transient error, retrying after short delay: %s", exc)
        time.sleep(1.5)
        try:
            return llm.invoke(messages)
        except Exception as retry_exc:
            if not _is_rate_limit_error(retry_exc):
                raise
            settings = get_settings()
            if not settings.NVIDIA_API_KEY:
                raise
            logger.warning("Falling back to nvidia/nemotron-3.5-lightning-30b-a3b.")
            fallback_llm = NvidiaNIMChatClient(
                api_key=settings.NVIDIA_API_KEY,
                base_url=settings.NVIDIA_BASE_URL,
                model="nvidia/nemotron-3.5-lightning-30b-a3b",
                temperature=temperature,
                max_tokens=2048,
            )
            return fallback_llm.invoke(messages)


def _fallback_interview_slot(index: int) -> str:
    """Generate a deterministic 45-minute weekday interview slot starting next business day."""
    day = datetime.now(timezone.utc) + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    slot_dt = day.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(minutes=45 * index)
    return slot_dt.strftime("%A, %B %d, %Y at %I:%M %p UTC")


def _fallback_email_draft(candidate: dict[str, Any], job_title: str) -> dict[str, str]:
    """Generate a clean personalized interview invitation email when LLM drafting is unavailable."""
    name = str(candidate.get("name") or "Candidate").strip()
    slot = str(candidate.get("interview_slot") or "TBD").strip()
    skills = _format_skills(candidate.get("matched_skills"))
    skills_line = f" with your experience in {skills}" if skills else ""
    return {
        "name": name,
        "email": str(candidate.get("email") or ""),
        "subject": f"Interview Invitation — {job_title}",
        "body": (
            f"Dear {name},\n\n"
            f"Congratulations! We were impressed by your background{skills_line} and would like to invite you "
            f"to interview for the {job_title} position.\n\n"
            f"Proposed Interview Slot: {slot}\n\n"
            f"Please reply to confirm your availability for this time.\n\n"
            f"Best regards,\nTalentAI Hiring Team"
        ),
    }


def _resolve_supabase(state: HRState) -> Any:
    return state.get("supabase") or get_supabase()


def ingest_resumes(state: HRState) -> dict[str, Any]:
    """Node 1: Extract text from uploaded files, embed, and store in pgvector."""
    logger.info("▶ Node: ingest_resumes")
    files = state.get("uploaded_files", [])
    job_id = state.get("job_id", "")

    if not files:
        return {"error": "No files uploaded.", "ingested_docs": []}

    try:
        ingested = ingest_resumes_to_pgvector(_resolve_supabase(state), job_id=job_id, files=files)
        return {"ingested_docs": ingested, "error": None}
    except Exception as exc:
        logger.exception("Ingestion failed")
        return {"error": f"Ingestion error: {exc}", "ingested_docs": []}


def screen_candidates(state: HRState) -> dict[str, Any]:
    """Node 2: Query pgvector chunks and invoke Screener Agent to shortlist (score >= 40)."""
    logger.info("▶ Node: screen_candidates")
    if state.get("error"):
        return {
            "shortlisted_candidates": [],
            "retrieved_chunks": [],
            "error": state["error"],
        }
    ingested_docs = state.get("ingested_docs") or []
    if not ingested_docs:
        return {
            "shortlisted_candidates": [],
            "retrieved_chunks": [],
            "error": "No resume text could be extracted from the uploaded files.",
        }

    job_id = state.get("job_id", "")
    job_title = state.get("job_title", "")
    job_description = state.get("job_description", "")
    required_skills = state.get("required_skills", "")
    experience_years = state.get("experience_years", 0)

    query = f"{job_title} {job_description} {required_skills}"
    chunks = search_resumes_pgvector(_resolve_supabase(state), query=query, job_id=job_id, match_count=30)

    if not chunks:
        # Synthesize chunks directly from ingested_docs so screening never fails on empty RPC results
        chunks = [
            {
                "document": str(doc.get("full_text", ""))[:2400],
                "metadata": {
                    "source_file": doc.get("filename", "N/A"),
                    "candidate_name": doc.get("name", "N/A"),
                    "candidate_email": doc.get("email", "N/A"),
                    "job_id": job_id,
                },
                "similarity": 1.0,
            }
            for doc in ingested_docs
            if doc.get("full_text")
        ]

    if not chunks:
        return {
            "shortlisted_candidates": [],
            "retrieved_chunks": [],
            "error": "No matching resume chunks found in the vector store.",
        }

    formatted_chunks = []
    for i, chunk in enumerate(chunks):
        meta = chunk.get("metadata", {})
        formatted_chunks.append(
            f"--- Resume Chunk {i + 1} (source: {meta.get('source_file', 'N/A')}, "
            f"candidate: {meta.get('candidate_name', 'N/A')}, "
            f"email: {meta.get('candidate_email', 'N/A')}) ---\n"
            f"{chunk['document']}\n"
        )
    resume_text = "\n".join(formatted_chunks)

    storage_by_file = {doc.get("filename", ""): doc.get("storage_path", "") for doc in ingested_docs}
    storage_by_email = {
        doc.get("email", "").lower(): doc.get("storage_path", "")
        for doc in ingested_docs
        if doc.get("email")
    }

    try:
        messages = SCREENER_PROMPT.format_messages(
            job_title=job_title,
            job_description=job_description,
            required_skills=required_skills,
            experience_years=experience_years,
            resume_chunks=resume_text,
        )
        response = _invoke_llm_resilient(messages, temperature=0.1)
        shortlisted = _parse_json_from_llm(str(response.content))

        # Filter match_score >= min_score (default 40) and deduplicate by email first, else non-sentinel name + source_file
        raw_min = state.get("min_score")
        min_threshold = max(0.0, min(100.0, float(raw_min if raw_min is not None else 40.0)))
        seen: dict[str, dict[str, Any]] = {}
        for candidate in shortlisted:
            if not isinstance(candidate, dict):
                continue
            score = _parse_score(candidate.get("match_score"))
            if score < min_threshold:
                continue
            candidate["match_score"] = score
            candidate["matched_skills"] = _format_skills(candidate.get("matched_skills"))
            raw_name = str(candidate.get("name") or "").strip()
            name_lower = raw_name.lower()
            clean_name = "" if name_lower in _SENTINEL_CANDIDATE_NAMES else name_lower
            source_file = str(candidate.get("source_file") or "").strip()
            email = str(candidate.get("email") or "").strip().lower()
            candidate["resume_storage_path"] = (
                storage_by_file.get(source_file)
                or storage_by_email.get(email)
                or ""
            )
            dedup_key = email if email else f"{clean_name}|{source_file.lower()}"
            if dedup_key not in seen or score > float(seen[dedup_key].get("match_score", 0) or 0):
                seen[dedup_key] = candidate

        return {
            "shortlisted_candidates": list(seen.values()),
            "retrieved_chunks": chunks,
            "error": None,
        }
    except Exception as exc:
        logger.exception("Screening failed")
        return {
            "shortlisted_candidates": [],
            "retrieved_chunks": chunks,
            "error": f"Screening error: {exc}",
        }


def schedule_interviews(state: HRState) -> dict[str, Any]:
    """Node 3: Assign 45-minute weekday interview slots to shortlisted candidates."""
    logger.info("▶ Node: schedule_interviews")
    if state.get("error"):
        return {"scheduled_candidates": [], "error": state["error"]}

    shortlisted = [dict(c) for c in state.get("shortlisted_candidates", [])]
    if not shortlisted:
        return {"scheduled_candidates": [], "error": None}

    try:
        messages = SCHEDULER_PROMPT.format_messages(
            candidates_json=json.dumps(shortlisted, indent=2),
        )
        response = _invoke_llm_resilient(messages, temperature=0.3)
        scheduled = _parse_json_from_llm(str(response.content))

        slot_by_name = {
            cname: s.get("interview_slot", "")
            for s in scheduled
            if isinstance(s, dict)
            and (cname := str(s.get("name", "") or "").strip().lower()) not in _SENTINEL_CANDIDATE_NAMES
        }
        slot_by_email = {
            cemail: s.get("interview_slot", "")
            for s in scheduled
            if isinstance(s, dict)
            and (cemail := str(s.get("email", "") or "").strip().lower())
        }
        for idx, candidate in enumerate(shortlisted):
            cname = str(candidate.get("name", "") or "").strip().lower()
            cemail = str(candidate.get("email", "") or "").strip().lower()
            slot = (
                slot_by_email.get(cemail)
                or (slot_by_name.get(cname) if cname not in _SENTINEL_CANDIDATE_NAMES else None)
                or _fallback_interview_slot(idx)
            )
            candidate["interview_slot"] = slot

        return {"scheduled_candidates": shortlisted, "error": None}
    except Exception as exc:
        logger.warning("Scheduling LLM failed, using deterministic slot fallback: %s", exc)
        for idx, candidate in enumerate(shortlisted):
            candidate["interview_slot"] = _fallback_interview_slot(idx)
        return {"scheduled_candidates": shortlisted, "error": None}


def draft_emails(state: HRState) -> dict[str, Any]:
    """Node 4: Draft personalized interview invitation emails for HITL review."""
    logger.info("▶ Node: draft_emails")
    if state.get("error"):
        return {"email_drafts": [], "error": state["error"]}

    scheduled = state.get("scheduled_candidates", [])
    job_title = state.get("job_title", "")

    if not scheduled:
        return {"email_drafts": [], "error": None}

    try:
        messages = COMMUNICATOR_PROMPT.format_messages(
            job_title=job_title,
            scheduled_json=json.dumps(scheduled, indent=2),
        )
        response = _invoke_llm_resilient(messages, temperature=0.4)
        drafts = _parse_json_from_llm(str(response.content))
        if not drafts:
            drafts = [_fallback_email_draft(c, job_title) for c in scheduled]
        return {"email_drafts": drafts, "error": None}
    except Exception as exc:
        logger.warning("Email drafting LLM failed, using template fallback: %s", exc)
        drafts = [_fallback_email_draft(c, job_title) for c in scheduled]
        return {"email_drafts": drafts, "error": None}


def build_recruitment_graph():
    """Construct and compile the 4-node HITL recruitment screening LangGraph."""
    graph = StateGraph(HRState)

    graph.add_node("ingest_resumes", ingest_resumes)
    graph.add_node("screen_candidates", screen_candidates)
    graph.add_node("schedule_interviews", schedule_interviews)
    graph.add_node("draft_emails", draft_emails)

    graph.set_entry_point("ingest_resumes")
    graph.add_edge("ingest_resumes", "screen_candidates")
    graph.add_edge("screen_candidates", "schedule_interviews")
    graph.add_edge("schedule_interviews", "draft_emails")
    graph.add_edge("draft_emails", END)

    return graph.compile()


recruitment_screen_graph = build_recruitment_graph()
