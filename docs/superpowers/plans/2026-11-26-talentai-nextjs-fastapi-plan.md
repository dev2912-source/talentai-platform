# TalentAI Next.js + FastAPI + Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `talentai-platform/` — a portfolio-grade Next.js (App Router), FastAPI, and Supabase (Auth, PostgreSQL, Storage, `pgvector`) rebuild of the TalentAI HR Intelligence Platform with full feature parity and a Human-in-the-Loop (HITL) recruitment email approval step.

**Architecture:** Clean two-service monorepo (`frontend/` + `backend/` + `supabase/`). Next.js handles UI and Supabase Auth sessions, passing Bearer JWTs to FastAPI; FastAPI validates JWTs, enforces HR vs Employee RBAC, runs LangChain/LangGraph AI agents (OpenRouter LLM + Jina embeddings), stores vectors in Supabase `pgvector` and files in Supabase Storage, and generates ReportLab PDF / OpenPyXL Excel downloads.

**Tech Stack:** Next.js 15 (App Router, TypeScript, Tailwind CSS v4, Lucide React), FastAPI, Pydantic v2, LangGraph, LangChain (`langchain-openai`, `langchain-text-splitters`), Supabase (`supabase-py`, Postgres + `pgvector`, Storage, Auth), PyPDF2, python-docx, pandas, openpyxl, reportlab, pytest.

## Global Constraints
- Create all new files under `talentai-platform/` alongside `Hr_Management-main/`.
- Preserve the exact TalentAI light canvas (`#f8fafc`), white card (`#ffffff`), dark sidebar (`#1e2333`), primary blue (`#1f48d9`), and indigo accent (`#544af4`) styling.
- Keep the code clean, modular, and easy to understand (no Redis/Celery over-engineering).
- All backend endpoints (except `GET /health` and `POST /api/attendance/tap`) require a valid Supabase Bearer JWT; HR routes enforce `profiles.is_hr == True`; `/api/chat` enforces `profiles.is_hr == False`.
- Recruitment LangGraph pauses before email sending (`status="pending_approval"`) so HR can review/edit/approve on `/recruitment/[jobId]/approval` before dispatching emails.

---

### Task 1: Supabase Schema & Project Root Setup

**Files:**
- Create: `talentai-platform/supabase/schema.sql`
- Create: `talentai-platform/docker-compose.yml`
- Create: `talentai-platform/README.md`

**Interfaces:**
- Produces: Postgres tables (`profiles`, `job_postings`, `candidates`, `resume_chunks`, `company_policies`, `faqs`, `performance_records`, `attendance_logs`, `attendance_reports`), SQL RPC `match_resume_chunks(query_embedding, match_job_id, match_count)`, Storage bucket `hr-uploads`, and `on_auth_user_created` trigger.

- [ ] **Step 1: Write `talentai-platform/supabase/schema.sql`**

