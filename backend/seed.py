from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from supabase import Client

from app.db import get_supabase

DEMO_USERS: list[dict[str, Any]] = [
    {
        "email": "admin@company.com",
        "password": "admin123",
        "username": "Ananya Sharma",
        "is_hr": True,
        "department": "Human Resources",
        "salary": 1800000.00,
        "leave_balance": 18,
        "attendance_score": 100,
    },
    {
        "email": "rohan@company.com",
        "password": "pass123",
        "username": "Rohan Kulkarni",
        "is_hr": False,
        "department": "Engineering",
        "salary": 1650000.00,
        "leave_balance": 16,
        "attendance_score": 96,
    },
    {
        "email": "priya.nair@company.com",
        "password": "pass123",
        "username": "Priya Nair",
        "is_hr": False,
        "department": "Product",
        "salary": 1500000.00,
        "leave_balance": 15,
        "attendance_score": 94,
    },
    {
        "email": "vikram.d@company.com",
        "password": "pass123",
        "username": "Vikram Deshmukh",
        "is_hr": False,
        "department": "Engineering",
        "salary": 1400000.00,
        "leave_balance": 12,
        "attendance_score": 92,
    },
    {
        "email": "kavya.iyer@company.com",
        "password": "pass123",
        "username": "Kavya Iyer",
        "is_hr": False,
        "department": "Design",
        "salary": 1250000.00,
        "leave_balance": 14,
        "attendance_score": 98,
    },
]

DEMO_POLICIES: list[dict[str, str]] = [
    {
        "title": "Hybrid & Work From Home Policy",
        "content": (
            "Employees across Bengaluru, Pune, and Hyderabad hubs may work from home up to 3 days a week. "
            "Tuesdays and Thursdays are mandatory office days for sprint syncs and team collaboration. "
            "Core IST collaboration hours are 10:30 AM to 6:30 PM."
        ),
    },
    {
        "title": "Annual, Casual & Sick Leave Policy",
        "content": (
            "All full-time employees receive 18 Earned Leaves (EL) and 6 Casual/Sick Leaves (CL/SL) per calendar year, "
            "in addition to 10 gazetted Indian public holidays including Republic Day, Holi, Independence Day, Gandhi Jayanti, and Diwali. "
            "Medical certificates are required for sick leave exceeding 3 consecutive days."
        ),
    },
    {
        "title": "Broadband & Home Office Reimbursement Policy",
        "content": (
            "Fiber broadband and home-office utilities can be reimbursed up to INR 2,500 per month with valid GST invoices. "
            "Outstation business travel requires prior approval from the department head and must be submitted by the 20th of each month."
        ),
    },
    {
        "title": "Medical Insurance & Gratuity Policy",
        "content": (
            "All full-time employees are covered under Group Mediclaim up to INR 5,00,000 for self, spouse, and two dependent children. "
            "Statutory Employee Provident Fund (12% EPF) and Gratuity benefits apply as per Indian labour regulations."
        ),
    },
]

