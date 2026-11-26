import asyncio
from datetime import datetime, timezone
import io
import logging
import secrets
from typing import Any
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
import openpyxl.utils.exceptions
import pandas as pd
from supabase import Client

from app.ai.performance import generate_performance_review
from app.db import get_supabase
from app.deps import CurrentUser, require_employee, require_hr
from app.models.schemas import (
    PerformanceBatchResponse,
    PerformanceBatchSummaryOut,
    PerformanceRecordOut,
)
from app.services.exports import (
    build_performance_excel,
    build_performance_pdf,
    build_sample_performance_kpi_excel,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/performance", tags=["performance"])


def _is_valid_uuid(value: str) -> bool:
    """Return True if value parses cleanly as a UUID."""
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False


def _find_identifier_column(columns: list[Any]) -> tuple[Any, bool]:
    """Locate the employee identifier column, prioritizing explicit employee headers."""
    normalized = [(col, str(col).strip().lower().replace("_", " ")) for col in columns]

    for col, col_norm in normalized:
        if "employee email" in col_norm or "employee username" in col_norm or "employee name" in col_norm:
            return col, False
        if "employee id" in col_norm:
            return col, True

    for col, col_norm in normalized:
        if "email" in col_norm or "username" in col_norm or "name" in col_norm:
            return col, False
        if col_norm == "id":
            return col, True

    raise ValueError(
        "Excel file must contain an 'Employee Name', 'Username', 'Email', or 'Employee ID' column to identify employees."
    )


def _list_auth_users(supabase: Client) -> list[Any]:
    """Return auth users across supabase-py response shapes."""
    response = supabase.auth.admin.list_users()
    if isinstance(response, list):
        return response
    return getattr(response, "users", []) or []


def _escape_like(value: str) -> str:
    """Escape SQL LIKE/ILIKE wildcard characters for literal matching."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _find_profile_by(supabase: Client, column: str, value: str, *, case_insensitive: bool = False) -> dict[str, Any] | None:
    """Fetch a single profile row matching the given column regardless of HR status."""
    query = supabase.table("profiles").select("*")
    query = query.ilike(column, _escape_like(value)) if case_insensitive else query.eq(column, value)
    res = query.maybe_single().execute()
    return getattr(res, "data", None)


def _ensure_non_hr_profile(profile: dict[str, Any], identifier: str) -> None:
    """Reject performance review generation for HR accounts to prevent privilege demotion."""
    if profile.get("is_hr"):
        label = profile.get("email") or profile.get("username") or identifier
        raise ValueError(f"Cannot generate employee performance review for HR user '{label}'.")


def _extract_row_field(row: pd.Series, token: str) -> str | None:
    """Extract a non-empty string value from the first column matching token."""
    for col in row.index:
        if token in str(col).lower():
            val = row[col]
            if not pd.isna(val) and str(val).strip():
                return str(val).strip()
    return None


def _ensure_employee_profile(
    supabase: Client,
    identifier: str,
    is_id: bool,
    row: pd.Series,
) -> tuple[dict[str, Any], str]:
    """Match an existing employee profile or auto-create an auth user and profile row."""
    if is_id and _is_valid_uuid(identifier):
        found = _find_profile_by(supabase, "id", identifier)
        if found:
            _ensure_non_hr_profile(found, identifier)
            return found, str(found.get("username") or identifier)

    if "@" in identifier:
        found = _find_profile_by(supabase, "email", identifier.lower(), case_insensitive=True)
        if found:
            _ensure_non_hr_profile(found, identifier)
            return found, str(found.get("username") or identifier)
    else:
        found = _find_profile_by(supabase, "username", identifier, case_insensitive=True)
        if found:
            _ensure_non_hr_profile(found, identifier)
            return found, str(found.get("username") or identifier)
        safe_candidate = identifier.replace(" ", "_").lower()
        if safe_candidate != identifier:
            found = _find_profile_by(supabase, "username", safe_candidate, case_insensitive=True)
            if found:
                _ensure_non_hr_profile(found, identifier)
                return found, str(found.get("username") or safe_candidate)

    display_name = identifier
    if is_id:
        display_name = _extract_row_field(row, "name") or identifier

    if "@" in identifier:
        email = identifier.lower()
        safe_username = email.split("@", 1)[0].replace(" ", "_").lower()
    else:
        row_email = _extract_row_field(row, "email")
        safe_username = display_name.replace(" ", "_").lower()
        email = row_email.lower() if row_email and "@" in row_email else f"{safe_username}@demo.com"

    if not safe_username:
        raise ValueError(f"Unable to derive username from identifier '{identifier}'.")

    # Check once more by resolved email before creating an auth user
    existing_by_email = _find_profile_by(supabase, "email", email, case_insensitive=True)
    if existing_by_email:
        _ensure_non_hr_profile(existing_by_email, email)
        return existing_by_email, str(existing_by_email.get("username") or safe_username)

    row_department = _extract_row_field(row, "department")
    department = row_department or "General"
    default_profile_fields = {
        "username": safe_username,
        "is_hr": False,
        "department": department,
        "salary": 50000.0,
        "leave_balance": 10,
        "attendance_score": 100,
    }

    user_id: str | None = None
    created_new_user = False
    try:
        created = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": secrets.token_urlsafe(16),
                "email_confirm": True,
                "user_metadata": {"username": safe_username},
            }
        )
        created_user = getattr(created, "user", None)
        if created_user is not None:
            user_id = str(created_user.id)
            created_new_user = True
    except Exception:
        existing_users = _list_auth_users(supabase)
        matched_user = next(
            (u for u in existing_users if str(getattr(u, "email", "")).lower() == email),
            None,
        )
        if matched_user is not None:
            user_id = str(matched_user.id)

    if not user_id:
        raise RuntimeError(f"Failed to resolve or create Supabase Auth user for {email}.")

    # Re-check by user_id before inserting defaults so existing profiles are never overwritten
    existing_by_id = _find_profile_by(supabase, "id", user_id)
    if existing_by_id:
        _ensure_non_hr_profile(existing_by_id, email)
        if created_new_user and row_department and existing_by_id.get("department") != row_department:
            update_res = (
                supabase.table("profiles")
                .update({"department": row_department})
                .eq("id", user_id)
                .execute()
            )
            updated_rows = getattr(update_res, "data", None) or []
            if updated_rows:
                existing_by_id = updated_rows[0]
            else:
                existing_by_id["department"] = row_department
        return existing_by_id, str(existing_by_id.get("username") or safe_username)

    profile_row = {"id": user_id, "email": email, **default_profile_fields}
    insert_res = supabase.table("profiles").insert(profile_row).execute()
    inserted = getattr(insert_res, "data", None) or [profile_row]
    return inserted[0], safe_username


def _process_performance_upload(
    file_bytes: bytes,
    review_period: str,
    supabase: Client,
) -> tuple[str, list[dict[str, Any]]]:
    """Parse an Excel file, resolve employee profiles, generate AI reviews, and persist batch."""
    try:
        df = pd.read_excel(io.BytesIO(file_bytes))
    except (
        ValueError,
        zipfile.BadZipFile,
        OSError,
        ImportError,
        pd.errors.ParserError,
        openpyxl.utils.exceptions.InvalidFileException,
    ) as exc:
        raise ValueError(f"Invalid or corrupt Excel file: {exc}") from exc

    identifier_col, is_id = _find_identifier_column(list(df.columns))

    batch_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    rows_to_insert: list[dict[str, Any]] = []

    for _, row in df.iterrows():
        raw_identifier = row[identifier_col]
        if pd.isna(raw_identifier) or not str(raw_identifier).strip():
            continue
        identifier = str(raw_identifier).strip()

        profile, resolved_name = _ensure_employee_profile(supabase, identifier, is_id, row)
        row_dict = row.to_dict()
        row_data_str = ", ".join(f"{k}: {v}" for k, v in row_dict.items())

        result = generate_performance_review(employee_profile=profile, row_data=row_data_str)

        rows_to_insert.append({
            "id": str(uuid.uuid4()),
            "batch_id": batch_id,
            "employee_id": str(profile["id"]),
            "employee_name": str(profile.get("username") or resolved_name),
            "employee_email": str(profile.get("email") or ""),
            "department": str(profile.get("department") or "General"),
            "review_period": review_period,
            "kpi_data": row_data_str,
            "performance_score": result.get("performance_score"),
            "kpi_achievement_percent": result.get("kpi_achievement_percent"),
            "strengths": result.get("strengths") or "",
            "areas_for_improvement": result.get("areas_for_improvement") or "",
            "recommended_actions": result.get("recommended_actions") or "",
            "created_at": now_iso,
        })

    if not rows_to_insert:
        raise ValueError("No matching employees found in the Excel file.")

    insert_res = supabase.table("performance_records").insert(rows_to_insert).execute()
    persisted = getattr(insert_res, "data", None) or rows_to_insert
    return batch_id, persisted


def _fetch_performance_batch(supabase: Client, batch_id: str | None) -> tuple[str | None, list[dict[str, Any]]]:
    """Load a specific performance review batch or the latest batch if batch_id is omitted."""
    target_batch_id = batch_id
    if not target_batch_id:
        latest_res = (
            supabase.table("performance_records")
            .select("*")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest_rows = getattr(latest_res, "data", None) or []
        if not latest_rows:
            return None, []
        target_batch_id = str(latest_rows[0]["batch_id"])

    rows_res = (
        supabase.table("performance_records")
        .select("*")
        .eq("batch_id", target_batch_id)
        .order("created_at", desc=False)
        .execute()
    )
    rows = getattr(rows_res, "data", None) or []
    return target_batch_id, rows


@router.post("/upload", response_model=PerformanceBatchResponse)
async def upload_performance_excel(
    file: UploadFile = File(...),
    review_period: str = Form("Current Period"),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> PerformanceBatchResponse:
    """Parse an uploaded KPI Excel sheet, generate AI performance reviews, and persist the batch."""
    filename = (file.filename or "").lower()
    if not (filename.endswith(".xlsx") or filename.endswith(".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Please upload .xlsx or .xls files only.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    clean_period = review_period.strip() or "Current Period"
    try:
        batch_id, persisted = await asyncio.to_thread(
            _process_performance_upload,
            file_bytes,
            clean_period,
            supabase,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Performance bulk generation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate performance reviews. Please verify the spreadsheet format.",
        ) from exc

    return PerformanceBatchResponse(
        batch_id=batch_id,
        records=[PerformanceRecordOut(**row) for row in persisted],
    )


@router.get("/sample-kpi")
def download_sample_kpi_sheet(
    _hr: CurrentUser = Depends(require_hr),
) -> Response:
    """Download a sample Excel (.xlsx) KPI sheet for testing bulk AI performance reviews."""
    xlsx_bytes = build_sample_performance_kpi_excel()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="sample_performance_kpi.xlsx"'},
    )


@router.get("/batches", response_model=list[PerformanceBatchSummaryOut])
def list_performance_batches(
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> list[PerformanceBatchSummaryOut]:
    """List past AI performance review batches ordered newest first (HR only)."""
    res = (
        supabase.table("performance_records")
        .select("batch_id, review_period, created_at")
        .order("created_at", desc=True)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    batches: dict[str, dict[str, Any]] = {}
    for row in rows:
        bid = str(row.get("batch_id") or "")
        if not bid:
            continue
        if bid not in batches:
            batches[bid] = {
                "batch_id": bid,
                "review_period": str(row.get("review_period") or ""),
                "created_at": row.get("created_at"),
                "employee_count": 1,
            }
        else:
            batches[bid]["employee_count"] += 1
    return [PerformanceBatchSummaryOut(**item) for item in list(batches.values())[:20]]


@router.get("/reports", response_model=PerformanceBatchResponse)
def get_performance_reports(
    batch_id: uuid.UUID | None = Query(default=None),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> PerformanceBatchResponse:
    """Fetch a specific performance review batch or the latest batch (HR only)."""
    resolved_batch_id, rows = _fetch_performance_batch(
        supabase,
        str(batch_id) if batch_id is not None else None,
    )
    return PerformanceBatchResponse(
        batch_id=resolved_batch_id,
        records=[PerformanceRecordOut(**row) for row in rows],
    )


@router.get("/reports/excel")
def download_performance_reports_excel(
    batch_id: uuid.UUID | None = Query(default=None),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Generate and stream a styled Excel (.xlsx) of the requested or latest performance batch."""
    _resolved_batch_id, rows = _fetch_performance_batch(
        supabase,
        str(batch_id) if batch_id is not None else None,
    )
    xlsx_bytes = build_performance_excel(rows)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="performance_reports.xlsx"'},
    )


