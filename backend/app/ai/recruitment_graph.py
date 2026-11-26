import json
import logging
from typing import Any, Dict, List, Optional, TypedDict

from langgraph.graph import END, StateGraph

from app.ai.llm import (
    COMMUNICATOR_PROMPT,
    SCHEDULER_PROMPT,
    SCREENER_PROMPT,
    get_llm,
)
from app.ai.vector_store import ingest_resumes_to_pgvector, search_resumes_pgvector
from app.db import get_supabase

logger = logging.getLogger(__name__)


class HRState(TypedDict, total=False):
    """Typed state flowing through the 4-node HITL recruitment LangGraph."""

    job_id: str
    job_title: str
    job_description: str
    required_skills: str
    experience_years: int
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
    if not state.get("ingested_docs"):
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

    ingested_docs = state.get("ingested_docs", [])
    storage_by_file = {doc.get("filename", ""): doc.get("storage_path", "") for doc in ingested_docs}
    storage_by_email = {
        doc.get("email", "").lower(): doc.get("storage_path", "")
        for doc in ingested_docs
        if doc.get("email")
    }

    try:
        llm = get_llm(temperature=0.1)
        messages = SCREENER_PROMPT.format_messages(
            job_title=job_title,
            job_description=job_description,
            required_skills=required_skills,
            experience_years=experience_years,
            resume_chunks=resume_text,
        )
        response = llm.invoke(messages)
        shortlisted = _parse_json_from_llm(str(response.content))

        # Filter match_score >= 40 and deduplicate case-insensitively by name/email
        seen: dict[str, dict[str, Any]] = {}
        for candidate in shortlisted:
            score = float(candidate.get("match_score", 0) or 0)
            if score < 40:
                continue
            name = str(candidate.get("name") or "Unknown").strip()
            source_file = candidate.get("source_file", "")
            email = str(candidate.get("email", "") or "").strip().lower()
            candidate["resume_storage_path"] = (
                storage_by_file.get(source_file)
                or storage_by_email.get(email)
                or ""
            )
            dedup_key = name.lower() if name else email
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
        llm = get_llm(temperature=0.3)
        messages = SCHEDULER_PROMPT.format_messages(
            candidates_json=json.dumps(shortlisted, indent=2),
        )
        response = llm.invoke(messages)
        scheduled = _parse_json_from_llm(str(response.content))

        slot_by_name = {
            str(s.get("name", "") or "").strip().lower(): s.get("interview_slot", "")
            for s in scheduled
            if s.get("name")
        }
        slot_by_email = {
            str(s.get("email", "") or "").strip().lower(): s.get("interview_slot", "")
            for s in scheduled
            if s.get("email")
        }
        for candidate in shortlisted:
            cname = str(candidate.get("name", "") or "").strip().lower()
            cemail = str(candidate.get("email", "") or "").strip().lower()
            slot = slot_by_name.get(cname) or slot_by_email.get(cemail) or "TBD"
            candidate["interview_slot"] = slot

        return {"scheduled_candidates": shortlisted, "error": None}
    except Exception as exc:
        logger.exception("Scheduling failed")
        for candidate in shortlisted:
            candidate["interview_slot"] = "TBD"
        return {"scheduled_candidates": shortlisted, "error": f"Scheduling error: {exc}"}


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
        llm = get_llm(temperature=0.4)
        messages = COMMUNICATOR_PROMPT.format_messages(
            job_title=job_title,
            scheduled_json=json.dumps(scheduled, indent=2),
        )
        response = llm.invoke(messages)
        drafts = _parse_json_from_llm(str(response.content))
        return {"email_drafts": drafts, "error": None}
    except Exception as exc:
        logger.exception("Email drafting failed")
        return {"email_drafts": [], "error": f"Email drafting error: {exc}"}


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