```sql
-- TalentAI HR Intelligence Platform — Supabase Schema (Postgres + pgvector + Storage)
create extension if not exists vector;
create extension if not exists pgcrypto;

-- 1. User Profiles (linked 1:1 to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text unique not null,
  is_hr boolean not null default false,
  department text not null default 'General',
  salary numeric(10, 2) default 50000.00,
  leave_balance integer not null default 10,
  attendance_score integer not null default 100,
  created_at timestamptz not null default now()
);

-- Automatically create a profile row when a new user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, is_hr, department, salary, leave_balance, attendance_score)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'is_hr')::boolean, false),
    coalesce(new.raw_user_meta_data->>'department', 'General'),
    coalesce((new.raw_user_meta_data->>'salary')::numeric, 50000.00),
    coalesce((new.raw_user_meta_data->>'leave_balance')::integer, 10),
    coalesce((new.raw_user_meta_data->>'attendance_score')::integer, 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Job Postings
create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  department text not null default 'Engineering',
  description text not null,
  required_skills text not null default 'Not specified',
  experience_years integer not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'screening', 'pending_approval', 'approved', 'completed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Candidates
create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  name text not null default 'Unknown',
  email text,
  match_score double precision not null default 0.0,
  matched_skills text not null default '',
  interview_slot text not null default 'TBD',
  email_subject text not null default '',
  email_body text not null default '',
  resume_source text not null default '',
  resume_storage_path text not null default '',
  email_sent boolean not null default false,
  status text not null default 'email_drafted'
    check (status in ('shortlisted', 'email_drafted', 'email_sent', 'rejected')),
  created_at timestamptz not null default now()
);

-- 4. Resume Vector Chunks (pgvector, 768 dims for jina-embeddings-v2-base-en)
create table if not exists public.resume_chunks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.job_postings(id) on delete cascade,
  source_file text not null,
  candidate_name text not null,
  candidate_email text not null default '',
  chunk_index integer not null,
  content text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_resume_chunks_job_id on public.resume_chunks(job_id);

create or replace function public.match_resume_chunks(
  query_embedding vector(768),
  match_job_id uuid,
  match_count int default 30
)
returns table (
  id uuid,
  source_file text,
  candidate_name text,
  candidate_email text,
  content text,
  similarity double precision
)
language sql stable
as $$
  select
    rc.id,
    rc.source_file,
    rc.candidate_name,
    rc.candidate_email,
    rc.content,
    1 - (rc.embedding <=> query_embedding) as similarity
  from public.resume_chunks rc
  where rc.job_id = match_job_id
  order by rc.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Knowledge Base: Policies & FAQs
create table if not exists public.company_policies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  last_updated timestamptz not null default now()
);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  created_at timestamptz not null default now()
);

-- 6. Performance Records
create table if not exists public.performance_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  employee_name text not null,
  employee_email text not null,
  department text not null default 'General',
  review_period text not null,
  kpi_data text not null,
  performance_score integer,
  kpi_achievement_percent double precision,
  strengths text,
  areas_for_improvement text,
  recommended_actions text,
  created_at timestamptz not null default now()
);

-- 7. Attendance Hardware Tap Logs & AI Reports
create table if not exists public.attendance_logs (
  id bigserial primary key,
  employee_id text not null,
  timestamp timestamptz not null default now(),
  device_type text not null default 'rfid_scanner',
  location text not null default 'Main Entrance',
  tap_type text not null check (tap_type in ('IN', 'OUT')),
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_reports (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  employee_name text not null,
  total_hours double precision not null,
  leaves_taken integer not null,
  ai_score integer,
  ai_feedback text not null,
  created_at timestamptz not null default now()
);

-- 8. Storage bucket for resumes
insert into storage.buckets (id, name, public)
values ('hr-uploads', 'hr-uploads', false)
on conflict (id) do nothing;

-- 9. Row-Level Security (backend uses service_role key; profiles readable by owner)
alter table public.profiles enable row level security;
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);
```

- [ ] **Step 2: Write `talentai-platform/docker-compose.yml` and `talentai-platform/README.md`**

Create `docker-compose.yml` (backend on port `8000`, frontend on port `3000`) and a clean portfolio `README.md` with architecture diagram, setup steps, Supabase SQL setup, seed command, and demo credentials.

- [ ] **Step 3: Verify SQL syntax and file presence**

Run: `Get-ChildItem -Path talentai-platform -Recurse -File`
Expected: `supabase/schema.sql`, `docker-compose.yml`, `README.md`, and spec/plan docs present.

---

### Task 2: FastAPI Core, Supabase Client, Auth/RBAC & Seed Script

**Files:**
- Create: `talentai-platform/backend/requirements.txt`
- Create: `talentai-platform/backend/.env.example`
- Create: `talentai-platform/backend/Dockerfile`
- Create: `talentai-platform/backend/app/__init__.py`
- Create: `talentai-platform/backend/app/config.py`
- Create: `talentai-platform/backend/app/db.py`
- Create: `talentai-platform/backend/app/deps.py`
- Create: `talentai-platform/backend/app/models/schemas.py`
- Create: `talentai-platform/backend/app/routers/auth.py`
- Create: `talentai-platform/backend/app/main.py`
- Create: `talentai-platform/backend/seed.py`
- Test: `talentai-platform/backend/tests/conftest.py`
- Test: `talentai-platform/backend/tests/test_auth_rbac.py`

