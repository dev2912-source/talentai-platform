from copy import deepcopy
from datetime import datetime, timezone
import math
import re
from types import SimpleNamespace
from typing import Any
import uuid

from dateutil import parser as dt_parser
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
        if any(getattr(u, "email", None) == attributes["email"] for u in self._users):
            raise ValueError(f"User with email {attributes['email']} already exists")
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

    def gte(self, column: str, value: Any):
        self._filters.append(("gte", column, value))
        return self

    def lte(self, column: str, value: Any):
        self._filters.append(("lte", column, value))
        return self

    def gt(self, column: str, value: Any):
        self._filters.append(("gt", column, value))
        return self

    def lt(self, column: str, value: Any):
        self._filters.append(("lt", column, value))
        return self

    def ilike(self, column: str, pattern: str):
        self._filters.append(("ilike", column, pattern))
        return self

    def or_(self, filters_str: str):
        self._filters.append(("or", "", filters_str))
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

    @staticmethod
    def _coerce_comparable(left: Any, right: Any) -> tuple[Any, Any]:
        if isinstance(left, str) and isinstance(right, str):
            try:
                l_dt = dt_parser.isoparse(left)
                r_dt = dt_parser.isoparse(right)
                if l_dt.tzinfo is None:
                    l_dt = l_dt.replace(tzinfo=timezone.utc)
                if r_dt.tzinfo is None:
                    r_dt = r_dt.replace(tzinfo=timezone.utc)
                return l_dt.astimezone(timezone.utc), r_dt.astimezone(timezone.utc)
            except (ValueError, TypeError):
                pass
        return left, right

    @staticmethod
    def _like_to_regex(pattern: str) -> re.Pattern[str]:
        parts: list[str] = ["^"]
        i = 0
        while i < len(pattern):
            ch = pattern[i]
            if ch == "\\" and i + 1 < len(pattern):
                parts.append(re.escape(pattern[i + 1]))
                i += 2
                continue
            if ch == "%":
                parts.append(".*")
            elif ch == "_":
                parts.append(".")
            else:
                parts.append(re.escape(ch))
            i += 1
        parts.append("$")
        return re.compile("".join(parts), re.IGNORECASE | re.DOTALL)

    def _matches_clause(self, row: dict[str, Any], op: str, col: str, val: Any) -> bool:
        cell = row.get(col)
        if op == "eq":
            return cell == val
        if op == "in":
            return cell in val
        if op == "ilike":
            if cell is None:
                return False
            return self._like_to_regex(str(val)).match(str(cell)) is not None
        if op in ("gte", "lte", "gt", "lt"):
            if cell is None:
                return False
            left, right = self._coerce_comparable(cell, val)
            if op == "gte":
                return bool(left >= right)
            if op == "lte":
                return bool(left <= right)
            if op == "gt":
                return bool(left > right)
            if op == "lt":
                return bool(left < right)
        return True

    def _matches(self, row: dict[str, Any]) -> bool:
        for op, col, val in self._filters:
            if op == "or":
                clauses = [c.strip() for c in str(val).split(",") if c.strip()]
                matched_any = False
                for clause in clauses:
                    parts = clause.split(".", 2)
                    if len(parts) == 3 and self._matches_clause(row, parts[1], parts[0], parts[2]):
                        matched_any = True
                        break
                if not matched_any:
                    return False
            elif not self._matches_clause(row, op, col, val):
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
            inserted = []
            for item in items:
                new_row = deepcopy(item)
                if "id" not in new_row:
                    if self._table_name == "attendance_logs":
                        max_id = max((r.get("id", 0) for r in rows if isinstance(r.get("id"), int)), default=0)
                        new_row["id"] = max_id + 1
                    else:
                        new_row["id"] = str(uuid.uuid4())
                if "created_at" not in new_row:
                    new_row["created_at"] = datetime.now(timezone.utc).isoformat()
                rows.append(new_row)
                inserted.append(deepcopy(new_row))
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


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class FakeStorageBucket:
    def __init__(self, buckets: dict[str, dict[str, bytes]], bucket_name: str):
        self._buckets = buckets
        self._bucket_name = bucket_name

    def upload(self, path: str, file: bytes, file_options: dict[str, Any] | None = None):
        bucket = self._buckets.setdefault(self._bucket_name, {})
        bucket[path] = file
        return SimpleNamespace(path=path, full_path=f"{self._bucket_name}/{path}")

    def download(self, path: str) -> bytes:
        return self._buckets.get(self._bucket_name, {})[path]

    def remove(self, paths: list[str]) -> list[dict[str, str]]:
        bucket = self._buckets.setdefault(self._bucket_name, {})
        removed = []
        for path in paths:
            if path in bucket:
                del bucket[path]
                removed.append({"name": path})
        return removed


class FakeStorage:
    def __init__(self):
        self.buckets: dict[str, dict[str, bytes]] = {"hr-uploads": {}}

    def from_(self, bucket_name: str) -> FakeStorageBucket:
        return FakeStorageBucket(self.buckets, bucket_name)


class FakeRpcQuery:
    def __init__(self, tables: dict[str, list[dict[str, Any]]], fn_name: str, params: dict[str, Any]):
        self._tables = tables
        self._fn_name = fn_name
        self._params = params

    def execute(self):
        if self._fn_name == "match_resume_chunks":
            query_embedding = self._params.get("query_embedding", [])
            match_job_id = self._params.get("match_job_id")
            match_count = int(self._params.get("match_count", 30))
            rows = [
                row for row in self._tables.get("resume_chunks", [])
                if row.get("job_id") == match_job_id
            ]
            scored = []
            for row in rows:
                sim = _cosine_similarity(query_embedding, row.get("embedding", []))
                scored.append({
                    "id": row.get("id"),
                    "source_file": row.get("source_file"),
                    "candidate_name": row.get("candidate_name"),
                    "candidate_email": row.get("candidate_email"),
                    "content": row.get("content"),
                    "similarity": sim,
                })
            scored.sort(key=lambda r: r["similarity"], reverse=True)
            return SimpleNamespace(data=scored[:match_count])
        raise ValueError(f"Unsupported fake RPC function: {self._fn_name}")


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
        self.storage = FakeStorage()

    def table(self, name: str) -> FakeQueryBuilder:
        return FakeQueryBuilder(self.tables, name)

    def rpc(self, fn_name: str, params: dict[str, Any] | None = None) -> FakeRpcQuery:
        return FakeRpcQuery(self.tables, fn_name, params or {})


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