@router.get("/reports/pdf")
def download_performance_reports_pdf(
    batch_id: uuid.UUID | None = Query(default=None),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Generate and stream a PDF of the requested or latest performance review batch (HR only)."""
    _resolved_batch_id, rows = _fetch_performance_batch(
        supabase,
        str(batch_id) if batch_id is not None else None,
    )
    pdf_bytes = build_performance_pdf(rows)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="performance_reports.pdf"'},
    )


@router.delete("/batches/{batch_id}")
def delete_performance_batch(
    batch_id: uuid.UUID,
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> dict[str, str]:
    """Delete an entire performance review batch by batch_id (HR only)."""
    batch_id_str = str(batch_id)
    res = supabase.table("performance_records").delete().eq("batch_id", batch_id_str).execute()
    deleted = getattr(res, "data", None) or []
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Performance batch not found.",
        )
    return {"status": "deleted", "batch_id": batch_id_str}


@router.get("/my-reviews", response_model=list[PerformanceRecordOut])
def get_my_performance_reviews(
    employee: CurrentUser = Depends(require_employee),
    supabase: Client = Depends(get_supabase),
) -> list[PerformanceRecordOut]:
    """Return the signed-in employee's own AI performance review records."""
    res = (
        supabase.table("performance_records")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = getattr(res, "data", None) or []
    return [PerformanceRecordOut(**row) for row in rows]
