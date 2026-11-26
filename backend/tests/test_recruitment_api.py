import json
from types import SimpleNamespace

from app.ai import recruitment_graph, vector_store
from app.services import email as email_service


class _FakeLLM:
    def __init__(self, responses: list[str]):
        self._responses = iter(responses)

    def invoke(self, _messages):
        return SimpleNamespace(content=next(self._responses))


def test_employee_forbidden_on_recruitment_endpoints(client, employee_headers):
    res = client.post(
        "/api/recruitment/screen",
        headers=employee_headers,
        data={
            "title": "Senior Python Engineer",
            "department": "Engineering",
            "description": "Build FastAPI services",
            "required_skills": "Python, FastAPI",
            "experience_years": "3",
        },
        files=[("resumes", ("alice.txt", b"Alice Doe\nalice@example.com\nPython FastAPI", "text/plain"))],
    )
    assert res.status_code == 403

    jobs_res = client.get("/api/recruitment/jobs", headers=employee_headers)
    assert jobs_res.status_code == 403


def test_screen_pipeline_pauses_at_pending_approval(client, mock_supabase, hr_headers, monkeypatch):
    monkeypatch.setattr(
        vector_store,
        "embed_texts",
        lambda texts: [[0.1] * 768 for _ in texts],
    )

    screener_json = json.dumps([
        {
            "name": "Alice Johnson",
            "email": "alice@example.com",
            "match_score": 92,
            "matched_skills": "Python, FastAPI, PostgreSQL",
            "source_file": "alice_resume.txt",
        },
        {
            "name": "Low Score",
            "email": "low@example.com",
            "match_score": 25,
            "matched_skills": "Excel",
            "source_file": "low_resume.txt",
        },
    ])
    scheduler_json = json.dumps([
        {
            "name": "Alice Johnson",
            "email": "alice@example.com",
            "interview_slot": "Monday, June 2, 2025 at 10:00 AM",
        }
    ])
    communicator_json = json.dumps([
        {
            "name": "Alice Johnson",
            "email": "alice@example.com",
            "subject": "Interview Invitation — Backend Engineer",
            "body": "Hi Alice, congratulations on being shortlisted for Monday, June 2, 2025 at 10:00 AM. Please confirm.",
        }
    ])

    fake_llm = _FakeLLM([screener_json, scheduler_json, communicator_json])
    monkeypatch.setattr(recruitment_graph, "get_llm", lambda temperature=0.2: fake_llm)

    res = client.post(
        "/api/recruitment/screen",
        headers=hr_headers,
        data={
            "title": "Backend Engineer",
            "department": "Engineering",
            "description": "Build scalable FastAPI APIs with pgvector.",
            "required_skills": "Python, FastAPI, PostgreSQL",
            "experience_years": "4",
        },
        files=[
            (
                "resumes",
                (
                    "alice_resume.txt",
                    b"Alice Johnson\nalice@example.com\n5 years Python, FastAPI, PostgreSQL",
                    "text/plain",
                ),
            ),
        ],
    )

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending_approval"
    job_id = body["job_id"]
    assert len(body["candidates"]) == 1

    cand = body["candidates"][0]
    assert cand["name"] == "Alice Johnson"
    assert cand["email"] == "alice@example.com"
    assert cand["match_score"] == 92.0
    assert cand["status"] == "email_drafted"
    assert cand["email_sent"] is False
    assert cand["interview_slot"] == "Monday, June 2, 2025 at 10:00 AM"
    assert "Interview Invitation" in cand["email_subject"]
    assert cand["resume_storage_path"].startswith(f"{job_id}/")

    # Verify Supabase Storage, pgvector chunks, job_postings, and candidates persisted
    assert len(mock_supabase.storage.buckets["hr-uploads"]) == 1
    assert len(mock_supabase.tables["resume_chunks"]) >= 1
    assert mock_supabase.tables["job_postings"][0]["status"] == "pending_approval"
    assert mock_supabase.tables["candidates"][0]["status"] == "email_drafted"


