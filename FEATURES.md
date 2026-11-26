# TalentAI Platform — Complete Features, Workflows & Verification Guide

This document describes every implemented feature, end-to-end workflow, API endpoint, and step-by-step verification procedure for the **TalentAI HR Intelligence Platform** (`Next.js 15 App Router` + `FastAPI` + `Supabase` + `NVIDIA NIM`).

---

## Table of Contents
1. [Authentication & Role-Based Access Control (RBAC)](#1-authentication--role-based-access-control-rbac)
2. [HR Module 1: AI Recruitment & HITL Approval Pipeline](#2-hr-module-1-ai-recruitment--hitl-approval-pipeline)
3. [HR Module 2: Attendance Tracker & AI Timesheet Analysis](#3-hr-module-2-attendance-tracker--ai-timesheet-analysis)
4. [HR Module 3: Bulk AI Performance Evaluation](#4-hr-module-3-bulk-ai-performance-evaluation)
5. [HR Module 4: Knowledge Base & Employee Directory](#5-hr-module-4-knowledge-base--employee-directory)
6. [Employee Module: Self-Service AI Assistant & Attendance](#6-employee-module-self-service-ai-assistant--attendance)
7. [Security & Automated Test Verification](#7-security--automated-test-verification)

---

## 1. Authentication & Role-Based Access Control (RBAC)

### Implemented Features
- **Login-Only Entry (`/login`)**: Clean, responsive flexbox login card with email/password authentication via Supabase Auth and 1-click **Demo HR Login** (`admin@company.com`) and **Demo Employee Login** (`rohan@company.com`).
- **Role Guards (`AuthGuard` & FastAPI Dependencies)**:
  - Frontend `AuthGuard` routes HR managers (`is_hr = true`) to `/` and Employees (`is_hr = false`) to `/chat`.
  - Backend validates Supabase Bearer JWTs via `get_current_user` and enforces `require_hr` or `require_employee` on protected endpoints.
  - Invalid/expired tokens (`401`) automatically clear local auth state and sign out.
- **Responsive Navigation (`Sidebar`)**: Fixed dark navigation rail on desktop (`md+`) and slide-over mobile drawer with backdrop and `Esc` support on mobile (`< md`).

### How to Verify
1. Open `http://localhost:3000` while signed out → verify automatic redirect to `/login`.
2. Click **Demo HR Login** → verify redirect to `/` (Recruitment Dashboard) with 4 HR nav links (`Dashboard`, `Attendance`, `Knowledge Base`, `Analytics`).
3. Log out from the bottom user card, then click **Demo Employee Login** → verify redirect to `/chat` with 2 Employee nav links (`Attendance`, `AI Assistant`).
4. Try navigating to `http://localhost:3000/knowledge-base` as an Employee → verify automatic redirect back to `/chat`.

---

## 2. HR Module 1: AI Recruitment & HITL Approval Pipeline

### Architecture & Workflow
```text
[1. Job Form + Resumes] ──> [2. Supabase Storage (hr-uploads)] ──> [3. 4-Node LangGraph (NVIDIA NIM + pgvector)]
                                                                                │
[5. Results & Excel Export] <── [4. HITL Approval Gate (/approval)] <───────────┘ (status = "pending_approval")
```

### Implemented Features
- **Job Creation & Demo Helpers (`/`)**:
  - **Interactive KPI Cards**: **Total Postings**, **Pending HITL**, **Approved Pipelines**, and **Candidates Screened** (clickable to filter the table).
  - **Use Sample Job & Load Sample Resumes**: 1-click buttons to auto-fill a *Senior Full-Stack Engineer* job and attach 2 sample `.txt` resumes.
  - **Auto-Save Draft (`localStorage`) + Clear Button**: Preserves unsaved form fields across refreshes and clears on submit or **Clear**.
  - **Configurable Minimum AI Match Score (`min_score`)**: Slider (`0%`–`90%`, default `40%`) sent to `POST /api/recruitment/screen`.
  - **4-Step Live Progress Stepper**: Displays `Uploading & Chunking Resumes` → `pgvector Semantic Indexing` → `AI Candidate Scoring` → `Drafting HITL Interview Emails`.
- **Recent Job Postings Management (`/`)**:
  - Search by title/department/skills, filter by status (`All`, `Pending Approval`, `Approved`), sort (`Newest`, `Most Candidates`, `Title A–Z`), and paginate (`5` per page).
  - **Responsive Views**: Table on desktop (`md+`), stacked cards on mobile (`< md`).
  - **Preview & In-Place Edit Modal**: Click any job title to inspect full details or edit `draft`/`pending_approval` jobs (`PATCH /api/recruitment/jobs/{job_id}`).
  - **Reuse in Form**: Clone any job's details back into the creation form.
  - **Export Candidates (`.xlsx`)**: Download a styled Excel candidate report (`GET /api/recruitment/jobs/{job_id}/export`).
  - **Delete Job (`DELETE /api/recruitment/jobs/{job_id}`)**: 2-step confirmation that cascades DB rows and removes stored resumes from `hr-uploads`.
- **Human-in-the-Loop (HITL) Approval (`/recruitment/[jobId]/approval`)**:
  - **Email Delivery Mode Badge**: Shows **SMTP Live** or **Demo Console Mode**.
  - **Bulk Actions**: **Approve All**, **Approve ≥ 75%**, and **Reject All**.
  - **Filter & Sort**: Filter by `All / Approved / Rejected`, search candidates, and sort by score or name.
  - **Candidate Card Editing**: Edit **Email** (with amber **Missing Email** warning if blank), **Interview Slot**, **Email Subject**, and **Email Body**.
  - **Download Original Resume**: Stream the original `.pdf`/`.docx`/`.txt` file from Supabase Storage (`GET /api/recruitment/candidates/{candidate_id}/resume`).
  - **Add Manual Candidate (`POST /api/recruitment/jobs/{job_id}/candidates`)**: Add walk-in/referral candidates without uploading a resume.
  - **Screen More Resumes (`POST /api/recruitment/jobs/{job_id}/rescreen`)**: Screen additional resumes into an existing job without duplicating existing candidate emails.
  - **Remove Candidate (`DELETE /api/recruitment/candidates/{candidate_id}`)**: Remove unsent candidates with 2-step confirmation.
  - **Immutable Audit Trail**: Once `email_sent = true`, sent invitations cannot be overwritten or re-sent on re-submission.
- **Pipeline Completion (`/recruitment/[jobId]/success`)**:
  - Displays emails sent count, pipeline status, delivery mode, sent invitations table, and **Export Excel**.

### How to Verify
1. Sign in as **HR**, click **Use Sample Job**, then click **Load Sample Resumes**.
2. Set **Minimum AI Match Score** to `40%` and click **Run AI Screening**.
3. Verify the 4-step stepper runs and redirects to `/recruitment/<job_id>/approval` with shortlisted candidates and drafted emails.
4. On `/approval`, test **Download Resume**, edit an interview slot or email, try **Add Manual**, and test **Approve ≥ 75%**.
5. Click **Approve & Send Invitations** → verify redirect to `/recruitment/<job_id>/success`, check **Export Excel**, and return to `/` to verify the job shows **Approved** and **View Results**.

---

## 3. HR Module 2: Attendance Tracker & AI Timesheet Analysis

### Implemented Features
- **Live Summary Strip (`/attendance`)**: Displays **Recent Taps**, **Check-Ins**, **Check-Outs**, and **Latest Status** (`Checked In` / `Checked Out`).
- **Card Tap Simulator (`/attendance` & `POST /api/attendance/tap`)**:
  - Simulates RFID/NFC/Biometric/QR taps and automatically alternates `IN` (even tap count today) and `OUT` (odd tap count today).
- **Live Activity Log (`/attendance`)**:
  - Search by Employee ID, location, or device type; filter by `ALL / IN / OUT`; refresh logs; export all logs to `.xlsx` (`GET /api/attendance/export-excel`); and delete individual logs (`DELETE /api/attendance/logs/{log_id}`).
- **AI Timesheet Analysis (`/attendance` & `/attendance/report`)**:
  - **Sample Timesheet (.xlsx)**: 1-click download (`GET /api/attendance/sample-timesheet`) for instant testing.
  - **Upload Timesheet (`POST /api/attendance/upload`)**: Parses `.xlsx`/`.xls` files with `pandas`, evaluates reliability with NVIDIA NIM, and saves a new report batch.
  - **AI Attendance Report (`/attendance/report`)**:
    - 4 KPI cards (**Employees**, **Avg AI Score**, **Total Hours**, **Total Leaves**).
    - **Report History** dropdown (`GET /api/attendance/batches`) to switch between past batches.
    - Employee search, sorting (**AI Score**, **Total Hours**, **Leaves**, **Name A–Z**), **Download Excel** (`GET /api/attendance/reports/excel`), and **Download PDF** (`GET /api/attendance/reports/pdf`).

### How to Verify
1. Go to `/attendance` as **HR** and click the circular **Tap** button twice → verify the 1st tap records `IN` and the 2nd tap records `OUT`, updating the Live Activity Log and summary strip.
2. Test search, `IN / OUT` filter pills, **Export Excel**, and deleting a test tap row.
3. Under **AI Timesheet Analysis**, click **Sample Timesheet (.xlsx)** to download the sample file, drop it into the dropzone, and click **Generate AI Attendance Report**.
4. Verify redirect to `/attendance/report`, check the 4 KPI cards, test search/sort, **Download Excel**, and **Download PDF**.

---

## 4. HR Module 3: Bulk AI Performance Evaluation

### Implemented Features
- **Bulk KPI Upload (`/performance`)**:
  - **Sample KPI Sheet (.xlsx)**: 1-click download (`GET /api/performance/sample-kpi`) with sample employee KPIs.
  - **Generate Bulk Reviews (`POST /api/performance/upload`)**: Matches existing employees (never demoting HR users), auto-creates missing non-HR employee accounts, and generates structured AI evaluations.
- **AI Performance Reports (`/performance/report`)**:
  - **4 Executive KPI Cards**: **Reviewed**, **Avg AI Score**, **Avg KPI (%)**, and **Top Performer**.
  - **Review History** dropdown (`GET /api/performance/batches`) to switch between past review periods.
  - Search by employee name/email, filter by **Department**, and sort (**AI Score**, **KPI Achievement**, **Name A–Z**).
  - **Download Excel** (`GET /api/performance/reports/excel`) and **Download PDF** (`GET /api/performance/reports/pdf`).
  - **Delete Batch (`DELETE /api/performance/batches/{batch_id}`)**: 2-step confirmation to remove test batches.

### How to Verify
1. Go to `/performance` as **HR**, enter a Review Period (e.g. `Q4 2026`), and click **Sample KPI Sheet (.xlsx)**.
2. Drop the downloaded `.xlsx` file into the dropzone and click **Generate Bulk Reviews**.
3. Verify redirect to `/performance/report`, confirm the 4 KPI cards and qualitative sections (**Key Strengths**, **Areas for Improvement**, **Recommended Actions**) render properly.
4. Test **Department** filter, search, **Download Excel**, and **Download PDF**.

---

## 5. HR Module 4: Knowledge Base & Employee Directory

### Implemented Features
- **Top KPI Cards (`/knowledge-base`)**: Live counts for **Policies**, **FAQs**, **Employees**, and **Avg Attendance**.
- **Test AI Knowledge Base (`POST /api/kb/test-query`)**: Live query simulator on `/knowledge-base` so HR can verify how the AI Support Agent answers questions using the latest policies and FAQs.
- **Company Policies & FAQs CRUD**:
  - Create, edit, search, and delete policies (`/api/kb/policies*`) and FAQs (`/api/kb/faqs*`) with 2-step delete confirmation.
- **Employee Directory (`/api/kb/employees*`)**:
  - Search employees and filter by Department.
  - **Onboard New Employee (`POST /api/kb/employees`)**: Create a new non-HR employee auth account and profile from the **Add Employee** modal.
  - **Edit Employee Metrics (`PATCH /api/kb/employees/{employee_id}`)**: Update Department, Salary, Leave Balance, and Attendance Score in-place.

### How to Verify
1. Go to `/knowledge-base` as **HR** and create or edit a Policy / FAQ.
2. In **Test AI Knowledge Base**, type a question about that policy and click **Test Query** → verify the AI response reflects your updated policy.
3. Click **Add Employee** to create a test employee, or click **Edit** on `john` to update his leave balance/salary, and verify the updated values appear in the table.

---

## 6. Employee Module: Self-Service AI Assistant & Attendance

### Implemented Features
- **Employee AI Assistant (`/chat`)**:
  - **Live Profile Metrics Strip**: Shows the signed-in employee's **Department**, **Leave Balance**, **Attendance Score**, and **Salary** (with eye hide/show toggle).
  - **Formatted AI Responses**: Clean rendering of `**bold**` text, bullet lists, and numbered lists with **Copy** and **Regenerate** buttons.
  - **Persistent Chat Session (`localStorage`) + Export Transcript (`.txt`)**: Preserves conversation across tab switches/refreshes per user ID and exports transcripts.
  - **Quick Topics & Quick-Prompt Chips**: 1-click prompts for leave balance, remote work policy, salary details, and attendance score.
  - **Browse Policies & FAQs Modal (`GET /api/chat/kb`)**: Read-only searchable policy/FAQ browser with 1-click **Ask AI** buttons.
  - **My Performance Reviews Modal (`GET /api/performance/my-reviews`)**: View personal AI performance scores, KPI %, strengths, and action items.
- **Employee Attendance (`/attendance`)**:
  - **Card Tap Simulator**: Self-service check-in / check-out simulator.
  - **Hours Worked Today**: Automatically pairs today's `IN`/`OUT` taps and marks active shifts.
  - **My Recent Taps + Export Excel (`GET /api/attendance/my-export`)**: Search, filter (`ALL / IN / OUT`), refresh, and export personal tap logs.

### How to Verify
1. Sign in as **Employee** (`rohan@company.com`).
2. On `/chat`, verify the 4 live metrics cards match Rohan's profile, click a quick prompt (e.g. `"What is my leave balance?"`), and verify the formatted reply.
3. Test **Copy**, **Regenerate**, **Policies & FAQs**, **My Reviews**, and **Export Transcript** (and refresh the page to confirm chat persistence).
4. Switch to `/attendance`, tap IN and OUT, verify **My Recent Taps** updates, **Hours Today** calculates, and **Export Excel** downloads only Rohan's logs.

---

## 7. Security & Automated Test Verification

### Security Controls Implemented
- **Row-Level Security (RLS)** enabled on all 9 PostgreSQL tables in `supabase/schema.sql`.
- **`handle_new_user()` Trigger** hardcodes `is_hr = false` to prevent privilege escalation on signup.
- **`match_resume_chunks` RPC** restricted to `service_role` only.
- **HTTP Security Headers** configured in `frontend/next.config.ts` (`Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`).
- **Sanitized Error Responses**: Internal tracebacks are logged server-side and masked on HTTP 500s.

### Automated Verification Commands
Run the full backend test suite (54 tests):
```powershell
cd talentai-platform/backend
python -m pytest -v
```

Run frontend TypeScript and ESLint checks:
```powershell
cd talentai-platform/frontend
npx tsc --noEmit
npm run lint
```
