import io
import json
import logging
import re
from typing import Any
import zipfile

import openpyxl.utils.exceptions
import pandas as pd

from app.ai.llm import ATTENDANCE_PROMPT, get_llm

logger = logging.getLogger(__name__)


def _parse_json_array(text: str) -> list[dict[str, Any]]:
    """Parse a JSON array from LLM output, stripping optional markdown code fences."""
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
        parsed = json.loads(cleaned[start : end + 1])
        if isinstance(parsed, list):
            return parsed
    raise ValueError("LLM response did not contain a valid JSON array.")


_LOGIN_TOKENS = (
    "login",
    "check-in",
    "check_in",
    "clock in",
    "clock_in",
    "in time",
    "in_time",
    "start",
)
_LOGOUT_TOKENS = (
    "logout",
    "check-out",
    "check_out",
    "clock out",
    "clock_out",
    "out time",
    "out_time",
    "end",
)


def _find_time_column(
    columns: list[str],
    tokens: tuple[str, ...],
    boundary_pattern: str,
) -> str | None:
    """Match an explicit time column token first, falling back to word-boundary regex."""
    for token in tokens:
        match = next((c for c in columns if token in c), None)
        if match:
            return match
    return next((c for c in columns if re.search(boundary_pattern, c)), None)


def _is_blank_cell(val: Any) -> bool:
    """Return True if a spreadsheet cell is NaN/NaT/None or empty/whitespace text."""
    return bool(pd.isna(val)) or (isinstance(val, str) and not val.strip())


def _coerce_timestamp(val: Any) -> pd.Timestamp | None:
    """Convert a string, datetime, or time-like cell value into a non-NaT pandas Timestamp."""
    if _is_blank_cell(val):
        return None
    if isinstance(val, pd.Timestamp):
        return None if pd.isna(val) else val
    if isinstance(val, str):
        ts = pd.to_datetime(val.strip())
        return None if pd.isna(ts) else ts
    if hasattr(val, "hour"):
        ts = pd.to_datetime(str(val))
        return None if pd.isna(ts) else ts
    return None


def process_excel_data(file_bytes: bytes) -> list[dict[str, Any]]:
    """
    Read an Excel timesheet from bytes and compute total hours and leaves per employee.

    Expected columns (fuzzy-matched): 'Employee Name', 'Login Time', 'Logout Time'.
    """
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

    columns = [str(c).strip().lower() for c in df.columns]
    df.columns = columns

    name_col = next((c for c in columns if "name" in c), None)
    if not name_col:
        name_col = next((c for c in columns if "employee" in c and "id" not in c), None)
    if not name_col:
        name_col = next((c for c in columns if "employee" in c or "emp" in c), None)

    login_col = _find_time_column(columns, _LOGIN_TOKENS, r"\bin\b")
    logout_col = _find_time_column(columns, _LOGOUT_TOKENS, r"\bout\b")

    if not name_col:
        raise ValueError("Could not identify an 'Employee Name' column in the uploaded file.")

    results: list[dict[str, Any]] = []
    for name, group in df.groupby(name_col):
        total_hours = 0.0
        leaves_taken = 0

        for _, row in group.iterrows():
            login_val = row[login_col] if login_col else pd.NaT
            logout_val = row[logout_col] if logout_col else pd.NaT

            if _is_blank_cell(login_val) and _is_blank_cell(logout_val):
                leaves_taken += 1
                continue

            try:
                login_ts = _coerce_timestamp(login_val)
                logout_ts = _coerce_timestamp(logout_val)
                if (
                    login_ts is not None
                    and logout_ts is not None
                    and pd.notna(login_ts)
                    and pd.notna(logout_ts)
                ):
                    hours = (logout_ts - login_ts).total_seconds() / 3600.0
                    if hours < 0:
                        hours += 24
                    total_hours += hours
            except Exception as exc:
                logger.warning("Error calculating hours for %s: %s", name, exc)

        results.append({
            "name": str(name),
            "total_hours": round(total_hours, 1),
            "leaves_taken": leaves_taken,
        })

    return results


def generate_attendance_report(file_bytes: bytes) -> list[dict[str, Any]]:
    """
    Summarize an uploaded Excel timesheet with pandas and score reliability via the LLM.
    Falls back to raw hour/leave counts if the LLM call fails.
    """
    raw_data = process_excel_data(file_bytes)
    if not raw_data:
        return []

    data_str = json.dumps(raw_data, indent=2)

    try:
        llm = get_llm(temperature=0.2)
        messages = ATTENDANCE_PROMPT.format_messages(attendance_data=data_str)
        response = llm.invoke(messages)
        return _parse_json_array(str(response.content))
    except Exception as exc:
        logger.error("Error generating attendance report: %s", exc)
        return [
            {
                **item,
                "ai_score": None,
                "ai_feedback": f"Error generating feedback: {exc}",
            }
            for item in raw_data
        ]
