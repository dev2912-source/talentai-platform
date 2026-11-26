from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client

from app.db import get_supabase


@dataclass
class CurrentUser:
    """Authenticated user profile resolved from Supabase JWT and profiles table."""

    id: str
    email: str
    username: str
    is_hr: bool
    department: str
    salary: float
    leave_balance: int
    attendance_score: int


bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "Invalid or missing authentication credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    supabase: Client = Depends(get_supabase),
) -> CurrentUser:
    """Validate Bearer JWT with Supabase Auth and load the user's profile row."""
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise _unauthorized("Missing authentication token")

    try:
        auth_res = supabase.auth.get_user(credentials.credentials)
    except Exception as exc:
        raise _unauthorized("Invalid authentication token") from exc

    auth_user = getattr(auth_res, "user", None)
    if auth_user is None:
        raise _unauthorized("Invalid authentication token")

    user_id = str(auth_user.id)
    profile_res = (
        supabase.table("profiles")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    profile = getattr(profile_res, "data", None)
    if not profile:
        raise _unauthorized("User profile not found")

    return CurrentUser(
        id=str(profile.get("id") or user_id),
        email=str(profile.get("email") or getattr(auth_user, "email", "") or ""),
        username=str(profile.get("username") or ""),
        is_hr=bool(profile.get("is_hr", False)),
        department=str(profile.get("department") or "General"),
        salary=float(profile.get("salary") or 0.0),
        leave_balance=int(profile.get("leave_balance") or 0),
        attendance_score=int(profile.get("attendance_score") or 0),
    )


def require_hr(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Enforce HR-only route access."""
    if not user.is_hr:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="HR access required",
        )
    return user


def require_employee(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Enforce Employee-only route access."""
    if user.is_hr:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Employee access required",
        )
    return user
