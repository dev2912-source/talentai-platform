# TalentAI — AI-Powered HR Operations & Talent Intelligence Platform

[![Next.js](https://img.shields.io/badge/Next.js-15_App_Router-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-1.0-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth_·_Postgres_·_pgvector_·_Storage-3ECF8E?logo=supabase)](https://supabase.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-AI_Workflows-blue)](https://langchain-ai.github.io/langgraph/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)

TalentAI is a portfolio-grade, full-stack HR Operations and Talent Intelligence platform. It pairs a **Next.js 15 (App Router)** frontend with a **FastAPI** backend and **Supabase** (Auth, PostgreSQL, pgvector, and Storage).

The platform modernizes end-to-end workforce operations:
1. **AI Recruitment Screening** using **pgvector** and a 4-node **LangGraph** workflow with a strict **Human-in-the-Loop (HITL)** approval gate before invitation dispatch.
2. **Attendance Tracker & Timesheet Intelligence** featuring a real-time hardware RFID tap webhook (`IN`/`OUT` toggle), timesheet Excel upload with AI reliability evaluations, and styled Excel/PDF report generation.
3. **Bulk AI Performance Reviews** for automated KPI scoring, strengths/improvements analysis, and downloadable PDF dossiers.
4. **Knowledge Base & Employee Support Copilot** with policy/FAQ management for HR and a context-grounded AI assistant for employees.
5. **Robust RBAC & Security** backed by Supabase Auth JWTs, Row-Level Security (RLS) on all 9 tables, sanitized server responses, and secure headers.

---

## 🏛 Architecture

```text
+-----------------------------------+        HTTPS + Bearer JWT        +-----------------------------------+
|      Next.js 15 App Router        | -------------------------------> |          FastAPI Backend          |
|  TypeScript · Tailwind v4 · UI    |                                  |  Pydantic · LangGraph · ReportLab |
+-----------------------------------+                                  +-----------------------------------+
                 |                                                                 |             |
                 | Supabase JS Auth                                  Service Role  |             | NVIDIA NIM API
                 v                                                                 v             v
+----------------------------------------------------------------------------------+   +-------------------+
|                                     Supabase                                     |   |    NVIDIA NIM /   |
|  Auth (JWT) · PostgreSQL + pgvector (match_resume_chunks) · Storage (hr-uploads) |   |  NV-EmbedQA-E5    |
+----------------------------------------------------------------------------------+   +-------------------+
```

### Repository Structure

```text
talentai-platform/
├── docker-compose.yml          # Multi-container orchestration (FastAPI :8000 + Next.js :3000)
├── supabase/
│   └── schema.sql              # DDL: 9 tables, pgvector index, RPC, storage bucket, triggers & RLS
├── backend/
│   ├── app/
│   │   ├── ai/                 # LangGraph recruitment graph, LLM prompts, embeddings, support agent
│   │   ├── models/             # Pydantic v2 schemas
│   │   ├── routers/            # Auth, recruitment, attendance, performance, KB, chat routers
│   │   ├── services/           # ReportLab PDF builders, openpyxl Excel exports, SMTP/console email
│   │   ├── config.py           # Typed settings loaded from environment
│   │   ├── db.py               # Supabase service-role client singleton
│   │   ├── deps.py             # FastAPI dependencies: JWT auth & HR/Employee RBAC guards
│   │   └── main.py             # Application factory, CORS, health endpoint
│   ├── tests/                  # 46 automated unit and integration tests (pytest)
│   ├── seed.py                 # Idempotent database seeder (Demo accounts, policies, FAQs)
│   ├── requirements.txt        # Backend Python dependencies
│   └── .env.example            # Backend environment template
└── frontend/
    ├── src/
    │   ├── app/                # App Router: /login, /signup, /recruitment, /attendance, /performance, /chat
    │   ├── components/         # AuthProvider, AuthGuard, Sidebar, FileDropzone, CircularScore
    │   └── lib/                # API client (apiFetch, blob helpers), Supabase client, TypeScript types
    ├── next.config.ts          # Next.js configuration with security headers
    ├── package.json            # Frontend Node dependencies & scripts
    └── .env.local.example      # Frontend environment template
```

---

## ✨ Key Modules & Features

### 1. AI Recruitment & HITL Approval Pipeline
- Upload `.pdf`, `.docx`, and `.txt` resumes directly into Supabase Storage (`hr-uploads`).
- Chunks text and generates 768-dimensional vector embeddings via `jina-embeddings-v2-base-en` stored in PostgreSQL `pgvector`.
- 4-node LangGraph pipeline (`ingest_resumes` → `screen_candidates` → `schedule_interviews` → `draft_emails`) pauses execution at `pending_approval`.
- **Human-in-the-Loop (HITL)** interface allows HR to adjust match thresholds, edit draft invitation emails, modify interview slots, or reject candidates.
- Once approved, emails are dispatched via SMTP (or logged in console mode) and audit states become immutable.

### 2. Attendance & Hardware Tap Telemetry
- Public hardware endpoint `POST /api/attendance/tap` records RFID/NFC/biometric scans, alternating between `IN` and `OUT` based on daily tap counts.
- Interactive **Card Tap Simulator** in the UI allows quick live testing for employees.
- HR timesheet upload (`.xlsx`/`.xls`) analyzed by AI to generate reliability scores, total hours, and feedback.
- Instant exports to styled Excel spreadsheets (`openpyxl`) and landscape executive PDF reports (`reportlab`).

### 3. Automated Performance Evaluation
- Upload departmental KPI spreadsheets for any review period.
- AI evaluates achievement percentages against targets and outputs structured scores, strengths, improvement areas, and action items.
- Batch reports saved to Supabase with one-click multi-page PDF generation.

### 4. Knowledge Base & Employee AI Support
- Full HR CRUD interface for Company Policies and Knowledge Base FAQs.
- Contextual Support Copilot (`POST /api/chat`) for employees that blends personal metrics (department, salary, leave balance, attendance score) with relevant company policy excerpts using keyword matching.

### 5. Enterprise Security & Hardening
- **Row-Level Security (RLS)** enabled across all 9 database tables.
- Function execution on `match_resume_chunks` restricted exclusively to `service_role`.
- Postgres trigger `handle_new_user()` hardcodes `is_hr = false` to prevent privilege escalation during user signup.
- Client error masking on HTTP 500s prevents internal stack traces from leaking to clients.
- Production HTTP response headers: `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`.

---

## 🚀 Free Production Deployment Guide

Deploy TalentAI for **$0/month** using Supabase, Render, and Vercel:

```
[ Frontend: Next.js ]  ──>  Vercel (Hobby Tier - Free)
[ Backend: FastAPI  ]  ──>  Render (Web Service - Free Tier)
[ Database/Storage  ]  ──>  Supabase (Free Tier: Postgres + pgvector + Auth + Storage)
[ AI / Embeddings   ]  ──>  NVIDIA NIM (Free developer credits)
```

### Step 1: Set Up Supabase (2 mins)
1. Sign up at [supabase.com](https://supabase.com) and create a new project.
2. Open the **SQL Editor** in the left sidebar.
3. Open [`supabase/schema.sql`](./supabase/schema.sql), paste the entire script into the editor, and click **Run**.
4. Navigate to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key
   - `service_role secret` key

### Step 2: Push Repository to GitHub (1 min)
Ensure your `.env` files are not committed (already protected by `.gitignore`):
```bash
git init
git add talentai-platform
git commit -m "Initial commit for TalentAI platform"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

### Step 3: Deploy Backend to Render (3 mins)
1. Sign up at [render.com](https://render.com) and click **New + → Web Service**.
2. Connect your GitHub repository.
3. Fill in the service configuration:
   - **Name**: `talentai-backend`
   - **Root Directory**: `talentai-platform/backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add the following **Environment Variables**:
   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Your Supabase Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase `service_role` secret key |
   | `SUPABASE_ANON_KEY` | Your Supabase `anon` public key |
   | `NVIDIA_API_KEY` | Your NVIDIA NIM API Key (`nvapi-...`) |
   | `NVIDIA_MODEL` | `z-ai/glm-5.3-flash` |
   | `NVIDIA_EMBEDDING_MODEL` | `nvidia/nv-embedqa-e5-v5` |
   | `FRONTEND_ORIGINS` | `*` *(or your Vercel URL once deployed)* |
5. Click **Create Web Service**.
6. Copy your public backend URL once live (e.g., `https://talentai-backend.onrender.com`).

*(Optional: Run `python seed.py` locally pointing to your production Supabase database to seed initial demo accounts).*

### Step 4: Deploy Frontend to Vercel (2 mins)
1. Sign up at [vercel.com](https://vercel.com) and click **Add New → Project**.
2. Import your GitHub repository.
3. In the project settings:
   - **Root Directory**: Click *Edit* and select `talentai-platform/frontend`.
   - **Framework Preset**: `Next.js`.
4. Under **Environment Variables**, add:
   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase `anon` public key |
   | `NEXT_PUBLIC_API_URL` | Your Render backend URL (e.g. `https://talentai-backend.onrender.com`) |
5. Click **Deploy**.

---

## 💻 Local Development Setup

### 1. Prerequisites
- Python 3.11+
- Node.js 20+
- Active Supabase project (or local Docker Supabase instance)
- NVIDIA NIM API Key (`build.nvidia.com`)

### 2. Environment Variables

**Backend:**
```bash
cp backend/.env.example backend/.env
# Fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NVIDIA_API_KEY
```

**Frontend:**
```bash
cp frontend/.env.local.example frontend/.env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL
```

### 3. Seed Database
```bash
cd backend
python seed.py
```

Demo Credentials created:
- **HR Manager:** `admin@company.com` / `admin123`
- **Employee:** `rohan@company.com` / `pass123`

*(The `/login` screen also includes 1-click Demo HR and Demo Employee login buttons for testing).*

### 4. Running the Servers

**Using Docker Compose:**
```bash
docker compose up --build
```

**Running Manually:**
```bash
# Terminal 1: Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) for the UI and [http://localhost:8000/docs](http://localhost:8000/docs) for the interactive Swagger documentation.

---

## 🧪 Testing & Verification

Run backend unit and integration test suite (46 tests):
```bash
cd backend
python -m pytest -v
```

Run frontend TypeScript verification and ESLint check:
```bash
cd frontend
npx tsc --noEmit
npm run lint
```

---

## 📄 License
This project is open-source under the MIT License.
