import asyncio
from datetime import datetime, timezone
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.ai.support import generate_support_response
from app.db import get_supabase
from app.deps import CurrentUser, require_hr
from app.models.schemas import (
    ChatRequest,
    ChatResponse,
    EmployeeCreateIn,
    EmployeeUpdateIn,
    FaqIn,
    FaqOut,
    KbOverviewResponse,
    PolicyIn,
    PolicyOut,
    UserProfileOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kb", tags=["knowledge-base"])


@router.get("/overview", response_model=KbOverviewResponse)
def get_kb_overview(
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> KbOverviewResponse:
    """Return all company policies, FAQs, and non-HR employee profiles (HR only)."""
    policies_res = (
        supabase.table("company_policies")
        .select("*")
        .order("last_updated", desc=True)
        .execute()
    )
    faqs_res = (
        supabase.table("faqs")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )
    employees_res = (
        supabase.table("profiles")
        .select("*")
        .eq("is_hr", False)
        .order("created_at", desc=True)
        .execute()
    )

    policies = [PolicyOut(**row) for row in (getattr(policies_res, "data", None) or [])]
    faqs = [FaqOut(**row) for row in (getattr(faqs_res, "data", None) or [])]
    employees = [UserProfileOut(**row) for row in (getattr(employees_res, "data", None) or [])]
    return KbOverviewResponse(policies=policies, faqs=faqs, employees=employees)


@router.post("/policies", response_model=PolicyOut, status_code=status.HTTP_201_CREATED)
def create_policy(
    payload: PolicyIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> PolicyOut:
    """Create a new company policy (HR only)."""
    row = {
        "title": payload.title.strip(),
        "content": payload.content.strip(),
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    res = supabase.table("company_policies").insert(row).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create policy.")
    return PolicyOut(**rows[0])


@router.put("/policies/{policy_id}", response_model=PolicyOut)
def update_policy(
    policy_id: uuid.UUID,
    payload: PolicyIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> PolicyOut:
    """Update an existing company policy by ID (HR only)."""
    policy_id_str = str(policy_id)
    update_fields = {
        "title": payload.title.strip(),
        "content": payload.content.strip(),
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    res = (
        supabase.table("company_policies")
        .update(update_fields)
        .eq("id", policy_id_str)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
    return PolicyOut(**rows[0])


@router.delete("/policies/{policy_id}")
def delete_policy(
    policy_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete a company policy by ID (HR only)."""
    policy_id_str = str(policy_id)
    res = supabase.table("company_policies").delete().eq("id", policy_id_str).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
    return {"status": "deleted", "id": policy_id_str}


@router.post("/faqs", response_model=FaqOut, status_code=status.HTTP_201_CREATED)
def create_faq(
    payload: FaqIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> FaqOut:
    """Create a new knowledge base FAQ (HR only)."""
    row = {
        "question": payload.question.strip(),
        "answer": payload.answer.strip(),
    }
    res = supabase.table("faqs").insert(row).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create FAQ.")
    return FaqOut(**rows[0])


@router.put("/faqs/{faq_id}", response_model=FaqOut)
def update_faq(
    faq_id: uuid.UUID,
    payload: FaqIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> FaqOut:
    """Update an existing FAQ by ID (HR only)."""
    faq_id_str = str(faq_id)
    update_fields = {
        "question": payload.question.strip(),
        "answer": payload.answer.strip(),
    }
    res = (
        supabase.table("faqs")
        .update(update_fields)
        .eq("id", faq_id_str)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ not found.")
    return FaqOut(**rows[0])


@router.delete("/faqs/{faq_id}")
def delete_faq(
    faq_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete an FAQ by ID (HR only)."""
    faq_id_str = str(faq_id)
    res = supabase.table("faqs").delete().eq("id", faq_id_str).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ not found.")
    return {"status": "deleted", "id": faq_id_str}


@router.post("/employees", response_model=UserProfileOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreateIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> UserProfileOut:
    """Create a new non-HR employee auth account and profile (HR only)."""
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please enter a valid email address.")

    existing_res = supabase.table("profiles").select("id").eq("email", email).maybe_single().execute()
    if getattr(existing_res, "data", None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An account with this email already exists.")

    try:
        created = supabase.auth.admin.create_user({
            "email": email,
            "password": payload.password,
            "email_confirm": True,
            "user_metadata": {"username": payload.username.strip()},
        })
        auth_user = getattr(created, "user", None)
        if not auth_user:
            raise RuntimeError("Supabase Auth did not return a user.")
        user_id = str(auth_user.id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Failed to create employee auth user '%s': %s", email, exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to create employee account. Email may already be registered.",
        ) from exc

    profile_row = {
        "id": user_id,
        "username": payload.username.strip(),
        "email": email,
        "is_hr": False,
        "department": payload.department.strip() or "General",
        "salary": float(payload.salary),
        "leave_balance": int(payload.leave_balance),
        "attendance_score": int(payload.attendance_score),
    }
    res = supabase.table("profiles").upsert(profile_row, on_conflict="id").execute()
    rows = getattr(res, "data", None) or [profile_row]
    return UserProfileOut(**rows[0])


@router.patch("/employees/{employee_id}", response_model=UserProfileOut)
def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdateIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> UserProfileOut:
    """Update a non-HR employee's department, salary, leave balance, and attendance score (HR only)."""
    emp_id_str = str(employee_id)
    existing_res = (
        supabase.table("profiles")
        .select("*")
        .eq("id", emp_id_str)
        .maybe_single()
        .execute()
    )
    existing = getattr(existing_res, "data", None)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    if existing.get("is_hr"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit HR manager accounts here.")

    update_fields = {
        "department": payload.department.strip() or "General",
        "salary": float(payload.salary),
        "leave_balance": int(payload.leave_balance),
        "attendance_score": int(payload.attendance_score),
    }
    res = supabase.table("profiles").update(update_fields).eq("id", emp_id_str).execute()
    rows = getattr(res, "data", None) or []
    return UserProfileOut(**(rows[0] if rows else {**existing, **update_fields}))


@router.post("/test-query", response_model=ChatResponse)
async def test_kb_query(
    payload: ChatRequest,
    hr_user: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> ChatResponse:
    """Allow HR to test the AI Support Agent against current Knowledge Base policies and FAQs."""
    try:
        answer = await asyncio.to_thread(
            generate_support_response,
            payload.message,
            hr_user,
            supabase,
        )
    except Exception as exc:
        logger.exception("KB test query failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to generate test AI response right now.",
        ) from exc
    return ChatResponse(response=answer)
