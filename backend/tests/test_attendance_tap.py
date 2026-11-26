import io
import json
import math
from types import SimpleNamespace

import openpyxl
import pandas as pd

from app.ai import attendance as attendance_ai


class _FakeLLM:
    def __init__(self, response_text: str):
        self._response_text = response_text

    def invoke(self, _messages):
        return SimpleNamespace(content=self._response_text)


def _make_timesheet_xlsx_bytes() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Employee Name", "Login Time", "Logout Time"])
    ws.append(["Alice Johnson", "2026-06-18 09:00:00", "2026-06-18 17:30:00"])
    ws.append(["Alice Johnson", "2026-06-19 09:00:00", "2026-06-19 17:00:00"])
    ws.append(["Bob Smith", "2026-06-18 09:00:00", "2026-06-18 17:00:00"])
    ws.append(["Bob Smith", None, None])  # 1 leave
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_hardware_tap_alternates_in_and_out_for_same_day(client, mock_supabase):
    # Tap #1 on 2026-06-19 -> IN
    res1 = client.post(
        "/api/attendance/tap",
        json={
            "employeeId": "EMP-8472",
            "timestamp": "2026-06-19T09:00:00Z",
            "deviceType": "rfid_scanner",
            "location": "Main Entrance Gate",
        },
    )
    assert res1.status_code == 201
    body1 = res1.json()
    assert body1["status"] == "success"
    assert body1["data"]["employeeId"] == "EMP-8472"
    assert body1["data"]["tapType"] == "IN"
    assert body1["data"]["tapNumber"] == 1

    # Tap #2 on same day -> OUT
    res2 = client.post(
        "/api/attendance/tap",
        json={
            "employeeId": "EMP-8472",
            "timestamp": "2026-06-19T17:30:00Z",
            "deviceType": "rfid_scanner",
            "location": "Main Entrance Gate",
        },
    )
    assert res2.status_code == 201
    body2 = res2.json()
    assert body2["data"]["tapType"] == "OUT"
    assert body2["data"]["tapNumber"] == 2

    # Tap #3 on next day -> resets to IN
    res3 = client.post(
        "/api/attendance/tap",
        json={
            "employeeId": "EMP-8472",
            "timestamp": "2026-06-20T09:00:00Z",
        },
    )
    assert res3.status_code == 201
    body3 = res3.json()
    assert body3["data"]["tapType"] == "IN"
    assert body3["data"]["tapNumber"] == 1
    assert len(mock_supabase.tables["attendance_logs"]) == 3


def test_hardware_tap_missing_employee_id_returns_400(client):
    res_missing = client.post("/api/attendance/tap", json={"location": "Side Door"})
    assert res_missing.status_code == 400

    res_blank = client.post("/api/attendance/tap", json={"employeeId": "   "})
    assert res_blank.status_code == 400


def test_attendance_logs_rbac_hr_vs_employee(client, hr_headers, employee_headers):
    client.post(
        "/api/attendance/tap",
        json={"employeeId": "EMP-22222222", "timestamp": "2026-06-19T09:00:00Z"},
    )
    client.post(
        "/api/attendance/tap",
        json={"employeeId": "EMP-9999", "timestamp": "2026-06-19T09:05:00Z"},
    )

    unauth = client.get("/api/attendance/logs")
    assert unauth.status_code == 401

    emp_res = client.get("/api/attendance/logs", headers=employee_headers)
    assert emp_res.status_code == 200
    emp_logs = emp_res.json()
    assert len(emp_logs) == 1
    assert emp_logs[0]["employee_id"] == "EMP-22222222"

    hr_res = client.get("/api/attendance/logs", headers=hr_headers)
    assert hr_res.status_code == 200
    hr_logs = hr_res.json()
    assert len(hr_logs) == 2


def test_export_excel_requires_hr_and_returns_valid_xlsx(client, hr_headers, employee_headers):
    client.post(
        "/api/attendance/tap",
        json={"employeeId": "EMP-1001", "timestamp": "2026-06-19T09:00:00Z"},
    )
    client.post(
        "/api/attendance/tap",
        json={"employeeId": "EMP-1001", "timestamp": "2026-06-19T17:00:00Z"},
    )

    emp_res = client.get("/api/attendance/export-excel", headers=employee_headers)
    assert emp_res.status_code == 403

    hr_res = client.get("/api/attendance/export-excel", headers=hr_headers)
    assert hr_res.status_code == 200
    assert (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        in hr_res.headers["content-type"]
    )

    wb = openpyxl.load_workbook(io.BytesIO(hr_res.content))
    ws = wb["Attendance Logs"]
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0] == ("#", "Employee ID", "Date", "Time", "Tap Type", "Device Type", "Location")
    tap_types = {row[4] for row in rows[1:]}
    assert tap_types == {"CHECK-IN", "CHECK-OUT"}