def test_approve_job_sends_approved_and_rejects_excluded(client, mock_supabase, hr_headers, monkeypatch):
    job_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    cand_approve_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    cand_reject_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"

    mock_supabase.tables["job_postings"].append({
        "id": job_id,
        "title": "ML Engineer",
        "department": "AI",
        "description": "Build LLM workflows",
        "required_skills": "Python, LangGraph",
        "experience_years": 3,
        "status": "pending_approval",
        "created_by": "11111111-1111-1111-1111-111111111111",
    })
    mock_supabase.tables["candidates"].extend([
        {
            "id": cand_approve_id,
            "job_id": job_id,
            "name": "Alice Johnson",
            "email": "alice@example.com",
            "match_score": 90.0,
            "matched_skills": "Python, LangGraph",
            "interview_slot": "Monday, June 2, 2025 at 10:00 AM",
            "email_subject": "Initial Subject",
            "email_body": "Initial Body",
            "resume_source": "alice.pdf",
            "resume_storage_path": f"{job_id}/alice.pdf",
            "email_sent": False,
            "status": "email_drafted",
        },
        {
            "id": cand_reject_id,
            "job_id": job_id,
            "name": "Bob Smith",
            "email": "bob@example.com",
            "match_score": 65.0,
            "matched_skills": "Python",
            "interview_slot": "Monday, June 2, 2025 at 10:45 AM",
            "email_subject": "Subject Bob",
            "email_body": "Body Bob",
            "resume_source": "bob.pdf",
            "resume_storage_path": f"{job_id}/bob.pdf",
            "email_sent": False,
            "status": "email_drafted",
        },
    ])

    sent_calls: list[dict[str, str]] = []

    def _fake_send(to_email: str, subject: str, body: str) -> dict[str, str]:
        sent_calls.append({"to_email": to_email, "subject": subject, "body": body})
        return {"status": "sent", "mode": "console", "to": to_email}

    monkeypatch.setattr("app.routers.recruitment.send_interview_email", _fake_send)

    # Check GET /api/recruitment/jobs and GET /api/recruitment/jobs/{job_id}
    list_res = client.get("/api/recruitment/jobs", headers=hr_headers)
    assert list_res.status_code == 200
    assert list_res.json()[0]["candidate_count"] == 2

    detail_res = client.get(f"/api/recruitment/jobs/{job_id}", headers=hr_headers)
    assert detail_res.status_code == 200
    assert detail_res.json()["job"]["id"] == job_id
    assert len(detail_res.json()["candidates"]) == 2

    # Approve Alice with edited email & slot, reject Bob
    approve_res = client.post(
        f"/api/recruitment/jobs/{job_id}/approve",
        headers=hr_headers,
        json={
            "decisions": [
                {
                    "candidate_id": cand_approve_id,
                    "approved": True,
                    "email_subject": "Updated Invite — ML Engineer",
                    "email_body": "Hi Alice, your interview is confirmed for Tuesday at 11:00 AM.",
                    "interview_slot": "Tuesday, June 3, 2025 at 11:00 AM",
                },
                {
                    "candidate_id": cand_reject_id,
                    "approved": False,
                    "email_subject": "Subject Bob",
                    "email_body": "Body Bob",
                    "interview_slot": "Monday, June 2, 2025 at 10:45 AM",
                },
            ]
        },
    )

    assert approve_res.status_code == 200
    payload = approve_res.json()
    assert payload["status"] == "approved"
    assert payload["sent_count"] == 1
    assert payload["rejected_count"] == 1

    assert len(sent_calls) == 1
    assert sent_calls[0]["to_email"] == "alice@example.com"
    assert sent_calls[0]["subject"] == "Updated Invite — ML Engineer"

    by_id = {c["id"]: c for c in mock_supabase.tables["candidates"]}
    assert by_id[cand_approve_id]["status"] == "email_sent"
    assert by_id[cand_approve_id]["email_sent"] is True
    assert by_id[cand_approve_id]["interview_slot"] == "Tuesday, June 3, 2025 at 11:00 AM"
    assert by_id[cand_reject_id]["status"] == "rejected"
    assert by_id[cand_reject_id]["email_sent"] is False
    assert mock_supabase.tables["job_postings"][0]["status"] == "approved"


