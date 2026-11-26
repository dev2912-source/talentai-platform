import asyncio
from datetime import datetime, timezone
import logging
import os
import re
from typing import Any
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from supabase import Client

from app.ai.recruitment_graph import recruitment_screen_graph
from app.db import get_supabase
from app.deps import CurrentUser, require_hr
from app.models.schemas import (
    ApproveJobRequest,
    ApproveJobResponse,
    CandidateOut,
    JobDetailResponse,
    JobPostingOut,
    JobPostingSummaryOut,
    ScreenJobResponse,
)
from app.services.email import send_interview_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/recruitment", tags=["recruitment"])

ALLOWED_RESUME_EXTENSIONS = {".pdf", ".docx", ".txt"}
MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024
_SENTINEL_CANDIDATE_NAMES = {"", "unknown", "unknown candidate"}


def _safe_filename(filename: str | None) -> str:
    base = os.path.basename((filename or "").strip())
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", base).lstrip(".")
    return sanitized or "resume.txt"


def _match_draft(candidate: dict[str, Any], drafts: list[dict[str, Any]]) -> dict[str, Any]:
    email = str(candidate.get("email", "") or "").strip().lower()
    if email:
        for draft in drafts:
            if str(draft.get("email", "") or "").strip().lower() == email:
                return draft

    name = str(candidate.get("name", "") or "").strip().lower()
    if name not in _SENTINEL_CANDIDATE_NAMES:
        for draft in drafts:
            if str(draft.get("name", "") or "").strip().lower() == name:
                return draft
    return {}


