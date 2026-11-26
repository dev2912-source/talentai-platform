import io
import json
from types import SimpleNamespace

import openpyxl

from app.ai import performance as performance_ai
from app.services.exports import build_performance_pdf


class _FakeLLM:
    def __init__(self, responses: list[str]):
        self._responses = iter(responses)

    def invoke(self, _messages):
        return SimpleNamespace(content=next(self._responses))


def _make_performance_xlsx_bytes(rows: list[list[object]], headers: list[str] | None = None) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers or ["Employee Name", "Tasks Completed", "KPI Target", "Manager Notes"])
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_performance_upload_matches_and_autocreates_profiles_and_streams_pdf(
    client, mock_supabase, hr_headers, employee_headers, monkeypatch
):
    llm_responses = [
        json.dumps({
            "performance_score": 91,
            "kpi_achievement_percent": 94.5,
            "strengths": ["Fast delivery & high code quality", "Mentored <junior> engineers"],
            "areas_for_improvement": ["Document architecture decisions"],
            "recommended_actions": ["Lead Q3 platform migration"],
        }),
        json.dumps({
            "performance_score": 84,
            "kpi_achievement_percent": 86.0,
            "strengths": ["Strong cross-team collaboration"],
            "areas_for_improvement": ["Improve test coverage"],
            "recommended_actions": ["Complete automated testing workshop"],
        }),
    ]
    fake_llm = _FakeLLM(llm_responses)
    monkeypatch.setattr(performance_ai, "get_llm", lambda temperature=0.2: fake_llm)

    xlsx_bytes = _make_performance_xlsx_bytes([
        ["john", 48, 50, "Delivered core API ahead of schedule"],
        ["Sara Lee", 42, 50, "Solid sprint velocity"],
    ])

    emp_res = client.post(
        "/api/performance/upload",
        headers=employee_headers,
        data={"review_period": "Q2 2026"},
        files={"file": ("perf.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert emp_res.status_code == 403

    upload_res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q2 2026"},
        files={"file": ("perf.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert upload_res.status_code == 200
    body = upload_res.json()
    batch_id = body["batch_id"]
    assert batch_id
    records = body["records"]
    assert len(records) == 2

    by_name = {rec["employee_name"]: rec for rec in records}
    assert by_name["john"]["employee_id"] == "22222222-2222-2222-2222-222222222222"
    assert by_name["john"]["employee_email"] == "john@company.com"
    assert by_name["john"]["performance_score"] == 91
    assert by_name["john"]["kpi_achievement_percent"] == 94.5
    assert "Fast delivery & high code quality" in by_name["john"]["strengths"]
    assert by_name["john"]["review_period"] == "Q2 2026"

    assert "sara_lee" in by_name
    assert by_name["sara_lee"]["employee_email"] == "sara_lee@demo.com"
    assert by_name["sara_lee"]["performance_score"] == 84

    # Auto-created profile and auth user exist
    profiles = {p["username"]: p for p in mock_supabase.tables["profiles"]}
    assert "sara_lee" in profiles
    assert profiles["sara_lee"]["is_hr"] is False
    assert any(u.email == "sara_lee@demo.com" for u in mock_supabase.auth.admin.list_users())
    assert len(mock_supabase.tables["performance_records"]) == 2

    # Reports endpoint (specific batch and latest)
    emp_reports = client.get("/api/performance/reports", headers=employee_headers)
    assert emp_reports.status_code == 403

    batch_reports = client.get(f"/api/performance/reports?batch_id={batch_id}", headers=hr_headers)
    assert batch_reports.status_code == 200
    assert batch_reports.json()["batch_id"] == batch_id
    assert len(batch_reports.json()["records"]) == 2

    latest_reports = client.get("/api/performance/reports", headers=hr_headers)
    assert latest_reports.status_code == 200
    assert latest_reports.json()["batch_id"] == batch_id

    # PDF streaming endpoint
    emp_pdf = client.get("/api/performance/reports/pdf", headers=employee_headers)
    assert emp_pdf.status_code == 403

    pdf_res = client.get(f"/api/performance/reports/pdf?batch_id={batch_id}", headers=hr_headers)
    assert pdf_res.status_code == 200
    assert pdf_res.headers["content-type"] == "application/pdf"
    assert pdf_res.content.startswith(b"%PDF")


def test_performance_upload_existing_auth_user_fallback_when_profile_missing(
    client, mock_supabase, hr_headers, monkeypatch
):
    # Pre-seed an auth user without a matching profiles row
    existing = mock_supabase.auth.admin.create_user({
        "email": "alex@company.com",
        "password": "secret",
        "user_metadata": {"username": "alex"},
    })
    assert not any(p["email"] == "alex@company.com" for p in mock_supabase.tables["profiles"])

    llm_payload = json.dumps({
        "performance_score": 88,
        "kpi_achievement_percent": 90.0,
        "strengths": ["Reliable execution"],
        "areas_for_improvement": ["Proactive status updates"],
        "recommended_actions": ["Pair with senior architect"],
    })
    monkeypatch.setattr(performance_ai, "get_llm", lambda temperature=0.2: _FakeLLM([llm_payload]))

    xlsx_bytes = _make_performance_xlsx_bytes(
        [["alex@company.com", 95]],
        headers=["Employee Email", "KPI Score"],
    )
    res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "H1 2026"},
        files={"file": ("perf.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200
    records = res.json()["records"]
    assert len(records) == 1
    assert records[0]["employee_id"] == existing.user.id
    assert records[0]["employee_email"] == "alex@company.com"
    assert any(p["id"] == existing.user.id for p in mock_supabase.tables["profiles"])


def test_performance_upload_rejects_invalid_and_corrupt_excel(client, hr_headers):
    bad_ext = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q1 2026"},
        files={"file": ("notes.csv", b"name,score\njohn,90", "text/csv")},
    )
    assert bad_ext.status_code == 400

    corrupt = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q1 2026"},
        files={"file": ("corrupt.xlsx", b"not-an-excel-file", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert corrupt.status_code == 400

    missing_id_col = _make_performance_xlsx_bytes([[95, 100]], headers=["Score", "Target"])
    missing_col_res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q1 2026"},
        files={"file": ("noid.xlsx", missing_id_col, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert missing_col_res.status_code == 400


def test_build_performance_pdf_escapes_xml_characters():
    pdf_bytes = build_performance_pdf([
        {
            "employee_name": "John & Jane <QA>",
            "employee_email": "john&jane@company.com",
            "review_period": "Q1 & Q2 <2026>",
            "performance_score": 92,
            "kpi_achievement_percent": 95.0,
            "strengths": "- Fast & accurate\n- Handles <edge> cases",
            "areas_for_improvement": "- R&D documentation",
            "recommended_actions": "- Mentor A & B",
        }
    ])
    assert pdf_bytes.startswith(b"%PDF")


def test_performance_upload_does_not_overwrite_hr_user_profile(
    client, mock_supabase, hr_headers, monkeypatch
):
    def _should_not_call_llm(temperature=0.2):
        raise AssertionError("LLM should not be called for HR user row")

    monkeypatch.setattr(performance_ai, "get_llm", _should_not_call_llm)

    xlsx_bytes = _make_performance_xlsx_bytes(
        [["admin@company.com", 99]],
        headers=["Employee Email", "KPI Score"],
    )
    res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q2 2026"},
        files={"file": ("hr_perf.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 400
    assert "HR user" in res.json()["detail"]

    admin_profile = next(p for p in mock_supabase.tables["profiles"] if p["email"] == "admin@company.com")
    assert admin_profile["is_hr"] is True
    assert admin_profile["department"] == "Human Resources"
    assert admin_profile["salary"] == 50000.0
    assert admin_profile["leave_balance"] == 10
    assert admin_profile["attendance_score"] == 100
    assert mock_supabase.tables["performance_records"] == []


def test_performance_upload_existing_auth_fallback_preserves_existing_employee_profile(
    client, mock_supabase, hr_headers, monkeypatch
):
    # Pre-seed an auth user matching an existing employee profile with custom salary/leave
    existing_emp = next(p for p in mock_supabase.tables["profiles"] if p["email"] == "john@company.com")
    mock_supabase.auth._users = []
    # Force fallback by creating an auth user with john's id & email, and looking up via fallback
    mock_supabase.auth.admin._users.append(
        SimpleNamespace(id=existing_emp["id"], email="john@company.com", user_metadata={})
    )
    llm_payload = json.dumps({
        "performance_score": 90,
        "kpi_achievement_percent": 92.0,
        "strengths": ["Consistent delivery"],
        "areas_for_improvement": ["More mentoring"],
        "recommended_actions": ["Lead architecture review"],
    })
    fake_llm = _FakeLLM([llm_payload])
    monkeypatch.setattr(performance_ai, "get_llm", lambda temperature=0.2: fake_llm)

    # Match by employee_id column (UUID) to exercise id lookup + profile preservation
    xlsx_bytes = _make_performance_xlsx_bytes(
        [[existing_emp["id"], 95]],
        headers=["Employee ID", "KPI Score"],
    )
    res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q2 2026"},
        files={"file": ("emp_id.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200
    john_profile = next(p for p in mock_supabase.tables["profiles"] if p["email"] == "john@company.com")
    assert john_profile["salary"] == 85000.0
    assert john_profile["leave_balance"] == 14
    assert john_profile["attendance_score"] == 95
    assert john_profile["department"] == "Engineering"


def test_performance_upload_sets_department_when_trigger_created_default_profile(
    client, mock_supabase, hr_headers, monkeypatch
):
    # Simulate Supabase's handle_new_user trigger inserting 'General' right on create_user
    orig_create_user = mock_supabase.auth.admin.create_user

    def _create_user_with_trigger(attributes):
        res = orig_create_user(attributes)
        user = res.user
        mock_supabase.tables["profiles"].append({
            "id": user.id,
            "username": attributes.get("user_metadata", {}).get("username", "user"),
            "email": attributes["email"],
            "is_hr": False,
            "department": "General",
            "salary": 50000.0,
            "leave_balance": 10,
            "attendance_score": 100,
        })
        return res

    monkeypatch.setattr(mock_supabase.auth.admin, "create_user", _create_user_with_trigger)
    llm_payload = json.dumps({
        "performance_score": 89,
        "kpi_achievement_percent": 91.0,
        "strengths": ["Strong design sense"],
        "areas_for_improvement": ["More user research"],
        "recommended_actions": ["Lead design crit"],
    })
    monkeypatch.setattr(performance_ai, "get_llm", lambda temperature=0.2: _FakeLLM([llm_payload]))

    xlsx_bytes = _make_performance_xlsx_bytes(
        [["maya@company.com", "Design", 91]],
        headers=["Employee Email", "Department", "KPI Score"],
    )
    res = client.post(
        "/api/performance/upload",
        headers=hr_headers,
        data={"review_period": "Q3 2026"},
        files={"file": ("dept.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 200
    maya_profile = next(p for p in mock_supabase.tables["profiles"] if p["email"] == "maya@company.com")
    assert maya_profile["department"] == "Design"
    assert res.json()["records"][0]["department"] == "Design"


def test_performance_invalid_batch_uuid_returns_422(client, hr_headers):
    assert client.get("/api/performance/reports?batch_id=not-a-uuid", headers=hr_headers).status_code == 422
    assert client.get("/api/performance/reports/pdf?batch_id=not-a-uuid", headers=hr_headers).status_code == 422

