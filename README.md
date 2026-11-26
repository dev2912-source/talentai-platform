# TalentAI HR Intelligence Platform

A full-stack AI-powered HR Operations & Talent Intelligence platform built with **Next.js (App Router)**, **FastAPI**, and **Supabase** (`Auth`, `PostgreSQL`, `pgvector`, and `Storage`).

TalentAI streamlines end-to-end HR workflows—from RAG-based resume screening with a **Human-in-the-Loop (HITL)** interview invitation approval gate, to RFID card-tap attendance tracking, AI timesheet & KPI performance reviews, a policy knowledge base, and an employee self-service AI HR assistant.

---

## Key Features

- **AI Recruitment Pipeline (LangGraph + pgvector + HITL)**
  - Upload candidate resumes (`.pdf`, `.docx`, `.txt`) to Supabase Storage (`hr-uploads`) and index chunked embeddings (`768`-dim via `jinaai/jina-embeddings-v2-base-en`) into PostgreSQL `pgvector`.
  - Multi-step LangGraph workflow (`ingest_resumes` → `screen_candidates` → `schedule_interviews` → `draft_emails`) pauses at `status = "pending_approval"`.
  - HR managers inspect match scores, edit email subjects/bodies and interview slots on `/recruitment/[jobId]/approval`, and approve/reject candidates before dispatching invitations.
- **Attendance Tracker & AI Timesheet Analysis**
  - Public RFID hardware webhook (`POST /api/attendance/tap`) with automatic alternating `IN` / `OUT` tap state detection and an interactive Card Tap Simulator UI.
  - Styled `.xlsx` attendance export (`openpyxl`), bulk Excel timesheet upload (`pandas`), AI reliability scoring, and downloadable `reportlab` PDF reports.
- **Bulk AI Performance Reviews**
  - Upload employee KPI spreadsheets (`.xlsx` / `.xls`) for a review period; generates structured scores, KPI achievement percentages, strengths, areas for improvement, and recommended actions, plus downloadable PDF summaries.
- **HR Knowledge Base & Employee AI Support Assistant**
  - HR CRUD management for company policies, FAQs, and employee directory visibility.
  - Employee-only AI HR Assistant (`POST /api/chat`) combining keyword-matched company policies/FAQs with the signed-in employee's live profile metrics (department, salary, leave balance, attendance score).
- **Supabase Auth & Role-Based Access Control (RBAC)**
  - JWT verification on FastAPI endpoints via Supabase Auth, enforcing HR-only (`is_hr = true`) vs Employee-only (`is_hr = false`) routes.

---

## Architecture

```text
+-----------------------------------+        HTTPS + Bearer JWT        +-----------------------------------+
|      Next.js 15 App Router        | -------------------------------> |          FastAPI Backend          |
|  TypeScript · Tailwind v4 · UI    |                                  |  Pydantic · LangGraph · ReportLab |
+-----------------------------------+                                  +-----------------------------------+
                 |                                                                 |             |
                 | Supabase JS Auth                                  Service Role  |             | OpenRouter API
                 v                                                                 v             v
+----------------------------------------------------------------------------------+   +-------------------+
|                                     Supabase                                     |   |   OpenRouter /    |
|  Auth (JWT) · PostgreSQL + pgvector (match_resume_chunks) · Storage (hr-uploads) |   |  Jina Embeddings  |
+----------------------------------------------------------------------------------+   +-------------------+
```

### Repository Structure

```text
talentai-platform/
├── docker-compose.yml        # Multi-service runner (FastAPI :8000 + Next.js :3000)
├── supabase/
│   └── schema.sql            # Tables, pgvector extension, RPC, storage bucket, auth trigger, RLS
├── backend/                  # FastAPI API, LangGraph agents, PDF/Excel exports, seed & pytest suite
└── frontend/                 # Next.js App Router UI, Supabase Auth context, TalentAI design system
```

---

## Prerequisites

- **Supabase Project** (free tier or self-hosted) with PostgreSQL and Storage enabled
- **OpenRouter API Key** (for LLM completions and `jinaai/jina-embeddings-v2-base-en` embeddings)
- **Python 3.11+** and **Node.js 20+** (for local development), or **Docker & Docker Compose**

---

## 1. Supabase Setup