**Interfaces:**
- Produces: `Settings` (`get_settings()`), `get_supabase()` returning Supabase client, `CurrentUser` dataclass (`id, email, username, is_hr, department, salary, leave_balance, attendance_score`), `get_current_user`, `require_hr`, `require_employee`.

- [ ] **Step 1: Create `backend/requirements.txt`, `.env.example`, and `Dockerfile`**

`requirements.txt`:
```text
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
pydantic>=2.8.0
pydantic-settings>=2.4.0
supabase>=2.7.0
langchain>=0.2.0
langgraph>=0.2.0
langchain-openai>=0.1.0
langchain-core>=0.2.0
langchain-text-splitters>=0.2.0
PyPDF2>=3.0.0
python-docx>=1.1.0
pandas>=2.2.0
openpyxl>=3.1.5
reportlab>=4.2.0
python-dateutil>=2.9.0
requests>=2.32.0
pytest>=8.3.0
httpx>=0.27.0
```

- [ ] **Step 2: Write failing auth & RBAC tests in `backend/tests/conftest.py` and `backend/tests/test_auth_rbac.py`**

```python
def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

def test_me_requires_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401

def test_me_returns_profile_for_valid_user(client, hr_headers):
    res = client.get("/api/auth/me", headers=hr_headers)
    assert res.status_code == 200
    assert res.json()["is_hr"] is True
```

- [ ] **Step 3: Run pytest to verify it fails**

Run: `cd talentai-platform/backend && pytest tests/test_auth_rbac.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app'`).

- [ ] **Step 4: Implement `config.py`, `db.py`, `deps.py`, `models/schemas.py`, `routers/auth.py`, `main.py`, and `seed.py`**

- `config.py`: `BaseSettings` reading `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL`, `FRONTEND_ORIGINS`, `SMTP_*` (all with safe defaults so tests and local boot work cleanly).
- `deps.py`: `get_current_user` extracts Bearer token, calls `supabase.auth.get_user(token)`, queries `profiles` by `id`, returns `CurrentUser`. `require_hr` raises `403` if `not user.is_hr`; `require_employee` raises `403` if `user.is_hr`.
- `seed.py`: Idempotently creates `admin@company.com` (`admin123`, `is_hr=True`, `Human Resources`), `john@company.com` (`pass123`, `is_hr=False`, `Engineering`, `salary=85000`, `leave_balance=14`, `attendance_score=95`), plus the 3 `company_policies` and 3 `faqs` from the original `seed_data.py`.

- [ ] **Step 5: Run pytest to verify auth/RBAC tests pass**

Run: `cd talentai-platform/backend && pytest tests/test_auth_rbac.py -v`
Expected: PASS (all tests in `test_auth_rbac.py`).

---

### Task 3: AI Core, Supabase `pgvector` Store & HITL Recruitment Pipeline

**Files:**
- Create: `talentai-platform/backend/app/ai/__init__.py`
- Create: `talentai-platform/backend/app/ai/llm.py`
- Create: `talentai-platform/backend/app/ai/vector_store.py`
- Create: `talentai-platform/backend/app/ai/recruitment_graph.py`
- Create: `talentai-platform/backend/app/services/__init__.py`
- Create: `talentai-platform/backend/app/services/email.py`
- Create: `talentai-platform/backend/app/routers/recruitment.py`
- Modify: `talentai-platform/backend/app/main.py` (include `recruitment.router`)
- Test: `talentai-platform/backend/tests/test_recruitment_api.py`

**Interfaces:**
- Consumes: `get_settings()`, `get_supabase()`, `require_hr`
- Produces: `get_llm(temperature)`, `embed_texts(texts)`, `ingest_resumes_to_pgvector(...)`, `search_resumes_pgvector(...)`, `recruitment_screen_graph` (4-node LangGraph: `ingest -> screen -> schedule -> draft_emails`), `send_interview_email(...)`, and endpoints `GET /api/recruitment/jobs`, `POST /api/recruitment/screen`, `GET /api/recruitment/jobs/{job_id}`, `POST /api/recruitment/jobs/{job_id}/approve`.