def test_vector_store_splitter_and_email_console_fallback():
    long_text = "\n\n".join([f"Paragraph {i}: " + ("Python FastAPI " * 25) for i in range(6)])
    chunks = vector_store.split_text(long_text, chunk_size=800, chunk_overlap=100)
    assert len(chunks) > 1
    assert all(len(c) <= 800 for c in chunks)

    vecs = vector_store.embed_texts(["hello world"])
    assert len(vecs) == 1
    assert len(vecs[0]) == 768

    result = email_service.send_interview_email(
        to_email="candidate@example.com",
        subject="Interview",
        body="Please join.",
    )
    assert result["status"] == "sent"
    assert result["mode"] == "console"


def test_screen_returns_502_and_reverts_job_to_draft_on_llm_error(
    client, mock_supabase, hr_headers, monkeypatch
):
    monkeypatch.setattr(
        vector_store,
        "embed_texts",
        lambda texts: [[0.1] * 768 for _ in texts],
    )

    class _FailingLLM:
        def invoke(self, _messages):
            raise RuntimeError("OpenRouter upstream timeout")

    monkeypatch.setattr(recruitment_graph, "get_llm", lambda temperature=0.2: _FailingLLM())

    res = client.post(
        "/api/recruitment/screen",
        headers=hr_headers,
        data={
            "title": "Platform Engineer",
            "department": "Engineering",
            "description": "Manage cloud infrastructure",
            "required_skills": "Python, Kubernetes",
            "experience_years": "3",
        },
        files=[
            (
                "resumes",
                ("alice.txt", b"Alice Johnson\nalice@example.com\nPython Kubernetes", "text/plain"),
            ),
        ],
    )

    assert res.status_code == 502
    assert "Screening error" in res.json()["detail"]
    assert len(mock_supabase.tables["job_postings"]) == 1
    assert mock_supabase.tables["job_postings"][0]["status"] == "draft"
    assert mock_supabase.tables["candidates"] == []


def test_screen_short_circuits_when_ingestion_yields_no_docs(
    client, mock_supabase, hr_headers, monkeypatch
):
    search_called = False

    def _unexpected_search(*_args, **_kwargs):
        nonlocal search_called
        search_called = True
        return []

    monkeypatch.setattr(recruitment_graph, "search_resumes_pgvector", _unexpected_search)

    res = client.post(
        "/api/recruitment/screen",
        headers=hr_headers,
        data={
            "title": "Platform Engineer",
            "department": "Engineering",
            "description": "Manage cloud infrastructure",
            "required_skills": "Python",
            "experience_years": "2",
        },
        files=[
            ("resumes", ("blank.txt", b"   \n  ", "text/plain")),
        ],
    )

    assert res.status_code == 502
    assert search_called is False
    assert mock_supabase.tables["job_postings"][0]["status"] == "draft"


def test_approve_is_idempotent_for_already_sent_candidates(
    client, mock_supabase, hr_headers, monkeypatch
):
    job_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    cand_id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"

    mock_supabase.tables["job_postings"].append({
        "id": job_id,
        "title": "Staff Engineer",
        "department": "Engineering",
        "description": "Lead architecture",
        "required_skills": "Python, Distributed Systems",
        "experience_years": 6,
        "status": "pending_approval",
        "created_by": "11111111-1111-1111-1111-111111111111",
    })
    mock_supabase.tables["candidates"].append({
        "id": cand_id,
        "job_id": job_id,
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "match_score": 95.0,
        "matched_skills": "Python, Distributed Systems",
        "interview_slot": "Wednesday, June 4, 2025 at 10:00 AM",
        "email_subject": "Initial Subject",
        "email_body": "Initial Body",
        "resume_source": "alice.txt",
        "resume_storage_path": f"{job_id}/alice.txt",
        "email_sent": False,
        "status": "email_drafted",
    })

    sent_calls: list[str] = []

    def _fake_send(to_email: str, subject: str, body: str) -> dict[str, str]:
        sent_calls.append(to_email)
        return {"status": "sent", "mode": "console", "to": to_email}

    monkeypatch.setattr("app.routers.recruitment.send_interview_email", _fake_send)

    payload = {
        "decisions": [
            {
                "candidate_id": cand_id,
                "approved": True,
                "email_subject": "Invite — Staff Engineer",
                "email_body": "Please confirm your slot.",
                "interview_slot": "Wednesday, June 4, 2025 at 10:00 AM",
            }
        ]
    }

    first = client.post(f"/api/recruitment/jobs/{job_id}/approve", headers=hr_headers, json=payload)
    assert first.status_code == 200
    assert len(sent_calls) == 1

    second = client.post(f"/api/recruitment/jobs/{job_id}/approve", headers=hr_headers, json=payload)
    assert second.status_code == 200
    assert len(sent_calls) == 1
    assert mock_supabase.tables["candidates"][0]["email_sent"] is True
    assert mock_supabase.tables["candidates"][0]["status"] == "email_sent"