DEMO_FAQS: list[dict[str, str]] = [
    {
        "question": "How do I request a new laptop or WFH monitor?",
        "answer": (
            "Raise a ticket on the IT Helpdesk portal with your manager's approval. "
            "Bengaluru and Pune IT teams dispatch hardware within 3 to 5 working days, and laptops are eligible for upgrade after 3 years."
        ),
    },
    {
        "question": "When is the annual appraisal and salary revision cycle?",
        "answer": (
            "Annual performance appraisals take place in March and April aligned with the Indian financial year (FY), "
            "with a formal mid-year check-in conducted in October."
        ),
    },
    {
        "question": "When is payday and where do I get Form 16?",
        "answer": (
            "Salaries are credited via NEFT/IMPS on the last working day of every month. "
            "Monthly payslips and annual Form 16 tax statements can be downloaded from the Payroll portal."
        ),
    },
    {
        "question": "How do I claim broadband or travel reimbursement?",
        "answer": (
            "Upload your GST bills in the Expense section before the 20th of the month. "
            "Approved claims up to INR 2,500/month for broadband are credited alongside your monthly salary."
        ),
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


def _table_is_empty(supabase: Client, table_name: str) -> bool:
    """Return True when a table currently has zero rows."""
    res = supabase.table(table_name).select("id").execute()
    return len(getattr(res, "data", None) or []) == 0


def seed_demo_workspace_data(supabase: Client, user_ids: dict[str, str]) -> None:
    """Populate realistic Indian demo workspace records when tables are empty."""
    hr_id = user_ids.get("admin@company.com")
    rohan_id = user_ids.get("rohan@company.com")
    priya_id = user_ids.get("priya.nair@company.com")
    vikram_id = user_ids.get("vikram.d@company.com")

    if _table_is_empty(supabase, "job_postings"):
        job_id = str(uuid.uuid4())
        supabase.table("job_postings").insert(
            {
                "id": job_id,
                "title": "Senior Full-Stack Engineer (Bengaluru / Hybrid)",
                "department": "Engineering",
                "description": (
                    "Build scalable FastAPI microservices, responsive Next.js App Router dashboards, "
                    "and AI-powered RAG pipelines with PostgreSQL and pgvector for our Bengaluru engineering hub."
                ),
                "required_skills": "Python, FastAPI, Next.js, TypeScript, PostgreSQL",
                "experience_years": 3,
                "status": "pending_approval",
                "created_by": hr_id,
            }
        ).execute()

        if _table_is_empty(supabase, "candidates"):
            supabase.table("candidates").insert(
                [
                    {
                        "job_id": job_id,
                        "name": "Aarav Mehta",
                        "email": "aarav.mehta@example.com",
                        "match_score": 92.5,
                        "matched_skills": "Python, FastAPI, Next.js, TypeScript, PostgreSQL, pgvector",
                        "interview_slot": "Thu 11:00 AM IST (Bengaluru / Google Meet)",
                        "email_subject": "Interview Invitation: Senior Full-Stack Engineer (Bengaluru / Hybrid)",
                        "email_body": (
                            "Dear Aarav,\n\nWe reviewed your profile and were impressed by your FastAPI and pgvector "
                            "experience in Bengaluru. We would love to invite you for a technical discussion on Thu at 11:00 AM IST.\n\n"
                            "Best regards,\nAnanya Sharma\nTalentAI HR Team"
                        ),
                        "resume_source": "aarav_mehta_fullstack.txt",
                        "email_sent": False,
                        "status": "email_drafted",
                    },
                    {
                        "job_id": job_id,
                        "name": "Neha Deshmukh",
                        "email": "neha.deshmukh@example.com",
                        "match_score": 84.0,
                        "matched_skills": "Python, FastAPI, PostgreSQL, Docker, REST APIs",
                        "interview_slot": "Fri 03:30 PM IST (Google Meet)",
                        "email_subject": "Interview Invitation: Senior Full-Stack Engineer (Bengaluru / Hybrid)",
                        "email_body": (
                            "Dear Neha,\n\nThank you for applying from Pune. Your Python and PostgreSQL backend experience "
                            "stands out, and we would like to schedule an interview for Friday at 03:30 PM IST.\n\n"
                            "Best regards,\nAnanya Sharma\nTalentAI HR Team"
                        ),
                        "resume_source": "neha_deshmukh_backend.txt",
                        "email_sent": False,
                        "status": "shortlisted",
                    },
                ]
            ).execute()

    if _table_is_empty(supabase, "attendance_logs"):
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=4, minute=0, second=0, microsecond=0)
        supabase.table("attendance_logs").insert(
            [
                {
                    "employee_id": "EMP-0001",
                    "timestamp": today_start.isoformat(),
                    "device_type": "rfid_scanner",
                    "location": "Bengaluru HQ - Outer Ring Road",
                    "tap_type": "IN",
                },
                {
                    "employee_id": "EMP-0002",
                    "timestamp": (today_start + timedelta(minutes=15)).isoformat(),
                    "device_type": "biometric",
                    "location": "Pune Tech Park - Gate 2",
                    "tap_type": "IN",
                },
                {
                    "employee_id": "EMP-0003",
                    "timestamp": (today_start + timedelta(minutes=25)).isoformat(),
                    "device_type": "mobile_nfc",
                    "location": "Hyderabad HITEC Hub",
                    "tap_type": "IN",
                },
            ]
        ).execute()

    if _table_is_empty(supabase, "attendance_reports"):
        batch_id = str(uuid.uuid4())
        supabase.table("attendance_reports").insert(
            [
                {
                    "batch_id": batch_id,
                    "employee_name": "Rohan Kulkarni",
                    "total_hours": 17.75,
                    "leaves_taken": 1,
                    "ai_score": 92,
                    "ai_feedback": "Consistent IST login discipline with 1 planned casual leave on Tuesday.",
                },
                {
                    "batch_id": batch_id,
                    "employee_name": "Ananya Iyer",
                    "total_hours": 26.35,
                    "leaves_taken": 0,
                    "ai_score": 98,
                    "ai_feedback": "Excellent punctuality across all 3 Bengaluru office & hybrid days.",
                },
            ]
        ).execute()

    if _table_is_empty(supabase, "performance_records") and rohan_id and priya_id and vikram_id:
        perf_batch = str(uuid.uuid4())
        supabase.table("performance_records").insert(
            [
                {
                    "batch_id": perf_batch,
                    "employee_id": rohan_id,
                    "employee_name": "Rohan Kulkarni",
                    "employee_email": "rohan@company.com",
                    "department": "Engineering",
                    "review_period": "Q4 FY2026",
                    "kpi_data": "Tasks: 46/45, Quality: 94%, Mentored 2 junior engineers in Bengaluru squad",
                    "performance_score": 94,
                    "kpi_achievement_percent": 102.2,
                    "strengths": "High code ownership, FastAPI optimization, and mentoring junior teammates.",
                    "areas_for_improvement": "Document architecture decisions earlier during sprint planning.",
                    "recommended_actions": "Nominate for Senior Tech Lead track in the April appraisal cycle.",
                },
                {
                    "batch_id": perf_batch,
                    "employee_id": priya_id,
                    "employee_name": "Priya Nair",
                    "employee_email": "priya.nair@company.com",
                    "department": "Product",
                    "review_period": "Q4 FY2026",
                    "kpi_data": "Tasks: 42/45, Quality: 91%, Led UPI & payment gateway API rollout",
                    "performance_score": 90,
                    "kpi_achievement_percent": 93.3,
                    "strengths": "Strong cross-functional alignment across Engineering and Design teams.",
                    "areas_for_improvement": "Share post-launch adoption metrics one week earlier.",
                    "recommended_actions": "Lead Q1 enterprise onboarding roadmap.",
                },
                {
                    "batch_id": perf_batch,
                    "employee_id": vikram_id,
                    "employee_name": "Vikram Deshmukh",
                    "employee_email": "vikram.d@company.com",
                    "department": "Engineering",
                    "review_period": "Q4 FY2026",
                    "kpi_data": "Tasks: 38/40, Quality: 88%, Shipped Q3 onboarding flow ahead of schedule",
                    "performance_score": 88,
                    "kpi_achievement_percent": 95.0,
                    "strengths": "Reliable sprint delivery and thorough automated test coverage.",
                    "areas_for_improvement": "Expand experience with pgvector indexing and query tuning.",
                    "recommended_actions": "Pair with Rohan on Q1 RAG search optimization.",
                },
            ]
        ).execute()


def seed_database(supabase: Client) -> dict[str, int]:
    """Seed demo users, company policies, FAQs, and initial Indian demo workspace data."""
    user_ids: dict[str, str] = {}
    for user_spec in DEMO_USERS:
        user_ids[user_spec["email"]] = ensure_user(supabase, user_spec)

    policies_added = _ensure_records(supabase, "company_policies", "title", DEMO_POLICIES)
    faqs_added = _ensure_records(supabase, "faqs", "question", DEMO_FAQS)
    seed_demo_workspace_data(supabase, user_ids)
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