- [ ] **Step 1: Write failing tests in `backend/tests/test_recruitment_api.py`**

Tests cover:
1. Employee user gets `403` on `POST /api/recruitment/screen`.
2. HR user uploading a text/PDF resume runs the 4-node graph (mocked LLM + embeddings + Supabase), persists candidates with `status="email_drafted"`, and returns `status="pending_approval"`.
3. HR user calling `POST /api/recruitment/jobs/{job_id}/approve` with edited email subject/body and approved/rejected flags sends approved emails, rejects excluded candidates, and updates job status to `"approved"`.

- [ ] **Step 2: Run pytest to verify failure**

Run: `cd talentai-platform/backend && pytest tests/test_recruitment_api.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `ai/llm.py`, `ai/vector_store.py`, `ai/recruitment_graph.py`, `services/email.py`, and `routers/recruitment.py`**

Key implementation details:
- `ai/vector_store.py`: Extracts text from `.pdf` (`PyPDF2`), `.docx` (`python-docx`), or plain text; heuristically extracts candidate name and email; chunks text (`chunk_size=800, chunk_overlap=100`); embeds via OpenRouter `/embeddings` (`jinaai/jina-embeddings-v2-base-en` with 768-d zero fallback); stores rows in `resume_chunks` and queries via `supabase.rpc("match_resume_chunks", ...)`.
- `ai/recruitment_graph.py`: Linear LangGraph `StateGraph(HRState)` running `ingest_resumes -> screen_candidates -> schedule_interviews -> draft_emails -> END`, returning `shortlisted_candidates`, `scheduled_candidates`, and `email_drafts` for HITL review.
- `services/email.py`: Sends via `smtplib` when `SMTP_HOST` and `SMTP_USER` are configured, otherwise logs cleanly to console (`EmailMode="console"`) so portfolio demos work out-of-the-box without SMTP credentials.

- [ ] **Step 4: Run pytest to verify pass**

Run: `cd talentai-platform/backend && pytest tests/test_recruitment_api.py -v`
Expected: PASS.

---

### Task 4: Attendance Tracker, Hardware Tap Webhook & Excel/PDF Exports

**Files:**
- Create: `talentai-platform/backend/app/ai/attendance.py`
- Create: `talentai-platform/backend/app/services/exports.py`
- Create: `talentai-platform/backend/app/routers/attendance.py`
- Modify: `talentai-platform/backend/app/main.py` (include `attendance.router`)
- Test: `talentai-platform/backend/tests/test_attendance_tap.py`

**Interfaces:**
- Consumes: `get_supabase()`, `get_current_user`, `require_hr`, `get_llm()`
- Produces: `process_excel_data(file_bytes)`, `generate_attendance_report(file_bytes)`, `build_attendance_excel(logs)`, `build_attendance_pdf(reports)`, and endpoints `POST /api/attendance/tap`, `GET /api/attendance/logs`, `GET /api/attendance/export-excel`, `POST /api/attendance/upload`, `GET /api/attendance/reports`, `GET /api/attendance/reports/pdf`.

- [ ] **Step 1: Write failing tests in `backend/tests/test_attendance_tap.py`**

Tests cover:
1. `POST /api/attendance/tap` toggles `IN` on tap #1 (even count 0) and `OUT` on tap #2 (odd count 1) for the same day.
2. Missing `employeeId` returns `400`.
3. `GET /api/attendance/export-excel` returns `200` with `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for HR and `403` for Employee.
4. `POST /api/attendance/upload` parses an in-memory Excel file, returns `batch_id` + AI scores/feedback, and `GET /api/attendance/reports/pdf` streams valid `%PDF` bytes.

- [ ] **Step 2: Run pytest to verify failure**

