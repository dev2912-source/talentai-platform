import pytest
from fastapi import HTTPException

from app.config import get_settings
from app.deps import require_employee, require_hr


def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_me_requires_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_me_rejects_invalid_token(client):
    res = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid-token"})
    assert res.status_code == 401


def test_me_rejects_non_bearer_header(client):
    res = client.get("/api/auth/me", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert res.status_code == 401


def test_me_returns_profile_for_valid_user(client, hr_headers):
    res = client.get("/api/auth/me", headers=hr_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["is_hr"] is True
    assert body["email"] == "admin@company.com"
    assert body["username"] == "admin"
    assert body["department"] == "Human Resources"


def test_me_returns_profile_for_employee(client, employee_headers):
    res = client.get("/api/auth/me", headers=employee_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["is_hr"] is False
    assert body["email"] == "john@company.com"
    assert body["username"] == "john"
    assert body["department"] == "Engineering"
    assert body["salary"] == 85000.0
    assert body["leave_balance"] == 14
    assert body["attendance_score"] == 95


def test_require_hr_allows_hr_and_blocks_employee(hr_user, employee_user):
    assert require_hr(hr_user) == hr_user
    with pytest.raises(HTTPException) as exc:
        require_hr(employee_user)
    assert exc.value.status_code == 403


def test_require_employee_allows_employee_and_blocks_hr(hr_user, employee_user):
    assert require_employee(employee_user) == employee_user
    with pytest.raises(HTTPException) as exc:
        require_employee(hr_user)
    assert exc.value.status_code == 403


def test_settings_have_safe_defaults():
    settings = get_settings()
    assert settings.OPENROUTER_BASE_URL == "https://openrouter.ai/api/v1"
    assert "http://localhost:3000" in settings.frontend_origins_list


def test_me_rejects_user_without_profile(client, mock_supabase, hr_headers):
    mock_supabase.tables["profiles"] = []
    res = client.get("/api/auth/me", headers=hr_headers)
    assert res.status_code == 401


def test_seed_database_is_idempotent(mock_supabase):
    from seed import seed_database

    mock_supabase.tables["profiles"] = []
    first = seed_database(mock_supabase)
    assert first == {"users_ensured": 2, "policies_added": 3, "faqs_added": 3}
    assert len(mock_supabase.tables["profiles"]) == 2
    assert len(mock_supabase.tables["company_policies"]) == 3
    assert len(mock_supabase.tables["faqs"]) == 3

    second = seed_database(mock_supabase)
    assert second == {"users_ensured": 2, "policies_added": 0, "faqs_added": 0}
    assert len(mock_supabase.tables["profiles"]) == 2
    assert len(mock_supabase.tables["company_policies"]) == 3
    assert len(mock_supabase.tables["faqs"]) == 3