1. Open your Supabase project dashboard and navigate to **SQL Editor**.
2. Copy the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) and execute it.
3. Verify that the script created:
   - Extensions: `vector`, `pgcrypto`
   - Tables: `profiles`, `job_postings`, `candidates`, `resume_chunks`, `company_policies`, `faqs`, `performance_records`, `attendance_logs`, `attendance_reports`
   - Trigger & Function: `on_auth_user_created` / `public.handle_new_user()`
   - Vector Search RPC: `public.match_resume_chunks(query_embedding, match_job_id, match_count)`
   - Private Storage Bucket: `hr-uploads`

---

## 2. Environment Configuration

### Backend (`backend/.env`)

Copy `backend/.env.example` to `backend/.env` and populate your credentials:

```bash
cp backend/.env.example backend/.env
```

Required variables:
- `SUPABASE_URL` — Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (used by FastAPI for DB, Storage, and admin seeding)
- `SUPABASE_ANON_KEY` — Project anon/public key
- `OPENROUTER_API_KEY` — OpenRouter API key for LLM & Jina embeddings
- `OPENROUTER_MODEL` — Chat model identifier (e.g. `openai/gpt-4o-mini` or configured model)
- `FRONTEND_ORIGINS` — Allowed CORS origins (default: `http://localhost:3000`)
- `SMTP_*` *(optional)* — SMTP host/port/credentials if sending live interview invitation emails (otherwise emails log cleanly to console)

### Frontend (`frontend/.env.local`)

Copy `frontend/.env.local.example` to `frontend/.env.local`:

```bash
cp frontend/.env.local.example frontend/.env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project anon/public key
- `NEXT_PUBLIC_API_URL` — FastAPI base URL (default: `http://localhost:8000`)

---

## 3. Seed Demo Data

Run the idempotent seed script from `backend/` to create the demo HR Manager, demo Employee, company policies, and FAQs:

```bash
cd backend
python seed.py
```

### Demo Credentials

| Role | Email | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **HR Manager** | `admin@company.com` | `admin123` | Recruitment HITL, Attendance Reports, Knowledge Base, Performance Reviews |
| **Employee** | `john@company.com` | `pass123` | Attendance Card Tap Simulator, Employee AI HR Assistant |

*(The `/login` page also provides 1-click Demo HR and Demo Employee login buttons.)*

---

## 4. Running the Application

### Option A: Docker Compose

Ensure `backend/.env` and `frontend/.env.local` exist, then start both services:

```bash
docker compose up --build
```

- **Frontend UI:** http://localhost:3000
- **Backend API & Swagger Docs:** http://localhost:8000/docs
- **Health Check:** http://localhost:8000/health

### Option B: Local Development Servers

**Backend (FastAPI):**
```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate  |  macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend (Next.js):**
```bash
cd frontend
npm install
npm run dev
```

---

## API Overview

| Module | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| **Health / Auth** | `GET /health`, `GET /api/auth/me` | Public / JWT | Service health & authenticated user profile |
| **Recruitment** | `GET /api/recruitment/jobs`, `POST /api/recruitment/screen`, `GET /api/recruitment/jobs/{job_id}`, `POST /api/recruitment/jobs/{job_id}/approve` | HR (`is_hr=true`) | List jobs, run RAG screening + HITL pause, review & send approved invitations |
| **Attendance** | `POST /api/attendance/tap` | Public webhook | Hardware RFID tap (`IN` / `OUT` toggle) |
| **Attendance HR** | `GET /api/attendance/logs`, `GET /api/attendance/export-excel`, `POST /api/attendance/upload`, `GET /api/attendance/reports`, `GET /api/attendance/reports/pdf` | Auth / HR | View logs, export `.xlsx`, analyze timesheets, download PDF |
| **Performance** | `POST /api/performance/upload`, `GET /api/performance/reports`, `GET /api/performance/reports/pdf` | HR (`is_hr=true`) | Bulk KPI Excel review generation & PDF export |
| **Knowledge Base** | `GET /api/kb/overview`, CRUD `/api/kb/policies*`, CRUD `/api/kb/faqs*` | HR (`is_hr=true`) | Manage company policies, FAQs, and employee directory |
| **Employee Chat** | `POST /api/chat` | Employee (`is_hr=false`) | Policy/FAQ + profile-grounded AI HR assistant |

---

## Verification & Testing

Run backend unit & API tests:
```bash
cd backend && pytest -v
```

Run frontend typecheck & production build:
```bash
cd frontend && npx tsc --noEmit && npm run build
```
