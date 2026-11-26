from copy import deepcopy
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db import get_supabase
from app.deps import CurrentUser
from app.main import app


HR_USER_ID = "11111111-1111-1111-1111-111111111111"
EMPLOYEE_USER_ID = "22222222-2222-2222-2222-222222222222"

DEFAULT_PROFILES = [
    {
        "id": HR_USER_ID,
        "username": "admin",
        "email": "admin@company.com",
        "is_hr": True,
        "department": "Human Resources",
        "salary": 50000.0,
        "leave_balance": 10,
        "attendance_score": 100,
    },
    {
        "id": EMPLOYEE_USER_ID,
        "username": "john",
        "email": "john@company.com",
        "is_hr": False,
        "department": "Engineering",
        "salary": 85000.0,
        "leave_balance": 14,
        "attendance_score": 95,
    },
]

TOKEN_USER_MAP = {
    "test-hr-token": SimpleNamespace(id=HR_USER_ID, email="admin@company.com"),
    "test-employee-token": SimpleNamespace(id=EMPLOYEE_USER_ID, email="john@company.com"),
}


class FakeAdminAuth:
    def __init__(self, users: list[Any]):
        self._users = users

    def list_users(self):
        return list(self._users)

    def create_user(self, attributes: dict[str, Any]):
        new_id = f"seeded-{len(self._users) + 1}"
        user = SimpleNamespace(
            id=new_id,
            email=attributes["email"],
            user_metadata=attributes.get("user_metadata", {}),
        )
        self._users.append(user)
        return SimpleNamespace(user=user)


class FakeAuth:
    def __init__(self):
        self.admin = FakeAdminAuth([])

    def get_user(self, token: str):
        user = TOKEN_USER_MAP.get(token)
        if not user:
            raise ValueError("Invalid or expired token")
        return SimpleNamespace(user=user)


class FakeQueryBuilder:
    def __init__(self, tables: dict[str, list[dict[str, Any]]], table_name: str):
        self._tables = tables
        self._table_name = table_name
        self._op = "select"
        self._filters: list[tuple[str, str, Any]] = []
        self._payload: Any = None
        self._single = False
        self._maybe_single = False
        self._order_by: tuple[str, bool] | None = None
        self._limit: int | None = None

    def select(self, *_args, **_kwargs):
        self._op = "select"
        return self

    def insert(self, payload: dict[str, Any] | list[dict[str, Any]]):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: dict[str, Any]):
        self._op = "update"
        self._payload = payload
        return self

    def upsert(self, payload: dict[str, Any] | list[dict[str, Any]], on_conflict: str | None = None):
        self._op = "upsert"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, column: str, value: Any):
        self._filters.append(("eq", column, value))
        return self

    def in_(self, column: str, values: list[Any]):
        self._filters.append(("in", column, values))
        return self

    def order(self, column: str, desc: bool = False):
        self._order_by = (column, desc)
        return self

    def limit(self, count: int):
        self._limit = count
        return self

    def single(self):
        self._single = True
        return self

    def maybe_single(self):
        self._maybe_single = True
        return self

    def _matches(self, row: dict[str, Any]) -> bool:
        for op, col, val in self._filters:
            if op == "eq" and row.get(col) != val:
                return False
            if op == "in" and row.get(col) not in val:
                return False
        return True

    def execute(self):
        rows = self._tables.setdefault(self._table_name, [])

        if self._op == "select":
            matched = [deepcopy(r) for r in rows if self._matches(r)]
            if self._order_by:
                col, desc = self._order_by
                matched.sort(key=lambda r: r.get(col) or "", reverse=desc)
            if self._limit is not None:
                matched = matched[: self._limit]
            if self._single:
                if not matched:
                    raise ValueError(f"No row found in {self._table_name}")
                return SimpleNamespace(data=matched[0])
            if self._maybe_single:
                return SimpleNamespace(data=matched[0] if matched else None)
            return SimpleNamespace(data=matched)

        if self._op == "insert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = [deepcopy(item) for item in items]
            rows.extend(inserted)
            return SimpleNamespace(data=inserted)

        if self._op == "update":
            updated = []
            for row in rows:
                if self._matches(row):
                    row.update(deepcopy(self._payload))
                    updated.append(deepcopy(row))
            return SimpleNamespace(data=updated)

        if self._op == "upsert":
            items = self._payload if isinstance(self._payload, list) else [self._payload]
            upserted = []
            for item in items:
                existing = next((r for r in rows if r.get("id") == item.get("id") and item.get("id") is not None), None)
                if existing is not None:
                    existing.update(deepcopy(item))
                    upserted.append(deepcopy(existing))
                else:
                    new_row = deepcopy(item)
                    rows.append(new_row)
                    upserted.append(deepcopy(new_row))
            return SimpleNamespace(data=upserted)

        if self._op == "delete":
            kept = []
            deleted = []
            for row in rows:
                if self._matches(row):
                    deleted.append(deepcopy(row))
                else:
                    kept.append(row)
            self._tables[self._table_name] = kept
            return SimpleNamespace(data=deleted)

        return SimpleNamespace(data=[])


class FakeSupabaseClient:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {
            "profiles": deepcopy(DEFAULT_PROFILES),
            "job_postings": [],
            "candidates": [],
            "resume_chunks": [],
            "company_policies": [],
            "faqs": [],
            "performance_records": [],
            "attendance_logs": [],
            "attendance_reports": [],
        }
        self.auth = FakeAuth()

    def table(self, name: str) -> FakeQueryBuilder:
        return FakeQueryBuilder(self.tables, name)


@pytest.fixture
def mock_supabase() -> FakeSupabaseClient:
    return FakeSupabaseClient()


@pytest.fixture
def client(mock_supabase: FakeSupabaseClient):
    app.dependency_overrides[get_supabase] = lambda: mock_supabase
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def hr_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-hr-token"}


@pytest.fixture
def employee_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-employee-token"}


@pytest.fixture
def hr_user() -> CurrentUser:
    return CurrentUser(**DEFAULT_PROFILES[0])


@pytest.fixture
def employee_user() -> CurrentUser:
    return CurrentUser(**DEFAULT_PROFILES[1])
