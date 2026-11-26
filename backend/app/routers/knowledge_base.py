from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.db import get_supabase
from app.deps import CurrentUser, require_hr
from app.models.schemas import (
    FaqIn,
    FaqOut,
    KbOverviewResponse,
    PolicyIn,
    PolicyOut,
    UserProfileOut,
)

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
    policy_id: str,
    payload: PolicyIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> PolicyOut:
    """Update an existing company policy by ID (HR only)."""
    update_fields = {
        "title": payload.title.strip(),
        "content": payload.content.strip(),
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    res = (
        supabase.table("company_policies")
        .update(update_fields)
        .eq("id", policy_id)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
    return PolicyOut(**rows[0])


@router.delete("/policies/{policy_id}")
def delete_policy(
    policy_id: str,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete a company policy by ID (HR only)."""
    res = supabase.table("company_policies").delete().eq("id", policy_id).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Policy not found.")
    return {"status": "deleted", "id": policy_id}


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
    faq_id: str,
    payload: FaqIn,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> FaqOut:
    """Update an existing FAQ by ID (HR only)."""
    update_fields = {
        "question": payload.question.strip(),
        "answer": payload.answer.strip(),
    }
    res = (
        supabase.table("faqs")
        .update(update_fields)
        .eq("id", faq_id)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ not found.")
    return FaqOut(**rows[0])


@router.delete("/faqs/{faq_id}")
def delete_faq(
    faq_id: str,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete an FAQ by ID (HR only)."""
    res = supabase.table("faqs").delete().eq("id", faq_id).execute()
    rows = getattr(res, "data", None) or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="FAQ not found.")
    return {"status": "deleted", "id": faq_id}