@router.get("/jobs", response_model=list[JobPostingSummaryOut])
def list_jobs(
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> list[JobPostingSummaryOut]:
    """List recent job postings with their candidate counts."""
    jobs_res = (
        supabase.table("job_postings")
        .select("*")
        .order("created_at", desc=True)
        .limit(25)
        .execute()
    )
    jobs = getattr(jobs_res, "data", None) or []
    if not jobs:
        return []

    job_ids = [str(j["id"]) for j in jobs]
    cands_res = supabase.table("candidates").select("id, job_id").in_("job_id", job_ids).execute()
    cands = getattr(cands_res, "data", None) or []
    counts: dict[str, int] = {}
    for row in cands:
        jid = str(row.get("job_id", ""))
        counts[jid] = counts.get(jid, 0) + 1

    return [
        JobPostingSummaryOut(
            **job,
            candidate_count=counts.get(str(job["id"]), 0),
        )
        for job in jobs
    ]


@router.post("/screen", response_model=ScreenJobResponse)
async def screen_resumes(
    title: str = Form(...),
    department: str = Form("Engineering"),
    description: str = Form(...),
    required_skills: str = Form("Not specified"),
    experience_years: int = Form(0),
    resumes: list[UploadFile] = File(...),
    current_user: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> ScreenJobResponse:
    """Upload resumes to Supabase Storage, run 4-node LangGraph, and pause for HITL approval."""
    if not title.strip() or not description.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job title and description are required.",
        )

    staged_files: list[dict[str, Any]] = []
    for upload in resumes:
        orig_name = (upload.filename or "").strip()
        ext = os.path.splitext(orig_name)[1].lower()
        if ext not in ALLOWED_RESUME_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file format for '{orig_name or 'unnamed'}'. Allowed types: .pdf, .docx, .txt.",
            )
        raw_bytes = await upload.read()
        if len(raw_bytes) > MAX_RESUME_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File '{orig_name}' exceeds the 10 MB maximum file size.",
            )
        if not raw_bytes:
            continue
        safe_name = _safe_filename(orig_name)
        staged_files.append({
            "filename": safe_name,
            "content": raw_bytes,
            "content_type": upload.content_type or "application/octet-stream",
        })

    if not staged_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload at least one non-empty resume (PDF, DOCX, or TXT).",
        )

    uploaded_files: list[dict[str, Any]] = []
    job_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()

    for staged in staged_files:
        storage_path = f"{job_id}/{uuid.uuid4().hex[:8]}_{staged['filename']}"
        supabase.storage.from_("hr-uploads").upload(
            storage_path,
            staged["content"],
            {"content-type": staged["content_type"]},
        )
        uploaded_files.append({
            "filename": staged["filename"],
            "content": staged["content"],
            "storage_path": storage_path,
        })

    supabase.table("job_postings").insert({
        "id": job_id,
        "title": title.strip(),
        "department": department.strip() or "Engineering",
        "description": description.strip(),
        "required_skills": required_skills.strip() or "Not specified",
        "experience_years": experience_years,
        "status": "screening",
        "created_by": current_user.id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }).execute()

    try:
        result = await asyncio.to_thread(
            recruitment_screen_graph.invoke,
            {
                "job_id": job_id,
                "job_title": title.strip(),
                "job_description": description.strip(),
                "required_skills": required_skills.strip() or "Not specified",
                "experience_years": experience_years,
                "uploaded_files": uploaded_files,
                "supabase": supabase,
            },
        )
    except Exception as exc:
        logger.exception("Recruitment screening pipeline failed for job %s", job_id)
        supabase.table("job_postings").update({
            "status": "draft",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI screening pipeline failed: {exc}",
        ) from exc

    if result.get("error"):
        supabase.table("job_postings").update({
            "status": "draft",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", job_id).execute()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(result["error"]),
        )

    scheduled = result.get("scheduled_candidates") or result.get("shortlisted_candidates") or []
    drafts = result.get("email_drafts") or []

    candidate_rows: list[dict[str, Any]] = []
    for cand in scheduled:
        draft = _match_draft(cand, drafts)
        candidate_rows.append({
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "name": str(cand.get("name") or "Unknown"),
            "email": cand.get("email") or None,
            "match_score": float(cand.get("match_score", 0.0) or 0.0),
            "matched_skills": str(cand.get("matched_skills") or ""),
            "interview_slot": str(cand.get("interview_slot") or "TBD"),
            "email_subject": str(draft.get("subject") or f"Interview Invitation — {title.strip()}"),
            "email_body": str(draft.get("body") or ""),
            "resume_source": str(cand.get("source_file") or ""),
            "resume_storage_path": str(cand.get("resume_storage_path") or ""),
            "email_sent": False,
            "status": "email_drafted",
        })

    persisted: list[dict[str, Any]] = []
    if candidate_rows:
        insert_res = supabase.table("candidates").insert(candidate_rows).execute()
        persisted = getattr(insert_res, "data", None) or candidate_rows

    supabase.table("job_postings").update({
        "status": "pending_approval",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id).execute()

    return ScreenJobResponse(
        job_id=job_id,
        status="pending_approval",
        candidates=[CandidateOut(**row) for row in persisted],
    )


@router.get("/jobs/{job_id}", response_model=JobDetailResponse)
def get_job_detail(
    job_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> JobDetailResponse:
    """Return a single job posting and its candidate records."""
    job_id_str = str(job_id)
    job_res = (
        supabase.table("job_postings")
        .select("*")
        .eq("id", job_id_str)
        .maybe_single()
        .execute()
    )
    job = getattr(job_res, "data", None)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job posting not found")

    cands_res = (
        supabase.table("candidates")
        .select("*")
        .eq("job_id", job_id_str)
        .order("match_score", desc=True)
        .execute()
    )
    candidates = getattr(cands_res, "data", None) or []

    return JobDetailResponse(
        job=JobPostingOut(**job),
        candidates=[CandidateOut(**row) for row in candidates],
    )


@router.post("/jobs/{job_id}/approve", response_model=ApproveJobResponse)
def approve_job_candidates(
    job_id: uuid.UUID,
    payload: ApproveJobRequest,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> ApproveJobResponse:
    """Apply HR edits/decisions, dispatch approved interview emails, and mark job approved."""
    job_id_str = str(job_id)
    job_res = (
        supabase.table("job_postings")
        .select("*")
        .eq("id", job_id_str)
        .maybe_single()
        .execute()
    )
    job = getattr(job_res, "data", None)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job posting not found")

    cands_res = supabase.table("candidates").select("*").eq("job_id", job_id_str).execute()
    existing_by_id = {str(c["id"]): c for c in (getattr(cands_res, "data", None) or [])}

    send_errors: list[str] = []

    for decision in payload.decisions:
        candidate = existing_by_id.get(decision.candidate_id)
        if not candidate:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Candidate {decision.candidate_id} not found for job {job_id_str}",
            )

        if bool(candidate.get("email_sent")):
            # Audit state is immutable once an invitation email has been sent.
            if candidate.get("status") != "email_sent":
                supabase.table("candidates").update({
                    "email_sent": True,
                    "status": "email_sent",
                }).eq("id", decision.candidate_id).execute()
            continue

        subject = decision.email_subject or str(candidate.get("email_subject") or "")
        body = decision.email_body or str(candidate.get("email_body") or "")
        slot = (
            decision.interview_slot
            if decision.interview_slot is not None
            else str(candidate.get("interview_slot") or "TBD")
        )

        if decision.approved:
            recipient = candidate.get("email")
            if recipient:
                try:
                    send_interview_email(str(recipient), subject, body)
                    email_sent = True
                    new_status = "email_sent"
                except Exception as exc:
                    logger.exception("Failed to send interview email to %s", recipient)
                    send_errors.append(f"{candidate.get('name', 'Candidate')} ({recipient}): {exc}")
                    email_sent = False
                    new_status = "email_drafted"
            else:
                email_sent = False
                new_status = "shortlisted"

            supabase.table("candidates").update({
                "email_subject": subject,
                "email_body": body,
                "interview_slot": slot,
                "email_sent": email_sent,
                "status": new_status,
            }).eq("id", decision.candidate_id).execute()
        else:
            supabase.table("candidates").update({
                "email_subject": subject,
                "email_body": body,
                "interview_slot": slot,
                "email_sent": False,
                "status": "rejected",
            }).eq("id", decision.candidate_id).execute()

    if send_errors:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send one or more interview emails: {'; '.join(send_errors)}",
        )

    supabase.table("job_postings").update({
        "status": "approved",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id_str).execute()

    updated_res = (
        supabase.table("candidates")
        .select("*")
        .eq("job_id", job_id_str)
        .order("match_score", desc=True)
        .execute()
    )
    updated_candidates = getattr(updated_res, "data", None) or []
    sent_count = sum(1 for c in updated_candidates if c.get("email_sent"))
    rejected_count = sum(1 for c in updated_candidates if c.get("status") == "rejected")

    return ApproveJobResponse(
        job_id=job_id_str,
        status="approved",
        sent_count=sent_count,
        rejected_count=rejected_count,
        candidates=[CandidateOut(**row) for row in updated_candidates],
    )
