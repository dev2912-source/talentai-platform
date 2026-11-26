from types import SimpleNamespace

from app.ai import support as support_ai


class _CapturingFakeLLM:
    def __init__(self, reply: str):
        self.reply = reply
        self.captured_messages = []

    def invoke(self, messages):
        self.captured_messages = messages
        return SimpleNamespace(content=self.reply)


def test_kb_crud_requires_hr_and_supports_policies_and_faqs(
    client, mock_supabase, hr_headers, employee_headers
):
    # Employee blocked across all KB routes
    assert client.get("/api/kb/overview", headers=employee_headers).status_code == 403
    assert client.post(
        "/api/kb/policies",
        headers=employee_headers,
        json={"title": "Test", "content": "Blocked"},
    ).status_code == 403
    assert client.post(
        "/api/kb/faqs",
        headers=employee_headers,
        json={"question": "Test?", "answer": "Blocked"},
    ).status_code == 403

    # HR creates policy
    p_create = client.post(
        "/api/kb/policies",
        headers=hr_headers,
        json={"title": "Leave Policy", "content": "20 days PTO per year."},
    )
    assert p_create.status_code == 201
    policy = p_create.json()
    policy_id = policy["id"]
    assert policy["title"] == "Leave Policy"

    # HR updates policy
    p_update = client.put(
        f"/api/kb/policies/{policy_id}",
        headers=hr_headers,
        json={"title": "Annual Leave Policy", "content": "22 days PTO per year."},
    )
    assert p_update.status_code == 200
    assert p_update.json()["title"] == "Annual Leave Policy"
    assert p_update.json()["content"] == "22 days PTO per year."

    # Employee blocked on update/delete
    assert client.put(
        f"/api/kb/policies/{policy_id}",
        headers=employee_headers,
        json={"title": "Hack", "content": "Hack"},
    ).status_code == 403
    assert client.delete(f"/api/kb/policies/{policy_id}", headers=employee_headers).status_code == 403

    # HR creates & updates FAQ
    f_create = client.post(
        "/api/kb/faqs",
        headers=hr_headers,
        json={"question": "When is payday?", "answer": "15th of each month."},
    )
    assert f_create.status_code == 201
    faq_id = f_create.json()["id"]

    f_update = client.put(
        f"/api/kb/faqs/{faq_id}",
        headers=hr_headers,
        json={"question": "When is payday?", "answer": "15th and last working day."},
    )
    assert f_update.status_code == 200
    assert "last working day" in f_update.json()["answer"]

    # HR overview lists policies, FAQs, and non-HR employees
    overview = client.get("/api/kb/overview", headers=hr_headers)
    assert overview.status_code == 200
    ov_data = overview.json()
    assert len(ov_data["policies"]) == 1
    assert len(ov_data["faqs"]) == 1
    assert len(ov_data["employees"]) == 1
    assert ov_data["employees"][0]["username"] == "john"

    # Delete policy & FAQ
    assert client.delete(f"/api/kb/policies/{policy_id}", headers=hr_headers).status_code == 200
    assert client.delete(f"/api/kb/faqs/{faq_id}", headers=hr_headers).status_code == 200
    assert mock_supabase.tables["company_policies"] == []
    assert mock_supabase.tables["faqs"] == []

    # Deleting missing item returns 404
    assert client.delete(f"/api/kb/policies/{policy_id}", headers=hr_headers).status_code == 404
    assert client.delete(f"/api/kb/faqs/{faq_id}", headers=hr_headers).status_code == 404


def test_chat_rbac_and_context_injection(
    client, mock_supabase, hr_headers, employee_headers, monkeypatch
):
    mock_supabase.tables["company_policies"] = [
        {
            "id": "pol-1",
            "title": "Leave Policy",
            "content": "Full-time staff receive 20 PTO days annually.",
        },
        {
            "id": "pol-2",
            "title": "Travel Expense Guidelines",
            "content": "Flight bookings require manager sign-off.",
        },
    ]
    mock_supabase.tables["faqs"] = [
        {
            "id": "faq-1",
            "question": "How do I request leave?",
            "answer": "Submit leave requests 2 weeks ahead in the HR portal.",
        },
        {
            "id": "faq-2",
            "question": "How do I reset my VPN?",
            "answer": "Contact IT Helpdesk.",
        },
    ]

    fake_llm = _CapturingFakeLLM("You have 14 leave days remaining and our PTO policy grants 20 days annually.")
    monkeypatch.setattr(support_ai, "get_llm", lambda temperature=0.3: fake_llm)

    # Unauthenticated -> 401
    assert client.post("/api/chat", json={"message": "What is my leave balance?"}).status_code == 401

    # HR -> 403
    hr_res = client.post(
        "/api/chat",
        headers=hr_headers,
        json={"message": "What is my leave balance?"},
    )
    assert hr_res.status_code == 403

    # Employee -> 200
    emp_res = client.post(
        "/api/chat",
        headers=employee_headers,
        json={"message": "What is my salary and leave policy?"},
    )
    assert emp_res.status_code == 200
    assert "14 leave days" in emp_res.json()["response"]

    # Verify employee profile fields + matching policy/FAQ were injected into prompt
    system_prompt = str(fake_llm.captured_messages[0].content)
    assert "Name: john" in system_prompt
    assert "Department: Engineering" in system_prompt
    assert "Salary: $85000.0" in system_prompt
    assert "Leave Balance: 14 days" in system_prompt
    assert "Attendance Score: 95/100" in system_prompt
    assert "Leave Policy" in system_prompt
    assert "How do I request leave?" in system_prompt
    # Unrelated policy/FAQ should be filtered out by keyword ilike search
    assert "Travel Expense Guidelines" not in system_prompt
    assert "How do I reset my VPN?" not in system_prompt


