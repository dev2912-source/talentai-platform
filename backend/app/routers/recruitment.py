import asyncio
from datetime import datetime, timezone
import logging
import os
import re
from typing import Any
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
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
    JobPostingUpdateIn,
    ManualCandidateIn,
    ScreenJobResponse,
)
from app.services.email import get_email_mode, send_interview_email
from app.services.exports import build_recruitment_excel

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


async def _validate_and_stage_resumes(resumes: list[UploadFile]) -> list[dict[str, Any]]:
    """Validate extensions, sizes, and non-empty payloads for uploaded resume files."""
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
        staged_files.append({
            "filename": _safe_filename(orig_name),
            "content": raw_bytes,
            "content_type": upload.content_type or "application/octet-stream",
        })

    if not staged_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload at least one non-empty resume (PDF, DOCX, or TXT).",
        )
    return staged_files


def _upload_staged_resumes(
    supabase: Client,
    job_id: str,
    staged_files: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Upload staged resume bytes to Supabase Storage hr-uploads bucket."""
    uploaded_files: list[dict[str, Any]] = []
    for staged in staged_files:
        storage_path = f"{job_id}/{uuid.uuid4().hex[:8]}_{staged['filename']}"
        try:
            supabase.storage.from_("hr-uploads").upload(
                storage_path,
                staged["content"],
                {"content-type": staged["content_type"]},
            )
        except Exception as exc:
            logger.warning("Storage upload failed (%s); attempting to create bucket and retry.", exc)
            try:
                supabase.storage.create_bucket("hr-uploads", options={"public": False})
                supabase.storage.from_("hr-uploads").upload(
                    storage_path,
                    staged["content"],
                    {"content-type": staged["content_type"]},
                )
            except Exception as upload_exc:
                logger.exception("Failed to upload resume '%s' to Supabase Storage", staged["filename"])
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Failed to store uploaded resume in Supabase Storage.",
                ) from upload_exc
        uploaded_files.append({
            "filename": staged["filename"],
            "content": staged["content"],
            "storage_path": storage_path,
        })
    return uploaded_files


def _build_candidate_rows(
    job_id: str,
    job_title: str,
    scheduled: list[dict[str, Any]],
    drafts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convert LangGraph output into insertable Supabase candidate rows."""
    rows: list[dict[str, Any]] = []
    for cand in scheduled:
        draft = _match_draft(cand, drafts)
        rows.append({
            "id": str(uuid.uuid4()),
            "job_id": job_id,
            "name": str(cand.get("name") or "Unknown"),
            "email": cand.get("email") or None,
            "match_score": float(cand.get("match_score", 0.0) or 0.0),
            "matched_skills": str(cand.get("matched_skills") or ""),
            "interview_slot": str(cand.get("interview_slot") or "TBD"),
            "email_subject": str(draft.get("subject") or f"Interview Invitation — {job_title}"),
            "email_body": str(draft.get("body") or ""),
            "resume_source": str(cand.get("source_file") or ""),
            "resume_storage_path": str(cand.get("resume_storage_path") or ""),
            "email_sent": False,
            "status": "email_drafted",
        })
    return rows


@router.post("/screen", response_model=ScreenJobResponse)
async def screen_resumes(
    title: str = Form(...),
    department: str = Form("Engineering"),
    description: str = Form(...),
    required_skills: str = Form("Not specified"),
    experience_years: int = Form(0),
    min_score: int = Form(40),
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

    staged_files = await _validate_and_stage_resumes(resumes)
    job_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    uploaded_files = _upload_staged_resumes(supabase, job_id, staged_files)

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

    clamped_min_score = max(0, min(100, int(min_score)))

    try:
        result = await asyncio.to_thread(
            recruitment_screen_graph.invoke,
            {
                "job_id": job_id,
                "job_title": title.strip(),
                "job_description": description.strip(),
                "required_skills": required_skills.strip() or "Not specified",
                "experience_years": experience_years,
                "min_score": float(clamped_min_score),
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
            detail="AI screening pipeline encountered an internal error. Check server logs.",
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
    candidate_rows = _build_candidate_rows(job_id, title.strip(), scheduled, drafts)

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


@router.post("/jobs/{job_id}/rescreen", response_model=ScreenJobResponse)
async def add_resumes_to_job(
    job_id: uuid.UUID,
    min_score: int = Form(40),
    resumes: list[UploadFile] = File(...),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> ScreenJobResponse:
    """Screen additional resumes into an existing draft or pending_approval job posting."""
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

    if job.get("status") in ("approved", "completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add resumes to an already finalized job posting.",
        )

    staged_files = await _validate_and_stage_resumes(resumes)
    uploaded_files = _upload_staged_resumes(supabase, job_id_str, staged_files)
    clamped_min_score = max(0, min(100, int(min_score)))

    try:
        result = await asyncio.to_thread(
            recruitment_screen_graph.invoke,
            {
                "job_id": job_id_str,
                "job_title": str(job.get("title") or ""),
                "job_description": str(job.get("description") or ""),
                "required_skills": str(job.get("required_skills") or "Not specified"),
                "experience_years": int(job.get("experience_years") or 0),
                "min_score": float(clamped_min_score),
                "uploaded_files": uploaded_files,
                "supabase": supabase,
            },
        )
    except Exception as exc:
        logger.exception("Rescreen pipeline failed for job %s", job_id_str)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI screening pipeline encountered an internal error. Check server logs.",
        ) from exc

    if result.get("error"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(result["error"]),
        )

    scheduled = result.get("scheduled_candidates") or result.get("shortlisted_candidates") or []
    drafts = result.get("email_drafts") or []
    new_rows = _build_candidate_rows(job_id_str, str(job.get("title") or ""), scheduled, drafts)

    existing_res = supabase.table("candidates").select("*").eq("job_id", job_id_str).execute()
    existing = getattr(existing_res, "data", None) or []
    existing_emails = {
        str(c.get("email") or "").strip().lower()
        for c in existing
        if c.get("email")
    }
    filtered_new = [
        row
        for row in new_rows
        if not (row.get("email") and str(row["email"]).strip().lower() in existing_emails)
    ]

    if filtered_new:
        supabase.table("candidates").insert(filtered_new).execute()

    supabase.table("job_postings").update({
        "status": "pending_approval",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id_str).execute()

    all_res = (
        supabase.table("candidates")
        .select("*")
        .eq("job_id", job_id_str)
        .order("match_score", desc=True)
        .execute()
    )
    all_candidates = getattr(all_res, "data", None) or []
    return ScreenJobResponse(
        job_id=job_id_str,
        status="pending_approval",
        candidates=[CandidateOut(**row) for row in all_candidates],
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
        email_mode=get_email_mode(),
    )


@router.patch("/jobs/{job_id}", response_model=JobPostingOut)
def update_job_posting(
    job_id: uuid.UUID,
    payload: JobPostingUpdateIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> JobPostingOut:
    """Edit a draft or pending_approval job posting in-place (HR only)."""
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

    if job.get("status") in ("approved", "completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot edit an already finalized job posting.",
        )

    update_fields = {
        "title": payload.title.strip(),
        "department": payload.department.strip() or "Engineering",
        "description": payload.description.strip(),
        "required_skills": payload.required_skills.strip() or "Not specified",
        "experience_years": payload.experience_years,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = (
        supabase.table("job_postings")
        .update(update_fields)
        .eq("id", job_id_str)
        .execute()
    )
    updated_rows = getattr(res, "data", None) or []
    return JobPostingOut(**(updated_rows[0] if updated_rows else {**job, **update_fields}))


@router.post("/jobs/{job_id}/candidates", response_model=CandidateOut, status_code=status.HTTP_201_CREATED)
def add_manual_candidate(
    job_id: uuid.UUID,
    payload: ManualCandidateIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> CandidateOut:
    """Manually add a candidate to a draft or pending_approval job posting (HR only)."""
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

    if job.get("status") in ("approved", "completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add candidates to an already finalized job posting.",
        )

    job_title = str(job.get("title") or "Role")
    slot = payload.interview_slot.strip() or "TBD"
    subject = payload.email_subject.strip() or f"Interview Invitation — {job_title}"
    body = payload.email_body.strip() or (
        f"Dear {payload.name.strip()},\n\n"
        f"We are pleased to invite you to interview for the {job_title} position.\n"
        f"Proposed Interview Slot: {slot}\n\n"
        f"Please reply to confirm your availability.\n\n"
        f"Best regards,\nTalentAI Hiring Team"
    )

    row = {
        "id": str(uuid.uuid4()),
        "job_id": job_id_str,
        "name": payload.name.strip(),
        "email": (payload.email or "").strip() or None,
        "match_score": float(payload.match_score),
        "matched_skills": payload.matched_skills.strip(),
        "interview_slot": slot,
        "email_subject": subject,
        "email_body": body,
        "resume_source": "Manual Entry",
        "resume_storage_path": "",
        "email_sent": False,
        "status": "email_drafted",
    }
    insert_res = supabase.table("candidates").insert(row).execute()
    persisted = getattr(insert_res, "data", None) or [row]
    supabase.table("job_postings").update({
        "status": "pending_approval",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", job_id_str).execute()
    return CandidateOut(**persisted[0])


@router.delete("/candidates/{candidate_id}")
def delete_candidate(
    candidate_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Remove an unsent candidate from a job posting (HR only)."""
    cand_id_str = str(candidate_id)
    cand_res = (
        supabase.table("candidates")
        .select("id, email_sent, resume_storage_path")
        .eq("id", cand_id_str)
        .maybe_single()
        .execute()
    )
    candidate = getattr(cand_res, "data", None)
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")

    if bool(candidate.get("email_sent")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove a candidate after an invitation email has already been sent.",
        )

    supabase.table("candidates").delete().eq("id", cand_id_str).execute()
    storage_path = str(candidate.get("resume_storage_path") or "").strip()
    if storage_path:
        try:
            supabase.storage.from_("hr-uploads").remove([storage_path])
        except Exception as exc:
            logger.warning("Storage cleanup warning for candidate %s: %s", cand_id_str, exc)

    return {"status": "deleted", "id": cand_id_str}


@router.get("/jobs/{job_id}/export")
def export_job_candidates_excel(
    job_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Export all screened candidates for a job posting as a styled Excel (.xlsx) file."""
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
    xlsx_bytes = build_recruitment_excel(job, candidates)
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", str(job.get("title") or "candidates")).strip("_") or "candidates"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{slug}_candidates.xlsx"'},
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
        recipient = (
            (decision.email.strip() or None)
            if decision.email is not None
            else (candidate.get("email") or None)
        )

        if decision.approved:
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
                "email": recipient,
                "email_subject": subject,
                "email_body": body,
                "interview_slot": slot,
                "email_sent": email_sent,
                "status": new_status,
            }).eq("id", decision.candidate_id).execute()
        else:
            supabase.table("candidates").update({
                "email": recipient,
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
        email_mode=get_email_mode(),
        candidates=[CandidateOut(**row) for row in updated_candidates],
    )


@router.delete("/jobs/{job_id}")
def delete_job_posting(
    job_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete a job posting, cascade DB rows, and clean up stored resumes (HR only)."""
    job_id_str = str(job_id)
    cands_res = (
        supabase.table("candidates")
        .select("resume_storage_path")
        .eq("job_id", job_id_str)
        .execute()
    )
    storage_paths = [
        str(row["resume_storage_path"])
        for row in (getattr(cands_res, "data", None) or [])
        if row.get("resume_storage_path")
    ]

    del_res = supabase.table("job_postings").delete().eq("id", job_id_str).execute()
    deleted_rows = getattr(del_res, "data", None) or []
    if not deleted_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job posting not found",
        )

    if storage_paths:
        try:
            supabase.storage.from_("hr-uploads").remove(storage_paths)
        except Exception as exc:
            logger.warning("Storage cleanup warning for deleted job %s: %s", job_id_str, exc)

    return {"status": "deleted", "id": job_id_str}


@router.get("/candidates/{candidate_id}/resume")
def download_candidate_resume(
    candidate_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Download the original uploaded resume file for a candidate from Supabase Storage."""
    cand_id_str = str(candidate_id)
    cand_res = (
        supabase.table("candidates")
        .select("id, resume_source, resume_storage_path")
        .eq("id", cand_id_str)
        .maybe_single()
        .execute()
    )
    candidate = getattr(cand_res, "data", None)
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Candidate not found",
        )

    storage_path = str(candidate.get("resume_storage_path") or "").strip()
    if not storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No stored resume file for this candidate.",
        )

    try:
        file_bytes = supabase.storage.from_("hr-uploads").download(storage_path)
    except Exception as exc:
        logger.warning("Failed to download resume '%s': %s", storage_path, exc)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resume file could not be retrieved from storage.",
        ) from exc

    safe_name = _safe_filename(str(candidate.get("resume_source") or os.path.basename(storage_path)))
    ext = os.path.splitext(safe_name)[1].lower()
    media_types = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".txt": "text/plain; charset=utf-8",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )
