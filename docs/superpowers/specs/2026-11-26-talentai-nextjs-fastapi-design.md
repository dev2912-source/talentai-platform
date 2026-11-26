# TalentAI HR Intelligence Platform — Next.js, FastAPI & Supabase Design Spec

**Date:** 2026-11-26
**Location:** `talentai-platform/` (sibling to `Hr_Management-main/`)
**Goal:** Rebuild the existing Django-based TalentAI HR system as a clean, portfolio-grade full-stack application using **Next.js (App Router)**, **FastAPI**, and **Supabase** (Auth, PostgreSQL, Storage, `pgvector`), preserving exact feature parity and adding the Human-in-the-Loop (HITL) recruitment approval workflow.

---

## 1. Architecture & Monorepo Structure

```text
talentai-platform/
├── README.md                          # Architecture, setup guide, demo credentials, API overview
├── docker-compose.yml                 # Local multi-service runner (frontend + backend)
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-11-26-talentai-nextjs-fastapi-design.md
├── supabase/
│   └── schema.sql                     # Full DDL: tables, pgvector extension, RPC, storage bucket, RLS
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example
│   ├── seed.py                        # Idempotent seed script (admin HR, john Employee, policies, FAQs)
│   ├── app/
│   │   ├── main.py                    # FastAPI app, CORS middleware, router mounting, /health
│   │   ├── config.py                  # Pydantic Settings loaded from .env
│   │   ├── db.py                      # Supabase service-role client singleton
│   │   ├── deps.py                    # Auth dependency: verify Supabase JWT, load profile, require_hr/require_employee
│   │   ├── models/
│   │   │   └── schemas.py             # Pydantic request/response schemas
│   │   ├── ai/
│   │   │   ├── llm.py                 # OpenRouter ChatOpenAI factory + Jina remote embeddings client
│   │   │   ├── vector_store.py        # PDF/DOCX text extraction, chunking, Supabase pgvector upsert & search
│   │   │   ├── recruitment_graph.py   # LangGraph workflow with HITL pause before send_emails
│   │   │   ├── attendance.py          # Pandas Excel timesheet parser + AI reliability scorer
│   │   │   ├── performance.py         # Pydantic-structured performance review generator
│   │   │   └── support.py             # Policy/FAQ keyword retrieval + employee profile support agent
│   │   ├── services/
│   │   │   ├── email.py               # Console/DB logger + optional SMTP email sender
│   │   │   └── exports.py             # ReportLab PDF generators + OpenPyXL/CSV Excel exporter
│   │   └── routers/
│   │       ├── auth.py                # GET /api/auth/me
│   │       ├── recruitment.py         # Screen, list jobs, get approval payload, approve & send
│   │       ├── attendance.py          # Hardware tap webhook, logs list, Excel upload/export, reports & PDF
│   │       ├── performance.py         # Bulk Excel review generation, reports list & PDF
│   │       ├── knowledge_base.py      # Policies & FAQs CRUD + employees list
│   │       └── chat.py                # Employee support chat endpoint
│   └── tests/
│       ├── conftest.py
│       ├── test_auth_rbac.py
│       ├── test_attendance_tap.py
│       ├── test_recruitment_api.py
│       ├── test_performance_api.py
│       └── test_chat_api.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── .env.local.example
    └── src/
        ├── app/
        │   ├── layout.tsx             # Root layout with AuthProvider + TalentAI theme tokens
        │   ├── globals.css            # Exact TalentAI color palette & Tailwind CSS v4 tokens
        │   ├── login/page.tsx         # Email/password login + 1-click Demo HR & Demo Employee buttons
        │   ├── signup/page.tsx        # Employee self-registration
        │   ├── (app)/
        │   │   ├── layout.tsx         # Authenticated shell with fixed dark Sidebar (#1e2333)
        │   │   ├── page.tsx           # HR Recruitment Dashboard (Job form + Resume dropzone + Recent Jobs)
        │   │   ├── recruitment/[jobId]/approval/page.tsx  # HITL Review, Edit & Approve/Send
        │   │   ├── recruitment/[jobId]/success/page.tsx   # Sent Invitations summary
        │   │   ├── attendance/page.tsx                    # Card Tap Simulator + Live Log + Timesheet Upload
        │   │   ├── attendance/report/page.tsx             # AI Attendance Report + PDF download
        │   │   ├── knowledge-base/page.tsx                # Policies & FAQs CRUD + Employee Directory
        │   │   ├── performance/page.tsx                   # Bulk Excel Upload + Review Period
        │   │   ├── performance/report/page.tsx            # AI Performance Reports + PDF download
        │   │   └── chat/page.tsx                          # Employee AI HR Assistant chat
        ├── components/
        │   ├── Sidebar.tsx            # Role-aware nav (Dashboard, Attendance, Knowledge Base, Analytics, AI Assistant)
        │   ├── AuthGuard.tsx          # Role & auth route guard
        │   ├── CircularScore.tsx      # SVG circular progress ring (from ApprovalScreen design)
        │   └── FileDropzone.tsx       # Drag-and-drop file upload component
        └── lib/
            ├── supabase.ts            # Supabase browser client
            ├── api.ts                 # Typed fetch wrapper attaching Supabase Bearer JWT
            └── types.ts               # Shared TypeScript interfaces
```