def test_chat_llm_error_returns_502_without_leaking_exception(
    client, employee_headers, monkeypatch
):
    class _BrokenLLM:
        def invoke(self, _messages):
            raise RuntimeError("SECRET_OPENROUTER_API_KEY_TRACEBACK")

    monkeypatch.setattr(support_ai, "get_llm", lambda temperature=0.3: _BrokenLLM())

    res = client.post(
        "/api/chat",
        headers=employee_headers,
        json={"message": "What is the leave policy?"},
    )
    assert res.status_code == 502
    body = res.json()
    assert "SECRET_OPENROUTER_API_KEY_TRACEBACK" not in str(body)
    assert body["detail"] == "Unable to generate support response right now."


def test_kb_and_chat_reject_whitespace_only_strings(client, hr_headers, employee_headers):
    assert client.post(
        "/api/kb/policies",
        headers=hr_headers,
        json={"title": "   ", "content": "Valid"},
    ).status_code == 422
    assert client.post(
        "/api/kb/faqs",
        headers=hr_headers,
        json={"question": "Valid?", "answer": "   "},
    ).status_code == 422
    assert client.post(
        "/api/chat",
        headers=employee_headers,
        json={"message": "   "},
    ).status_code == 422


def test_kb_create_update_employee_and_test_query(
    client, mock_supabase, hr_headers, employee_headers, monkeypatch
):
    from types import SimpleNamespace

    # Employee cannot access HR KB endpoints
    assert client.post(
        "/api/kb/employees",
        headers=employee_headers,
        json={"username": "priya", "email": "priya@company.com", "password": "password123"},
    ).status_code == 403

    create_res = client.post(
        "/api/kb/employees",
        headers=hr_headers,
        json={
            "username": "priya",
            "email": "priya@company.com",
            "password": "password123",
            "department": "Product",
            "salary": 92000.0,
            "leave_balance": 15,
            "attendance_score": 98,
        },
    )
    assert create_res.status_code == 201
    created = create_res.json()
    assert created["is_hr"] is False
    assert created["department"] == "Product"

    # Update employee metrics (use valid UUID)
    emp_uuid = "22222222-2222-2222-2222-222222222222"
    patch_res = client.patch(
        f"/api/kb/employees/{emp_uuid}",
        headers=hr_headers,
        json={
            "department": "AI Engineering",
            "salary": 99000.0,
            "leave_balance": 18,
            "attendance_score": 97,
        },
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["department"] == "AI Engineering"
    assert patch_res.json()["salary"] == 99000.0

    # Test KB AI query endpoint
    class _FakeSupportLLM:
        def invoke(self, _messages):
            return SimpleNamespace(content="Remote work is allowed 2 days per week.")

    monkeypatch.setattr(support_ai, "get_llm", lambda temperature=0.3: _FakeSupportLLM())
    test_res = client.post(
        "/api/kb/test-query",
        headers=hr_headers,
        json={"message": "What is the remote work policy?"},
    )
    assert test_res.status_code == 200
    assert "Remote work" in test_res.json()["response"]


def test_employee_self_service_kb_my_export_and_my_reviews(
    client, mock_supabase, hr_headers, employee_headers
):
    # Employee KB read-only endpoint
    assert client.get("/api/chat/kb", headers=hr_headers).status_code == 403
    mock_supabase.tables["company_policies"].append({
        "id": "p1",
        "title": "Remote Policy",
        "content": "2 days remote",
        "last_updated": "2026-11-26T00:00:00+00:00",
    })
    kb_res = client.get("/api/chat/kb", headers=employee_headers)
    assert kb_res.status_code == 200
    assert len(kb_res.json()["policies"]) == 1

    # Employee my-export endpoint
    mock_supabase.tables["attendance_logs"].extend([
        {
            "id": 1,
            "employee_id": "EMP-22222222",
            "timestamp": "2026-11-26T09:00:00+00:00",
            "device_type": "rfid_scanner",
            "location": "Gate A",
            "tap_type": "IN",
        },
        {
            "id": 2,
            "employee_id": "EMP-OTHER",
            "timestamp": "2026-11-26T09:00:00+00:00",
            "device_type": "rfid_scanner",
            "location": "Gate B",
            "tap_type": "IN",
        },
    ])
    exp_res = client.get("/api/attendance/my-export", headers=employee_headers)
    assert exp_res.status_code == 200
    assert "spreadsheetml" in exp_res.headers["content-type"]

    # Employee my-reviews endpoint
    assert client.get("/api/performance/my-reviews", headers=hr_headers).status_code == 403
    mock_supabase.tables["performance_records"].append({
        "id": "rev-1",
        "batch_id": "b1",
        "employee_id": "22222222-2222-2222-2222-222222222222",
        "employee_name": "john",
        "employee_email": "john@company.com",
        "department": "Engineering",
        "review_period": "Q4 2026",
        "kpi_data": "Tasks: 46/45",
        "performance_score": 94,
        "kpi_achievement_percent": 102.0,
        "strengths": "Great delivery",
        "areas_for_improvement": "None",
        "recommended_actions": "Lead sprint",
    })
    rev_res = client.get("/api/performance/my-reviews", headers=employee_headers)
    assert rev_res.status_code == 200
    assert len(rev_res.json()) == 1
    assert rev_res.json()[0]["performance_score"] == 94

