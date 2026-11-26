import asyncio
from datetime import datetime, timezone
import logging
from typing import Any
import uuid
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
import openpyxl.utils.exceptions
import pandas as pd
from supabase import Client

from app.ai.attendance import generate_attendance_report
from app.db import get_supabase
from app.deps import CurrentUser, get_current_user, require_hr
from app.models.schemas import (
    AttendanceLogOut,
    AttendanceReportBatchResponse,
    AttendanceReportOut,
    TapDataOut,
    TapResponse,
)
from app.services.exports import build_attendance_excel, build_attendance_pdf, parse_utc_timestamp

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


def _employee_id_candidates(user: CurrentUser) -> list[str]:
    """Build possible employee_id identifiers for a non-HR employee."""
    candidates = [
        f"EMP-{user.id[:8].upper()}",
        f"EMP-{user.id}",
        user.id,
    ]
    if user.username:
        candidates.extend([f"EMP-{user.username.upper()}", user.username])
    return list(dict.fromkeys(candidates))


def _coerce_ai_score(raw_score: Any) -> int | None:
    """Convert an AI score value into an integer or None for Postgres integer storage."""
    if raw_score is None or isinstance(raw_score, bool):
        return None
    try:
        return int(round(float(raw_score)))
    except (ValueError, TypeError):
        return None


def _fetch_report_batch(supabase: Client, batch_id: str | None) -> tuple[str | None, list[dict[str, Any]]]:
    """Load a specific attendance report batch or the latest batch if batch_id is omitted."""
    target_batch_id = batch_id
    if not target_batch_id:
        latest_res = (
            supabase.table("attendance_reports")
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
        supabase.table("attendance_reports")
        .select("*")
        .eq("batch_id", target_batch_id)
        .order("created_at", desc=False)
        .execute()
    )
    rows = getattr(rows_res, "data", None) or []
    return target_batch_id, rows


@router.post("/tap", response_model=TapResponse, status_code=status.HTTP_201_CREATED)
async def hardware_tap(
    request: Request,
    supabase: Client = Depends(get_supabase),
) -> TapResponse:
    """
    Public hardware webhook that records an RFID/NFC/biometric tap.
    Alternates IN (even prior count today) and OUT (odd prior count today).
    """
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload.",
        ) from exc

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON payload.",
        )

    employee_id = str(payload.get("employeeId") or "").strip()
    if not employee_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required field: employeeId.",
        )

    timestamp_str = str(payload.get("timestamp") or "").strip()
    device_type = str(payload.get("deviceType") or "").strip() or "rfid_scanner"
    location = str(payload.get("location") or "").strip() or "Main Entrance"

    tap_time = parse_utc_timestamp(timestamp_str)
    today_start = tap_time.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = tap_time.replace(hour=23, minute=59, second=59, microsecond=999999)

    existing_res = (
        supabase.table("attendance_logs")
        .select("id")
        .eq("employee_id", employee_id)
        .gte("timestamp", today_start.isoformat())
        .lte("timestamp", today_end.isoformat())
        .execute()
    )
    today_tap_count = len(getattr(existing_res, "data", None) or [])
    tap_type = "IN" if today_tap_count % 2 == 0 else "OUT"

    row_to_insert = {
        "employee_id": employee_id,
        "timestamp": tap_time.isoformat(),
        "device_type": device_type,
        "location": location,
        "tap_type": tap_type,
    }
    insert_res = supabase.table("attendance_logs").insert(row_to_insert).execute()
    inserted_rows = getattr(insert_res, "data", None) or []
    saved = inserted_rows[0] if inserted_rows else {"id": 0, **row_to_insert}

    return TapResponse(
        status="success",
        message=f"Tap recorded: {tap_type}",
        data=TapDataOut(
            id=saved["id"],
            employeeId=str(saved["employee_id"]),
            tapType=str(saved["tap_type"]),
            tapNumber=today_tap_count + 1,
            timestamp=str(saved["timestamp"]),
            deviceType=str(saved["device_type"]),
            location=str(saved["location"]),
        ),
    )