def test_upload_timesheet_and_download_pdf_report(client, mock_supabase, hr_headers, employee_headers, monkeypatch):
    llm_payload = json.dumps([
        {
            "name": "Alice Johnson",
            "total_hours": 16.5,
            "leaves_taken": 0,
            "ai_score": 96,
            "ai_feedback": "Excellent punctuality with zero unplanned leaves.",
        },
        {
            "name": "Bob Smith",
            "total_hours": 8.0,
            "leaves_taken": 1,
            "ai_score": 82,
            "ai_feedback": "Solid attendance with one recorded leave.",
        },
    ])
    monkeypatch.setattr(attendance_ai, "get_llm", lambda temperature=0.2: _FakeLLM(llm_payload))

    xlsx_bytes = _make_timesheet_xlsx_bytes()

    emp_res = client.post(
        "/api/attendance/upload",
        headers=employee_headers,
        files={"file": ("timesheet.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert emp_res.status_code == 403

    bad_ext = client.post(
        "/api/attendance/upload",
        headers=hr_headers,
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert bad_ext.status_code == 400

    upload_res = client.post(
        "/api/attendance/upload",
        headers=hr_headers,
        files={"file": ("timesheet.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert upload_res.status_code == 200
    body = upload_res.json()
    batch_id = body["batch_id"]
    assert batch_id
    assert len(body["reports"]) == 2
    assert body["reports"][0]["ai_score"] in (96, 82)
    assert len(mock_supabase.tables["attendance_reports"]) == 2

    reports_res = client.get(f"/api/attendance/reports?batch_id={batch_id}", headers=hr_headers)
    assert reports_res.status_code == 200
    assert reports_res.json()["batch_id"] == batch_id
    assert len(reports_res.json()["reports"]) == 2

    latest_res = client.get("/api/attendance/reports", headers=hr_headers)
    assert latest_res.status_code == 200
    assert len(latest_res.json()["reports"]) == 2

    emp_pdf = client.get("/api/attendance/reports/pdf", headers=employee_headers)
    assert emp_pdf.status_code == 403

    pdf_res = client.get(f"/api/attendance/reports/pdf?batch_id={batch_id}", headers=hr_headers)
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")


def test_generate_attendance_report_llm_fallback(monkeypatch):
    def _broken_llm(temperature=0.2):
        raise RuntimeError("OpenRouter unavailable")

    monkeypatch.setattr(attendance_ai, "get_llm", _broken_llm)
    report = attendance_ai.generate_attendance_report(_make_timesheet_xlsx_bytes())
    assert len(report) == 2
    by_name = {item["name"]: item for item in report}
    assert by_name["Alice Johnson"]["total_hours"] == 16.5
    assert by_name["Alice Johnson"]["leaves_taken"] == 0
    assert by_name["Bob Smith"]["total_hours"] == 8.0
    assert by_name["Bob Smith"]["leaves_taken"] == 1
    assert by_name["Alice Johnson"]["ai_score"] is None
    assert "Error generating feedback" in by_name["Alice Johnson"]["ai_feedback"]


def test_working_date_column_and_empty_string_cells_do_not_poison_hours():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Employee Name", "Working Date", "Login Time", "Logout Time"])
    ws.append(["Alice Johnson", "2026-06-18", "2026-06-18 09:00:00", "2026-06-18 17:30:00"])
    ws.append(["Alice Johnson", "2026-06-19", "", ""])  # blank strings -> leave
    ws.append(["Alice Johnson", "2026-06-20", "   ", "   "])  # whitespace strings -> leave
    buf = io.BytesIO()
    wb.save(buf)

    summary = attendance_ai.process_excel_data(buf.getvalue())
    assert len(summary) == 1
    alice = summary[0]
    assert alice["name"] == "Alice Johnson"
    assert math.isfinite(alice["total_hours"])
    assert alice["total_hours"] == 8.5
    assert alice["leaves_taken"] == 2
    assert attendance_ai._coerce_timestamp(pd.NaT) is None
    assert attendance_ai._coerce_timestamp("") is None
    assert attendance_ai._coerce_timestamp("   ") is None


def test_empty_timesheet_skips_llm_and_corrupt_xlsx_returns_400(client, hr_headers, monkeypatch):
    def _should_not_be_called(temperature=0.2):
        raise AssertionError("LLM should not be called for empty timesheet")

    monkeypatch.setattr(attendance_ai, "get_llm", _should_not_be_called)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Employee Name", "Login Time", "Logout Time"])
    buf = io.BytesIO()
    wb.save(buf)

    assert attendance_ai.generate_attendance_report(buf.getvalue()) == []

    corrupt_res = client.post(
        "/api/attendance/upload",
        headers=hr_headers,
        files={
            "file": (
                "corrupt.xlsx",
                b"PK\x03\x04not-a-valid-zip-or-xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert corrupt_res.status_code == 400