Run: `cd talentai-platform/backend && pytest tests/test_attendance_tap.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `ai/attendance.py`, `services/exports.py`, and `routers/attendance.py`**

- [ ] **Step 4: Run pytest to verify pass**

Run: `cd talentai-platform/backend && pytest tests/test_attendance_tap.py -v`
Expected: PASS.

---

### Task 5: Performance Reviews, Knowledge Base CRUD & Employee Support Chat

**Files:**
- Create: `talentai-platform/backend/app/ai/performance.py`
- Create: `talentai-platform/backend/app/ai/support.py`
- Create: `talentai-platform/backend/app/routers/performance.py`
- Create: `talentai-platform/backend/app/routers/knowledge_base.py`
- Create: `talentai-platform/backend/app/routers/chat.py`
- Modify: `talentai-platform/backend/app/services/exports.py` (add `build_performance_pdf(records)`)
- Modify: `talentai-platform/backend/app/main.py` (include `performance`, `knowledge_base`, `chat` routers)
- Test: `talentai-platform/backend/tests/test_performance_api.py`
- Test: `talentai-platform/backend/tests/test_chat_api.py`

**Interfaces:**
- Produces: `generate_performance_review(employee_profile, row_data)`, `generate_support_response(message, user_profile, supabase)`, `build_performance_pdf(records)`, and endpoints `/api/performance/*`, `/api/kb/*`, `/api/chat`.

- [ ] **Step 1: Write failing tests in `test_performance_api.py` and `test_chat_api.py`**

Tests cover:
1. Bulk performance Excel upload creates/matches employee profile, stores structured `PerformanceRecord` rows, returns `batch_id`, and streams valid `%PDF` from `/api/performance/reports/pdf`.
2. Knowledge Base CRUD creates, updates, and deletes policies and FAQs (HR only; Employee gets `403`).
3. `/api/chat` allows Employee (`200`), blocks HR (`403`), and injects employee salary/leave/department + matching policies/FAQs into the prompt.

- [ ] **Step 2: Run pytest to verify failure**

Run: `cd talentai-platform/backend && pytest tests/test_performance_api.py tests/test_chat_api.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `ai/performance.py`, `ai/support.py`, `routers/performance.py`, `routers/knowledge_base.py`, `routers/chat.py`, and `build_performance_pdf`**

- [ ] **Step 4: Run full backend test suite**

Run: `cd talentai-platform/backend && pytest -v`
Expected: All backend tests PASS.

---

### Task 6: Next.js Frontend Scaffold, Theme, Auth Context & Login/Signup

**Files:**
- Create: `talentai-platform/frontend/package.json`
- Create: `talentai-platform/frontend/tsconfig.json`
- Create: `talentai-platform/frontend/next.config.ts`
- Create: `talentai-platform/frontend/postcss.config.mjs`
- Create: `talentai-platform/frontend/.env.local.example`
- Create: `talentai-platform/frontend/Dockerfile`
- Create: `talentai-platform/frontend/src/app/globals.css`
- Create: `talentai-platform/frontend/src/app/layout.tsx`
- Create: `talentai-platform/frontend/src/lib/types.ts`
- Create: `talentai-platform/frontend/src/lib/supabase.ts`
- Create: `talentai-platform/frontend/src/lib/api.ts`
- Create: `talentai-platform/frontend/src/components/AuthProvider.tsx`
- Create: `talentai-platform/frontend/src/components/Sidebar.tsx`
- Create: `talentai-platform/frontend/src/components/AuthGuard.tsx`
- Create: `talentai-platform/frontend/src/app/login/page.tsx`
- Create: `talentai-platform/frontend/src/app/signup/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `useAuth()` (`user, profile, token, loading, signOut, refreshProfile`), `apiFetch<T>(path, options, token)`, `Sidebar` with TalentAI `#1e2333` dark rail & role-aware links (`Dashboard`, `Attendance`, `Knowledge Base`, `Analytics` for HR; `Attendance`, `AI Assistant` for Employee).

- [ ] **Step 1: Initialize Next.js config, `package.json` (`next`, `react`, `lucide-react`, `@supabase/supabase-js`, `tailwindcss`), and `globals.css`**
- [ ] **Step 2: Implement `lib/types.ts`, `lib/supabase.ts`, `lib/api.ts`, and `AuthProvider.tsx`**
- [ ] **Step 3: Implement `Sidebar.tsx`, `AuthGuard.tsx`, `(app)/layout.tsx`, `login/page.tsx` (with 1-click Demo HR & Demo Employee buttons), and `signup/page.tsx`**
- [ ] **Step 4: Install dependencies & verify TypeScript**

Run: `cd talentai-platform/frontend && npm install && npx tsc --noEmit`
Expected: `0` TypeScript errors.

---

### Task 7: Frontend HR Recruitment Dashboard, HITL Approval & Success Pages

**Files:**
- Create: `talentai-platform/frontend/src/components/CircularScore.tsx`
- Create: `talentai-platform/frontend/src/components/FileDropzone.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/page.tsx` (HR Recruitment Dashboard)
- Create: `talentai-platform/frontend/src/app/(app)/recruitment/[jobId]/approval/page.tsx` (HITL Review & Approve)
- Create: `talentai-platform/frontend/src/app/(app)/recruitment/[jobId]/success/page.tsx` (Sent Summary)

**Interfaces:**
- Consumes: `POST /api/recruitment/screen`, `GET /api/recruitment/jobs`, `GET /api/recruitment/jobs/{jobId}`, `POST /api/recruitment/jobs/{jobId}/approve`.

- [ ] **Step 1: Implement `CircularScore.tsx` and `FileDropzone.tsx`**
- [ ] **Step 2: Implement `(app)/page.tsx`** (2-column Job Details + Resume Dropzone matching `dashboard.html`, plus Recent Jobs table linking to Approval/Success).
- [ ] **Step 3: Implement `approval/page.tsx`** (Candidate cards with circular score ring, matched skills badges, approve/reject toggle, editable interview slot + email subject/body editor, and "Approve & Send Invitations" submit button).
- [ ] **Step 4: Implement `success/page.tsx`** (Sent count, status badge, job summary, sent invitations table, Back to Dashboard link).
- [ ] **Step 5: Run TypeScript check**

Run: `cd talentai-platform/frontend && npx tsc --noEmit`
Expected: `0` errors.

---

### Task 8: Frontend Attendance, Knowledge Base, Performance & Employee Chat Pages + Full Verification

**Files:**
- Create: `talentai-platform/frontend/src/app/(app)/attendance/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/attendance/report/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/knowledge-base/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/performance/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/performance/report/page.tsx`
- Create: `talentai-platform/frontend/src/app/(app)/chat/page.tsx`

**Interfaces:**
- Consumes: `/api/attendance/*`, `/api/kb/*`, `/api/performance/*`, `/api/chat`.

- [ ] **Step 1: Implement `attendance/page.tsx` and `attendance/report/page.tsx`** (Pulse-animated Card Tap Simulator, Live Activity Log for HR, Excel export download with Bearer token blob download, AI Timesheet Upload, AI Attendance Report table + PDF download).
- [ ] **Step 2: Implement `knowledge-base/page.tsx`** (Add/Edit/Delete Policy & FAQ forms + existing lists + Employee directory).
- [ ] **Step 3: Implement `performance/page.tsx` and `performance/report/page.tsx`** (Bulk Excel upload + review period + AI score/KPI cards, Strengths, Areas for Improvement, Recommended Actions + PDF download).
- [ ] **Step 4: Implement `chat/page.tsx`** (AI HR Assistant chat UI matching `employee_chat.html`, calling `POST /api/chat`).
- [ ] **Step 5: Final End-to-End Build & Test Verification**

Run backend tests: `cd talentai-platform/backend && pytest -v`
Run frontend typecheck & build: `cd talentai-platform/frontend && npx tsc --noEmit && npm run build`
Expected: All `pytest` tests pass, `tsc` exits 0, and `next build` succeeds cleanly.