@router.get("/logs", response_model=list[AttendanceLogOut])
def list_attendance_logs(
    current_user: CurrentUser = Depends(get_current_user),
    supabase: Client = Depends(get_supabase),
) -> list[AttendanceLogOut]:
    """Return recent attendance logs (all for HR, own EMP-* logs for Employee)."""
    query = supabase.table("attendance_logs").select("*")
    if not current_user.is_hr:
        query = query.in_("employee_id", _employee_id_candidates(current_user))
    res = query.order("timestamp", desc=True).limit(50).execute()
    rows = getattr(res, "data", None) or []
    return [AttendanceLogOut(**row) for row in rows]


@router.get("/export-excel")
def export_attendance_excel(
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Export all attendance tap logs as a styled Excel (.xlsx) download (HR only)."""
    res = (
        supabase.table("attendance_logs")
        .select("*")
        .order("timestamp", desc=True)
        .execute()
    )
    logs = getattr(res, "data", None) or []
    xlsx_bytes = build_attendance_excel(logs)
    filename = f"attendance_logs_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/upload", response_model=AttendanceReportBatchResponse)
async def upload_attendance_timesheet(
    file: UploadFile = File(...),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> AttendanceReportBatchResponse:
    """Parse an uploaded Excel timesheet, run AI analysis, and persist the report batch."""
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

    try:
        analyzed = await asyncio.to_thread(generate_attendance_report, file_bytes)
    except (
        ValueError,
        zipfile.BadZipFile,
        OSError,
        ImportError,
        pd.errors.ParserError,
        openpyxl.utils.exceptions.InvalidFileException,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        logger.exception("Failed to process attendance Excel upload")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process timesheet: {exc}",
        ) from exc

    batch_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    rows_to_insert = [
        {
            "id": str(uuid.uuid4()),
            "batch_id": batch_id,
            "employee_name": str(item.get("name") or item.get("employee_name") or "Unknown"),
            "total_hours": float(item.get("total_hours", 0.0) or 0.0),
            "leaves_taken": int(item.get("leaves_taken", 0) or 0),
            "ai_score": _coerce_ai_score(item.get("ai_score")),
            "ai_feedback": str(item.get("ai_feedback") or ""),
            "created_at": now_iso,
        }
        for item in analyzed
    ]

    persisted: list[dict[str, Any]] = []
    if rows_to_insert:
        insert_res = supabase.table("attendance_reports").insert(rows_to_insert).execute()
        persisted = getattr(insert_res, "data", None) or rows_to_insert

    return AttendanceReportBatchResponse(
        batch_id=batch_id,
        reports=[AttendanceReportOut(**row) for row in persisted],
    )


@router.get("/reports", response_model=AttendanceReportBatchResponse)
def get_attendance_reports(
    batch_id: uuid.UUID | None = Query(default=None),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> AttendanceReportBatchResponse:
    """Fetch a specific AI attendance report batch or the latest batch."""
    resolved_batch_id, rows = _fetch_report_batch(
        supabase,
        str(batch_id) if batch_id is not None else None,
    )
    return AttendanceReportBatchResponse(
        batch_id=resolved_batch_id,
        reports=[AttendanceReportOut(**row) for row in rows],
    )


@router.get("/reports/pdf")
def download_attendance_reports_pdf(
    batch_id: uuid.UUID | None = Query(default=None),
    _hr: CurrentUser = Depends(require_hr),
    supabase: Client = Depends(get_supabase),
) -> Response:
    """Generate and stream a landscape PDF of the requested or latest attendance report batch."""
    _resolved_batch_id, rows = _fetch_report_batch(
        supabase,
        str(batch_id) if batch_id is not None else None,
    )
    pdf_bytes = build_attendance_pdf(rows)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="attendance_report.pdf"'},
    )
