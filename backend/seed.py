from typing import Any

from supabase import Client

from app.db import get_supabase

DEMO_USERS: list[dict[str, Any]] = [
    {
        "email": "admin@company.com",
        "password": "admin123",
        "username": "admin",
        "is_hr": True,
        "department": "Human Resources",
        "salary": 50000.00,
        "leave_balance": 10,
        "attendance_score": 100,
    },
    {
        "email": "john@company.com",
        "password": "pass123",
        "username": "john",
        "is_hr": False,
        "department": "Engineering",
        "salary": 85000.00,
        "leave_balance": 14,
        "attendance_score": 95,
    },
]

DEMO_POLICIES: list[dict[str, str]] = [
    {
        "title": "Work From Home Policy",
        "content": (
            "Employees in the Engineering department are allowed to work from home up to 3 days a week. "
            "Tuesdays and Thursdays are mandatory office days for all-hands meetings. "
            "Equipment provided by the company must remain at the primary remote workspace."
        ),
    },
    {
        "title": "Leave Policy",
        "content": (
            "All full-time employees are entitled to 20 days of paid time off (PTO) per year. "
            "Sick leave is unlimited but requires a doctor's note for absences longer than 3 consecutive days. "
            "Leaves must be requested at least 2 weeks in advance via the HR portal."
        ),
    },
    {
        "title": "Reimbursement Policy",
        "content": (
            "Internet and home office expenses can be reimbursed up to $100 per month. "
            "Travel for conferences must be pre-approved by the department head. "
            "Receipts are mandatory for all expense claims."
        ),
    },
]

DEMO_FAQS: list[dict[str, str]] = [
    {
        "question": "How do I request a new laptop?",
        "answer": (
            "You can request a new laptop by opening a ticket in the IT Helpdesk portal. "
            "Hardware upgrades are typically approved if your current machine is older than 3 years."
        ),
    },
    {
        "question": "What is the process for performance reviews?",
        "answer": (
            "Performance reviews are conducted bi-annually in June and December. "
            "You will receive a self-evaluation form two weeks prior to your manager 1-on-1."
        ),
    },
    {
        "question": "When is payday?",
        "answer": "Salaries are disbursed on the 15th and the last working day of every month.",
    },
]


def _list_auth_users(supabase: Client) -> list[Any]:
    """Return auth users across supabase-py response shapes."""
    response = supabase.auth.admin.list_users()
    if isinstance(response, list):
        return response
    return getattr(response, "users", []) or []


def ensure_user(supabase: Client, user_spec: dict[str, Any]) -> str:
    """Idempotently create an auth user and matching profiles row."""
    email = user_spec["email"]
    existing_users = _list_auth_users(supabase)
    existing = next((u for u in existing_users if getattr(u, "email", None) == email), None)

    metadata = {
        "username": user_spec["username"],
        "is_hr": user_spec["is_hr"],
        "department": user_spec["department"],
        "salary": user_spec["salary"],
        "leave_balance": user_spec["leave_balance"],
        "attendance_score": user_spec["attendance_score"],
    }

    if existing is not None:
        user_id = str(existing.id)
    else:
        created = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": user_spec["password"],
                "email_confirm": True,
                "user_metadata": metadata,
            }
        )
        user_id = str(created.user.id)

    profile_row = {"id": user_id, "email": email, **metadata}
    supabase.table("profiles").upsert(profile_row, on_conflict="id").execute()
    return user_id


def _ensure_records(
    supabase: Client,
    table_name: str,
    unique_field: str,
    records: list[dict[str, str]],
) -> int:
    """Insert missing records idempotently by a unique text column."""
    existing_res = supabase.table(table_name).select(unique_field).execute()
    existing_keys = {row[unique_field] for row in (getattr(existing_res, "data", None) or [])}
    missing = [record for record in records if record[unique_field] not in existing_keys]
    if missing:
        supabase.table(table_name).insert(missing).execute()
    return len(missing)


def seed_database(supabase: Client) -> dict[str, int]:
    """Seed demo users, company policies, and FAQs idempotently."""
    for user_spec in DEMO_USERS:
        ensure_user(supabase, user_spec)

    policies_added = _ensure_records(supabase, "company_policies", "title", DEMO_POLICIES)
    faqs_added = _ensure_records(supabase, "faqs", "question", DEMO_FAQS)
    return {
        "users_ensured": len(DEMO_USERS),
        "policies_added": policies_added,
        "faqs_added": faqs_added,
    }


def main() -> None:
    """CLI entrypoint for seeding Supabase with demo TalentAI data."""
    supabase = get_supabase()
    summary = seed_database(supabase)
    print(
        f"Seed complete: {summary['users_ensured']} users ensured, "
        f"{summary['policies_added']} policies added, {summary['faqs_added']} FAQs added."
    )


if __name__ == "__main__":
    main()