---

## 2. Supabase Database, Storage & `pgvector` Schema (`supabase/schema.sql`)

All relational data, vector embeddings, and uploaded resume files live in Supabase:

1. **Extension**: `CREATE EXTENSION IF NOT EXISTS vector;`
2. **Tables**:
   - `profiles`: `id uuid primary key references auth.users(id) on delete cascade`, `username text not null`, `email text unique not null`, `is_hr boolean not null default false`, `department text not null default 'General'`, `salary numeric(10,2) default 50000.00`, `leave_balance integer not null default 10`, `attendance_score integer not null default 100`, `created_at timestamptz default now()`.
   - `job_postings`: `id uuid primary key default gen_random_uuid()`, `title text not null`, `department text not null default 'Engineering'`, `description text not null`, `required_skills text not null default 'Not specified'`, `experience_years integer not null default 0`, `status text not null default 'draft'` (`draft | screening | pending_approval | approved | completed`), `created_by uuid references profiles(id)`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`.
   - `candidates`: `id uuid primary key default gen_random_uuid()`, `job_id uuid not null references job_postings(id) on delete cascade`, `name text not null default 'Unknown'`, `email text`, `match_score double precision not null default 0`, `matched_skills text not null default ''`, `interview_slot text not null default 'TBD'`, `email_subject text not null default ''`, `email_body text not null default ''`, `resume_source text not null default ''`, `resume_storage_path text not null default ''`, `email_sent boolean not null default false`, `status text not null default 'email_drafted'` (`shortlisted | email_drafted | email_sent | rejected`), `created_at timestamptz default now()`.
   - `resume_chunks`: `id uuid primary key default gen_random_uuid()`, `job_id uuid not null references job_postings(id) on delete cascade`, `source_file text not null`, `candidate_name text not null`, `candidate_email text not null default ''`, `chunk_index integer not null`, `content text not null`, `embedding vector(768) not null`, `created_at timestamptz default now()`.
   - `company_policies`: `id uuid primary key default gen_random_uuid()`, `title text not null`, `content text not null`, `last_updated timestamptz default now()`.
   - `faqs`: `id uuid primary key default gen_random_uuid()`, `question text not null`, `answer text not null`, `created_at timestamptz default now()`.
   - `performance_records`: `id uuid primary key default gen_random_uuid()`, `batch_id uuid not null`, `employee_id uuid not null references profiles(id) on delete cascade`, `review_period text not null`, `kpi_data text not null`, `performance_score integer`, `kpi_achievement_percent double precision`, `strengths text`, `areas_for_improvement text`, `recommended_actions text`, `created_at timestamptz default now()`.
   - `attendance_logs`: `id bigserial primary key`, `employee_id text not null`, `timestamp timestamptz not null`, `device_type text not null default 'rfid_scanner'`, `location text not null default 'Main Entrance'`, `tap_type text not null check (tap_type in ('IN', 'OUT'))`, `created_at timestamptz default now()`.
   - `attendance_reports`: `id uuid primary key default gen_random_uuid()`, `batch_id uuid not null`, `employee_name text not null`, `total_hours double precision not null`, `leaves_taken integer not null`, `ai_score integer`, `ai_feedback text not null`, `created_at timestamptz default now()`.
3. **Vector Search RPC**:
   - `match_resume_chunks(query_embedding vector(768), match_job_id uuid, match_count int default 30)` returning `source_file, candidate_name, candidate_email, content, similarity` ordered by `embedding <=> query_embedding`.
4. **Storage Bucket**:
   - `hr-uploads` (private bucket accessed via FastAPI service-role client for storing uploaded resumes).
5. **Auth Trigger**:
   - `on_auth_user_created` Postgres trigger automatically inserts a `profiles` row (`is_hr = false`, `department = 'General'`, `salary = 50000.00`, `leave_balance = 10`, `attendance_score = 100`) whenever a user signs up via Supabase Auth, unless overridden by `seed.py`.

---

## 3. Authentication, RBAC & Demo Access

- **Frontend Auth**: Uses `@supabase/supabase-js` `signInWithPassword` and `signUp`.
- **Demo Showcase Buttons** (on `/login` only):
  - **Demo HR Manager** (`admin@company.com` / `admin123`)
  - **Demo Employee** (`john@company.com` / `pass123`)
  - Implemented as client-side helper buttons that call `signInWithPassword` with the seeded credentials (overridable via `NEXT_PUBLIC_DEMO_*` env vars, hidden if disabled).
- **Backend Verification (`backend/app/deps.py`)**:
  - `get_current_user`: Extracts `Authorization: Bearer <token>`, validates the JWT via Supabase Auth (`supabase.auth.get_user(token)`), and fetches the matching row from `profiles`. Returns `401` on invalid/missing token.
  - `require_hr`: Checks `profile.is_hr is True`; returns `403` otherwise.
  - `require_employee`: Checks `profile.is_hr is False`; returns `403` otherwise (matching Django's `is_employee_check` on `/employee/chat/`).

---

## 4. Backend API & AI Workflows (FastAPI)

### Module 1: Recruitment Pipeline (LangGraph + `pgvector` + HITL)
- `GET /api/recruitment/jobs` (`require_hr`): List recent job postings with candidate counts.
- `POST /api/recruitment/screen` (`require_hr`, `multipart/form-data`):
  - Accepts `title`, `department`, `description`, `required_skills`, `experience_years`, and `resumes` (`PDF`/`DOCX`/`TXT`).
  - Uploads files to Supabase Storage (`hr-uploads/{job_id}/...`) and creates `job_postings(status="screening")`.
  - Runs LangGraph (`recruitment_graph.py`) nodes 1–4:
    1. `ingest_resumes`: Extract text (`PyPDF2` / `python-docx`), extract heuristic name/email, split into 800-char chunks (`overlap=100`), generate 768-dim embeddings via OpenRouter (`jinaai/jina-embeddings-v2-base-en`, falling back to zero vector on error just like original), insert into `resume_chunks`.
    2. `screen_candidates`: Query `match_resume_chunks` RPC (`match_count=30`, `match_job_id=job_id`), invoke `SCREENER_PROMPT | llm`, parse JSON array, filter `match_score >= 40`, deduplicate by name.
    3. `schedule_interviews`: Invoke `SCHEDULER_PROMPT | llm` to assign 45-minute weekday interview slots.
    4. `draft_emails`: Invoke `COMMUNICATOR_PROMPT | llm` to draft `subject` and `body` per candidate.
  - Persists `candidates` with `status="email_drafted"` and updates `job_postings.status = "pending_approval"`.
  - Returns `{ job_id, status: "pending_approval", candidates }`.
- `GET /api/recruitment/jobs/{job_id}` (`require_hr`): Returns job details + candidates (used by both `/approval` and `/success` pages).
- `POST /api/recruitment/jobs/{job_id}/approve` (`require_hr`):
  - Accepts `{ decisions: [{ candidate_id, approved: bool, email_subject, email_body, interview_slot }] }`.
  - For approved candidates with an email: dispatches email via `services/email.py` (SMTP if configured, otherwise logs cleanly to console so zero-config demos always succeed) and updates `status="email_sent", email_sent=True`.
  - For unapproved candidates: updates `status="rejected", email_sent=False`.
  - Updates `job_postings.status = "approved"` and returns updated summary.

### Module 2: Attendance Tracker & AI Timesheet Analysis
- `POST /api/attendance/tap` (Public hardware webhook, matching Django `@csrf_exempt`):
  - Accepts `{ employeeId, timestamp?, deviceType?, location? }`.
  - Counts today's `attendance_logs` for `employeeId`; even count → `tap_type="IN"`, odd → `tap_type="OUT"`. Inserts row and returns `201` with tap metadata.
- `GET /api/attendance/logs` (Authenticated; HR sees all recent logs, Employee sees their own `EMP-...` logs).
- `GET /api/attendance/export-excel` (`require_hr`): Streams `.xlsx` (styled via `openpyxl`, matching original emerald/amber color-coding).
- `POST /api/attendance/upload` (`require_hr`, `multipart/form-data`):
  - Parses `.xlsx`/`.xls` via `pandas` (`attendance.py`), groups by employee, computes `total_hours` and `leaves_taken`, invokes `ATTENDANCE_PROMPT | llm` for `ai_score` and `ai_feedback`.
  - Saves rows to `attendance_reports` under a generated `batch_id` and returns `{ batch_id, reports }`.
- `GET /api/attendance/reports?batch_id=...` (`require_hr`): Fetches the batch (or latest batch if omitted).
- `GET /api/attendance/reports/pdf?batch_id=...` (`require_hr`): Generates landscape PDF table via `reportlab` and streams `application/pdf`.

### Module 3: Bulk Performance Reviews
- `POST /api/performance/upload` (`require_hr`, `multipart/form-data`):
  - Accepts `review_period` and `performance_excel`.
  - Identifies employee column (`email` / `username` / `name` / `id`), resolves or auto-creates `profiles` row (and Supabase Auth user with default password if needed for demo Excel uploads), calls `generate_performance_review` (`PERFORMANCE_PROMPT | llm | PydanticOutputParser(PerformanceReviewResult)`).
  - Inserts `performance_records` with a shared `batch_id` and returns `{ batch_id, records }`.
- `GET /api/performance/reports?batch_id=...` (`require_hr`): Fetches records for the batch (or latest batch).
- `GET /api/performance/reports/pdf?batch_id=...` (`require_hr`): Streams structured `reportlab` PDF.

### Module 4: HR Knowledge Base Management
- `GET /api/kb/overview` (`require_hr`): Returns `policies`, `faqs`, and `employees` (`is_hr=False`).
- `POST /api/kb/policies`, `PUT /api/kb/policies/{id}`, `DELETE /api/kb/policies/{id}` (`require_hr`).
- `POST /api/kb/faqs`, `PUT /api/kb/faqs/{id}`, `DELETE /api/kb/faqs/{id}` (`require_hr`).

### Module 5: Employee AI Support Assistant
- `POST /api/chat` (`require_employee`):
  - Accepts `{ message }`.
  - Extracts keywords (`len > 3`), queries `company_policies` and `faqs` via case-insensitive `ilike` filters in Supabase Postgres, injects the authenticated employee's `profiles` fields (`username`, `department`, `salary`, `leave_balance`, `attendance_score`), and invokes `SUPPORT_AGENT_PROMPT | llm`.
  - Returns `{ response }`.

---

## 5. Frontend UI & Visual Parity (Next.js App Router)

- Preserves the exact **TalentAI** design system from `base.html`:
  - Fixed dark sidebar (`#1e2333`) with indigo active pill (`#544af4`), light canvas (`#f8fafc`), crisp white cards (`#ffffff`), `#e2e8f0` borders, and Lucide icons.
  - Role-filtered navigation:
    - **HR Manager**: `Dashboard`, `Attendance`, `Knowledge Base`, `Analytics`, plus `User Profile / Logout`.
    - **Employee**: `Attendance` (card tap simulator only), `AI Assistant`, plus `User Profile / Logout`. (Fixing the Django sidebar minor mismatch where HR could see the `AI Assistant` link despite the chat endpoint being employee-only.)
- **HITL Approval Screen** (`/recruitment/[jobId]/approval`):
  - Uses the circular SVG match-score ring and candidate cards from `ApprovalScreen.tsx`, paired with editable email subject/body, interview slot display, approve/reject toggle per candidate, and a primary **"Approve & Send Invitations"** CTA.
- **Error Handling & UX**:
  - Clear inline toast notifications for API/LLM errors, disabled loading spinners during AI calls, and client-side file-type validation (`.pdf/.docx` for resumes, `.xlsx/.xls` for timesheets/performance).

---

## 6. Verification & Testing Strategy

- **Backend (`pytest`)**: Automated unit and FastAPI `TestClient` tests mocking OpenRouter LLM responses and Supabase client calls to verify:
  - JWT auth & HR vs Employee RBAC (`401`/`403` enforcement).
  - Recruitment screening + HITL approval state transitions.
  - Hardware tap `IN`/`OUT` alternating logic and Excel parsing.
  - Performance structured output parsing and PDF/Excel export endpoints returning valid binary streams.
  - Employee support chat context assembly.
- **Frontend**: TypeScript typecheck (`tsc --noEmit`), Next.js production build (`npm run build`), and ESLint check.