def test_approve_handles_partial_smtp_failure_without_aborting_batch(
    client, mock_supabase, hr_headers, monkeypatch
):
    job_id = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    cand_ok_id = "11111111-2222-3333-4444-555555555555"
    cand_fail_id = "66666666-7777-8888-9999-000000000000"

    mock_supabase.tables["job_postings"].append({
        "id": job_id,
        "title": "Security Engineer",
        "department": "Security",
        "description": "AppSec and IAM",
        "required_skills": "Python, OAuth2",
        "experience_years": 4,
        "status": "pending_approval",
        "created_by": "11111111-1111-1111-1111-111111111111",
    })
    mock_supabase.tables["candidates"].extend([
        {
            "id": cand_ok_id,
            "job_id": job_id,
            "name": "Alice Ok",
            "email": "alice@example.com",
            "match_score": 90.0,
            "matched_skills": "Python, OAuth2",
            "interview_slot": "Thursday at 10:00 AM",
            "email_subject": "Invite",
            "email_body": "Body",
            "resume_source": "alice.txt",
            "resume_storage_path": f"{job_id}/alice.txt",
            "email_sent": False,
            "status": "email_drafted",
        },
        {
            "id": cand_fail_id,
            "job_id": job_id,
            "name": "Bob Fail",
            "email": "bob@example.com",
            "match_score": 85.0,
            "matched_skills": "OAuth2",
            "interview_slot": "Thursday at 11:00 AM",
            "email_subject": "Invite",
            "email_body": "Body",
            "resume_source": "bob.txt",
            "resume_storage_path": f"{job_id}/bob.txt",
            "email_sent": False,
            "status": "email_drafted",
        },
    ])

    def _flaky_send(to_email: str, subject: str, body: str) -> dict[str, str]:
        if to_email == "bob@example.com":
            raise RuntimeError("SMTP connection refused")
        return {"status": "sent", "mode": "smtp", "to": to_email}

    monkeypatch.setattr("app.routers.recruitment.send_interview_email", _flaky_send)

    res = client.post(
        f"/api/recruitment/jobs/{job_id}/approve",
        headers=hr_headers,
        json={
            "decisions": [
                {
                    "candidate_id": cand_ok_id,
                    "approved": True,
                    "email_subject": "Invite Alice",
                    "email_body": "Body Alice",
                    "interview_slot": "Thursday at 10:00 AM",
                },
                {
                    "candidate_id": cand_fail_id,
                    "approved": True,
                    "email_subject": "Invite Bob",
                    "email_body": "Body Bob",
                    "interview_slot": "Thursday at 11:00 AM",
                },
            ]
        },
    )

    assert res.status_code == 502
    by_id = {c["id"]: c for c in mock_supabase.tables["candidates"]}
    assert by_id[cand_ok_id]["email_sent"] is True
    assert by_id[cand_ok_id]["status"] == "email_sent"
    assert by_id[cand_fail_id]["email_sent"] is False
    assert by_id[cand_fail_id]["status"] == "email_drafted"
    assert mock_supabase.tables["job_postings"][0]["status"] == "pending_approval"
