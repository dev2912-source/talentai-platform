"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Edit2,
  FilePlus2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiDownloadBlob, apiFetch, triggerBlobDownload } from "@/lib/api";
import type { JobPostingOut, JobPostingSummaryOut, ScreenJobResponse } from "@/lib/types";

const DRAFT_STORAGE_KEY = "talentai_job_draft_v1";
const JOBS_PER_PAGE = 5;

const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "HR",
] as const;

const PIPELINE_STEPS = [
  "Uploading & Chunking Resumes",
  "pgvector Semantic Indexing",
  "AI Candidate Scoring",
  "Drafting HITL Interview Emails",
] as const;

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "pending_approval", label: "Pending Approval" },
  { id: "approved", label: "Approved" },
] as const;

const STATUS_STYLES: Record<string, { label: string; badgeClass: string }> = {
  pending_approval: {
    label: "Pending Approval",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
  approved: {
    label: "Approved",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  screening: {
    label: "Screening",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  draft: {
    label: "Draft",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStatusMeta(status: string) {
  return (
    STATUS_STYLES[status] ?? {
      label: status.replace(/_/g, " "),
      badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    }
  );
}

function buildSampleResumeFiles(): File[] {
  const resumeOne = new File(
    [
      `Aarav Mehta
aarav.mehta@example.com
Senior Full-Stack Engineer | 5+ Years Experience | Bengaluru

SUMMARY
Full-stack engineer specializing in Python, FastAPI, Next.js, TypeScript, and PostgreSQL with production experience building pgvector RAG pipelines.

EXPERIENCE
- Senior Software Engineer, FinTech India Labs, Bengaluru (2022–Present): Built scalable FastAPI microservices, Next.js App Router dashboards, and semantic document search using pgvector.
- Full-Stack Developer, CloudScale India, Pune (2020–2022): Developed TypeScript React applications, REST APIs, and automated CI/CD workflows.

SKILLS
Python, FastAPI, Next.js, TypeScript, PostgreSQL, pgvector, Docker, LangGraph`,
    ],
    "aarav_mehta_fullstack.txt",
    { type: "text/plain" },
  );

  const resumeTwo = new File(
    [
      `Neha Deshmukh
neha.deshmukh@example.com
Backend & API Engineer | 3+ Years Experience | Pune

SUMMARY
Backend engineer focused on high-throughput Python APIs, PostgreSQL query optimization, and containerized deployments.

EXPERIENCE
- Backend Engineer, DataStream India Pvt. Ltd., Pune (2023–Present): Built FastAPI services, async workers, and PostgreSQL schemas.
- Junior Python Developer, WebCore Technologies, Hyderabad (2022–2023): Maintained REST endpoints and wrote pytest integration suites.

SKILLS
Python, FastAPI, PostgreSQL, Docker, Pytest, REST APIs`,
    ],
    "neha_deshmukh_backend.txt",
    { type: "text/plain" },
  );

  return [resumeOne, resumeTwo];
}

function RecruitmentDashboardContent() {
  const router = useRouter();
  const { token } = useAuth();

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<string>("Engineering");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [experienceYears, setExperienceYears] = useState("0");
  const [minScore, setMinScore] = useState(40);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const formTopRef = useRef<HTMLFormElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobPostingSummaryOut[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "candidates" | "title">("newest");
  const [currentPage, setCurrentPage] = useState(1);
  const [previewJob, setPreviewJob] = useState<JobPostingSummaryOut | null>(
    null,
  );
  const [editingPreview, setEditingPreview] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDepartment, setEditDepartment] = useState("Engineering");
  const [editSkills, setEditSkills] = useState("");
  const [editExp, setEditExp] = useState("0");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  const draftLoadedRef = useRef(false);

  const loadJobs = useCallback(async () => {
    if (!token) {
      setLoadingJobs(false);
      return;
    }
    setLoadingJobs(true);
    setJobsError(null);
    try {
      const data = await apiFetch<JobPostingSummaryOut[]>(
        "/api/recruitment/jobs",
        {},
        token,
      );
      setJobs(data);
    } catch (err) {
      setJobsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load recent job postings.",
      );
    } finally {
      setLoadingJobs(false);
    }
  }, [token]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (draftLoadedRef.current) return;
    draftLoadedRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        title: string;
        department: string;
        requiredSkills: string;
        experienceYears: string;
        description: string;
        minScore: number;
      }>;
      if (parsed.title) setTitle(parsed.title);
      if (parsed.department) setDepartment(parsed.department);
      if (parsed.requiredSkills) setRequiredSkills(parsed.requiredSkills);
      if (parsed.experienceYears) setExperienceYears(parsed.experienceYears);
      if (parsed.description) setDescription(parsed.description);
      if (typeof parsed.minScore === "number") setMinScore(parsed.minScore);
    } catch {
      // Ignore malformed draft in localStorage.
    }
  }, []);

  useEffect(() => {
    if (!draftLoadedRef.current) return;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({
          title,
          department,
          requiredSkills,
          experienceYears,
          description,
          minScore,
        }),
      );
    } catch {
      // Ignore storage quota errors.
    }
  }, [title, department, requiredSkills, experienceYears, description, minScore]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, sortBy]);

  useEffect(() => {
    if (!submitting) {
      setPipelineStep(0);
      return;
    }
    const timer = setInterval(() => {
      setPipelineStep((prev) =>
        prev < PIPELINE_STEPS.length - 1 ? prev + 1 : prev,
      );
    }, 2400);
    return () => clearInterval(timer);
  }, [submitting]);

  useEffect(() => {
    if (!previewJob) {
      setEditingPreview(false);
      return;
    }
    setEditingPreview(false);
    setEditTitle(previewJob.title);
    setEditDepartment(previewJob.department || "Engineering");
    setEditSkills(previewJob.required_skills || "");
    setEditExp(String(previewJob.experience_years ?? 0));
    setEditDesc(previewJob.description || "");
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPreviewJob(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewJob]);

  function handleClearForm() {
    if (submitting) return;
    setTitle("");
    setDepartment("Engineering");
    setRequiredSkills("");
    setExperienceYears("0");
    setMinScore(40);
    setDescription("");
    setFiles([]);
    setSubmitError(null);
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }

  async function handleSaveJobEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !previewJob || savingEdit) return;
    setSavingEdit(true);
    setJobsError(null);
    try {
      const updated = await apiFetch<JobPostingOut>(
        `/api/recruitment/jobs/${previewJob.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: editTitle.trim(),
            department: editDepartment,
            required_skills: editSkills.trim() || "Not specified",
            experience_years: Math.max(0, Number.parseInt(editExp, 10) || 0),
            description: editDesc.trim(),
          }),
        },
        token,
      );
      const merged: JobPostingSummaryOut = {
        ...updated,
        candidate_count: previewJob.candidate_count,
      };
      setJobs((prev) => prev.map((j) => (j.id === merged.id ? merged : j)));
      setPreviewJob(merged);
      setEditingPreview(false);
    } catch (err) {
      setJobsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to update job posting.",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  function handleFillSampleJob() {
    if (submitting) return;
    setTitle("Senior Full-Stack Engineer (Bengaluru / Hybrid)");
    setDepartment("Engineering");
    setRequiredSkills("Python, FastAPI, Next.js, TypeScript, PostgreSQL");
    setExperienceYears("3");
    setDescription(
      "We are looking for a Senior Full-Stack Engineer based in Bengaluru (Hybrid) to design scalable FastAPI microservices, build responsive Next.js App Router interfaces, and integrate AI-powered RAG workflows with PostgreSQL and pgvector.",
    );
    setSubmitError(null);
  }

  function handleLoadSampleResumes() {
    if (submitting) return;
    setFiles(buildSampleResumeFiles());
    setSubmitError(null);
  }

  function handleCloneJob(job: JobPostingSummaryOut) {
    if (submitting) return;
    setTitle(job.title);
    setDepartment(job.department || "Engineering");
    setRequiredSkills(job.required_skills || "");
    setExperienceYears(String(job.experience_years ?? 0));
    setDescription(job.description || "");
    setPreviewJob(null);
    setSubmitError(null);
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleDeleteJob(jobId: string) {
    if (!token || deletingJobId) return;
    setDeletingJobId(jobId);
    setJobsError(null);
    try {
      await apiFetch<{ status: string; id: string }>(
        `/api/recruitment/jobs/${jobId}`,
        { method: "DELETE" },
        token,
      );
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setConfirmDeleteId(null);
      if (previewJob?.id === jobId) {
        setPreviewJob(null);
      }
    } catch (err) {
      setJobsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to delete job posting.",
      );
    } finally {
      setDeletingJobId(null);
    }
  }

  async function handleExportJob(job: JobPostingSummaryOut) {
    if (!token || exportingJobId) return;
    setExportingJobId(job.id);
    setJobsError(null);
    try {
      const blob = await apiDownloadBlob(
        `/api/recruitment/jobs/${job.id}/export`,
        token,
      );
      const slug =
        job.title.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") ||
        "candidates";
      triggerBlobDownload(blob, `${slug}_candidates.xlsx`);
    } catch (err) {
      setJobsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to export candidates Excel report.",
      );
    } finally {
      setExportingJobId(null);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    if (!token) {
      setSubmitError("Authentication session missing. Please sign in again.");
      return;
    }

    if (!title.trim() || !description.trim()) {
      setSubmitError("Job title and job description are required.");
      return;
    }

    if (files.length === 0) {
      setSubmitError("Please upload at least one candidate resume to screen.");
      return;
    }

    const parsedExp = Math.max(0, Number.parseInt(experienceYears, 10) || 0);
    const formData = new FormData();
    formData.append("title", title.trim());
    formData.append("department", department);
    formData.append("description", description.trim());
    formData.append(
      "required_skills",
      requiredSkills.trim() || "Not specified",
    );
    formData.append("experience_years", String(parsedExp));
    formData.append("min_score", String(minScore));
    for (const file of files) {
      formData.append("resumes", file);
    }

    setPipelineStep(0);
    setSubmitting(true);
    try {
      const res = await apiFetch<ScreenJobResponse>(
        "/api/recruitment/screen",
        {
          method: "POST",
          body: formData,
        },
        token,
      );
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Ignore storage errors.
      }
      router.push(`/recruitment/${res.job_id}/approval`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "AI screening failed. Please try again.",
      );
      setSubmitting(false);
    }
  }

  const kpis = useMemo(() => {
    const pendingCount = jobs.filter(
      (j) => j.status === "pending_approval",
    ).length;
    const approvedCount = jobs.filter(
      (j) => j.status === "approved" || j.status === "completed",
    ).length;
    const totalCandidates = jobs.reduce(
      (sum, j) => sum + (j.candidate_count || 0),
      0,
    );
    return {
      totalJobs: jobs.length,
      pendingCount,
      approvedCount,
      totalCandidates,
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = jobs.filter((job) => {
      if (
        statusFilter === "pending_approval" &&
        job.status !== "pending_approval"
      ) {
        return false;
      }
      if (
        statusFilter === "approved" &&
        job.status !== "approved" &&
        job.status !== "completed"
      ) {
        return false;
      }
      if (!q) return true;
      return (
        job.title.toLowerCase().includes(q) ||
        job.department.toLowerCase().includes(q) ||
        job.required_skills.toLowerCase().includes(q)
      );
    });
    return [...matched].sort((a, b) => {
      if (sortBy === "candidates") {
        return (b.candidate_count || 0) - (a.candidate_count || 0);
      }
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });
  }, [jobs, searchQuery, sortBy, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedJobs = useMemo(() => {
    const start = (safePage - 1) * JOBS_PER_PAGE;
    return filteredJobs.slice(start, start + JOBS_PER_PAGE);
  }, [filteredJobs, safePage]);

  return (
    <div className="p-1 sm:p-2 md:p-4 max-w-[1200px] mx-auto space-y-6 sm:space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-[28px] font-semibold text-slate-800 tracking-tight">
            Recruitment Dashboard
          </h2>
          <p className="text-sm sm:text-base text-slate-500 mt-1">
            Post new positions, screen resumes with AI, and review HITL
            invitations
          </p>
        </div>
      </div>

      {/* Interactive KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`text-left bg-white rounded-2xl border p-4 sm:p-5 shadow-sm flex items-center gap-3.5 transition-all cursor-pointer ${
            statusFilter === "all"
              ? "border-[#1f48d9]/50 ring-2 ring-[#1f48d9]/15"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1f48d9] flex items-center justify-center shrink-0">
            <Briefcase className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Total Postings
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-800">
              {kpis.totalJobs}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("pending_approval")}
          className={`text-left bg-white rounded-2xl border p-4 sm:p-5 shadow-sm flex items-center gap-3.5 transition-all cursor-pointer relative ${
            statusFilter === "pending_approval"
              ? "border-amber-400 ring-2 ring-amber-400/20"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          {kpis.pendingCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-3 right-3 flex h-2.5 w-2.5"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
          )}
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Pending HITL
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-800">
              {kpis.pendingCount}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter("approved")}
          className={`text-left bg-white rounded-2xl border p-4 sm:p-5 shadow-sm flex items-center gap-3.5 transition-all cursor-pointer ${
            statusFilter === "approved"
              ? "border-emerald-400 ring-2 ring-emerald-400/20"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Approved Pipelines
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-800">
              {kpis.approvedCount}
            </p>
          </div>
        </button>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#f0efff] text-[#544af4] flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Candidates Screened
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-800">
              {kpis.totalCandidates}
            </p>
          </div>
        </div>
      </div>

      {submitError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
          <span>{submitError}</span>
        </div>
      )}

      {/* 2-Column Screening Form */}
      <form ref={formTopRef} onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Left Card: Job Details */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm flex flex-col h-full">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
              <h3 className="flex items-center gap-2 font-semibold text-lg text-slate-800">
                Job Details
                <Sparkles className="w-4 h-4 text-accent" />
              </h3>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleFillSampleJob}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f0efff] hover:bg-indigo-100 text-[#544af4] text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>Use Sample Job</span>
                </button>
                {(title || description || requiredSkills || files.length > 0) && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleClearForm}
                    title="Clear form draft"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-5 flex-1">
              <div>
                <label
                  htmlFor="job-title"
                  className="block mb-2 text-[13px] font-medium text-slate-500"
                >
                  Job Title
                </label>
                <input
                  id="job-title"
                  type="text"
                  required
                  disabled={submitting}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Senior Software Engineer"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm placeholder:text-slate-400 disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="department"
                  className="block mb-2 text-[13px] font-medium text-slate-500"
                >
                  Department
                </label>
                <div className="relative">
                  <select
                    id="department"
                    disabled={submitting}
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-4 py-3 pr-10 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm appearance-none disabled:opacity-60"
                  >
                    {DEPARTMENTS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-500 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="required-skills"
                    className="block mb-2 text-[13px] font-medium text-slate-500"
                  >
                    Required Skills
                  </label>
                  <input
                    id="required-skills"
                    type="text"
                    disabled={submitting}
                    value={requiredSkills}
                    onChange={(e) => setRequiredSkills(e.target.value)}
                    placeholder="e.g. Python, FastAPI, LangGraph"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm placeholder:text-slate-400 disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="experience-years"
                    className="block mb-2 text-[13px] font-medium text-slate-500"
                  >
                    Min Experience (Yrs)
                  </label>
                  <input
                    id="experience-years"
                    type="number"
                    min={0}
                    step={1}
                    disabled={submitting}
                    value={experienceYears}
                    onChange={(e) => setExperienceYears(e.target.value)}
                    placeholder="0+"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm placeholder:text-slate-400 disabled:opacity-60"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="job-description"
                  className="block mb-2 text-[13px] font-medium text-slate-500"
                >
                  Job Description
                </label>
                <textarea
                  id="job-description"
                  rows={5}
                  required
                  disabled={submitting}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the role, responsibilities, and requirements..."
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all resize-none text-sm placeholder:text-slate-400 disabled:opacity-60"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="min-score"
                    className="text-[13px] font-medium text-slate-500"
                  >
                    Minimum AI Match Score
                  </label>
                  <span className="px-2 py-0.5 rounded-md bg-[#f0efff] text-[#544af4] text-xs font-semibold">
                    {minScore}%
                  </span>
                </div>
                <input
                  id="min-score"
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  disabled={submitting}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full accent-[#544af4] cursor-pointer disabled:opacity-60"
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-0.5">
                  <span>0% (All)</span>
                  <span>40% (Default)</span>
                  <span>90% (Strict)</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 bg-[#1f48d9] hover:bg-[#1a3cb8] text-white font-medium rounded-xl transition-colors text-[15px] shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Running AI Screening...</span>
                  </>
                ) : (
                  <span>Run AI Screening</span>
                )}
              </button>
            </div>
          </div>

          {/* Right Card: Candidate Ingestion */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm flex flex-col h-full gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-lg text-slate-800">
                  Candidate Ingestion
                </h3>
                <span className="px-3 py-1 text-[11px] bg-[#f0efff] text-[#544af4] font-medium rounded-full">
                  AI-Powered
                </span>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={handleLoadSampleResumes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
              >
                <FilePlus2 className="w-3.5 h-3.5" />
                <span>Load Sample Resumes</span>
              </button>
            </div>

            <FileDropzone
              files={files}
              onFilesChange={setFiles}
              accept=".pdf,.docx,.txt"
              multiple
              disabled={submitting}
              className="flex-1"
            />

            {/* 4-Step Live Pipeline Stepper while screening */}
            {submitting && (
              <div
                aria-live="polite"
                className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  LangGraph Screening Pipeline
                </p>
                <div className="space-y-2">
                  {PIPELINE_STEPS.map((label, idx) => {
                    const isDone = idx < pipelineStep;
                    const isActive = idx === pipelineStep;
                    return (
                      <div
                        key={label}
                        className="flex items-center gap-2.5 text-xs"
                      >
                        {isDone ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 text-[#544af4] animate-spin shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-slate-300 shrink-0" />
                        )}
                        <span
                          className={
                            isDone
                              ? "text-emerald-700 font-medium"
                              : isActive
                                ? "text-slate-800 font-semibold"
                                : "text-slate-400"
                          }
                        >
                          {idx + 1}. {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </form>

      {/* Recent Job Postings */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Briefcase className="w-5 h-5 text-accent shrink-0" />
              <h3 className="font-semibold text-lg text-slate-800">
                Recent Job Postings
              </h3>
              <span className="text-xs font-medium text-slate-400">
                ({filteredJobs.length})
              </span>
            </div>

            <button
              type="button"
              onClick={loadJobs}
              disabled={loadingJobs}
              title="Refresh job postings"
              aria-label="Refresh job postings"
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingJobs ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search jobs or skills..."
                className="w-full sm:w-56 pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white transition-all"
              />
            </div>

            {/* Status Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {STATUS_FILTERS.map((filter) => {
                const active = statusFilter === filter.id;
                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() => setStatusFilter(filter.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                      active
                        ? "bg-[#544af4] text-white shadow-xs"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {filter.label}
                  </button>
                );
              })}

              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "newest" | "candidates" | "title")
                }
                aria-label="Sort job postings"
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="newest">Newest</option>
                <option value="candidates">Most Candidates</option>
                <option value="title">Title A–Z</option>
              </select>

              <button
                type="button"
                onClick={loadJobs}
                disabled={loadingJobs}
                title="Refresh job postings"
                aria-label="Refresh job postings"
                className="hidden lg:inline-flex p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loadingJobs ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>
        </div>

        {loadingJobs ? (
          <div className="p-10 flex items-center justify-center gap-3 text-slate-500 text-sm">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span>Loading recent job postings...</span>
          </div>
        ) : jobsError ? (
          <div className="p-6 text-sm text-red-600 flex items-center justify-between gap-4">
            <span>{jobsError}</span>
            <button
              type="button"
              onClick={loadJobs}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            {jobs.length === 0
              ? "No job postings yet. Create your first job posting above to screen candidates."
              : "No job postings match your current search or filter."}
          </div>
        ) : (
          <>
            {/* Mobile Card View (< md) */}
            <div className="md:hidden divide-y divide-slate-200">
              {paginatedJobs.map((job) => {
                const statusMeta = getStatusMeta(job.status);
                const isPendingApproval = job.status === "pending_approval";
                const isDone =
                  job.status === "approved" || job.status === "completed";

                return (
                  <div key={job.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setPreviewJob(job)}
                        className="text-left min-w-0 cursor-pointer group"
                      >
                        <div className="font-semibold text-slate-800 group-hover:text-[#544af4] transition-colors">
                          {job.title}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {job.department} &middot; {job.required_skills}
                        </div>
                      </button>

                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border shrink-0 ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        {job.candidate_count}{" "}
                        {job.candidate_count === 1 ? "candidate" : "candidates"}
                      </span>
                      <span>{formatDate(job.created_at)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isPendingApproval ? (
                        <Link
                          href={`/recruitment/${job.id}/approval`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium hover:bg-[#4338ca] transition-colors"
                        >
                          Review &amp; Approve
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      ) : isDone ? (
                        <Link
                          href={`/recruitment/${job.id}/success`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
                        >
                          View Results
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      ) : (
                        <div className="flex-1 text-xs text-slate-400">
                          In progress
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCloneJob(job)}
                        title="Reuse job details"
                        aria-label={`Reuse ${job.title}`}
                        className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === job.id ? (
                        <button
                          type="button"
                          disabled={deletingJobId === job.id}
                          onClick={() => void handleDeleteJob(job.id)}
                          className="px-2.5 py-2 rounded-xl bg-red-600 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                        >
                          {deletingJobId === job.id ? "..." : "Delete"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(job.id)}
                          title="Delete job posting"
                          aria-label={`Delete ${job.title}`}
                          className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3.5 font-semibold">Position</th>
                    <th className="px-6 py-3.5 font-semibold">Department</th>
                    <th className="px-6 py-3.5 font-semibold">Candidates</th>
                    <th className="px-6 py-3.5 font-semibold">Status</th>
                    <th className="px-6 py-3.5 font-semibold">Created</th>
                    <th className="px-6 py-3.5 font-semibold text-right">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {paginatedJobs.map((job) => {
                    const statusMeta = getStatusMeta(job.status);
                    const isPendingApproval = job.status === "pending_approval";
                    const isDone =
                      job.status === "approved" || job.status === "completed";

                    return (
                      <tr
                        key={job.id}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => setPreviewJob(job)}
                            className="text-left cursor-pointer group"
                          >
                            <div className="font-medium text-slate-800 group-hover:text-[#544af4] transition-colors">
                              {job.title}
                            </div>
                            <div className="text-xs text-slate-400 truncate max-w-xs">
                              {job.required_skills}
                            </div>
                          </button>
                        </td>
                        <td className="px-6 py-4 text-slate-600 whitespace-nowrap">
                          {job.department}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                            <Users className="w-4 h-4 text-slate-400" />
                            {job.candidate_count}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusMeta.badgeClass}`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 whitespace-nowrap">
                          {formatDate(job.created_at)}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            {isPendingApproval ? (
                              <Link
                                href={`/recruitment/${job.id}/approval`}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#544af4] text-white text-xs font-medium hover:bg-[#4338ca] transition-colors"
                              >
                                Review &amp; Approve
                                <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            ) : isDone ? (
                              <Link
                                href={`/recruitment/${job.id}/success`}
                                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
                              >
                                View Results
                                <ArrowRight className="w-3.5 h-3.5" />
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-400">
                                In progress
                              </span>
                            )}

                            {job.candidate_count > 0 && (
                              <button
                                type="button"
                                disabled={exportingJobId === job.id}
                                onClick={() => void handleExportJob(job)}
                                title="Export candidates to Excel"
                                aria-label={`Export ${job.title} candidates`}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-700 hover:border-emerald-200 hover:bg-emerald-50 transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {exportingJobId === job.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleCloneJob(job)}
                              title="Reuse job details"
                              aria-label={`Reuse ${job.title}`}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-[#544af4] hover:border-indigo-200 hover:bg-[#f0efff] transition-colors cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>

                            {confirmDeleteId === job.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={deletingJobId === job.id}
                                  onClick={() => void handleDeleteJob(job.id)}
                                  className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                                >
                                  {deletingJobId === job.id ? "..." : "Confirm"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-slate-200 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(job.id)}
                                title="Delete job posting"
                                aria-label={`Delete ${job.title}`}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalPages > 1 && (
              <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>{" "}
                  ({filteredJobs.length} total)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Job Description Quick-Preview Modal */}
      {previewJob && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preview-job-title"
          onClick={() => setPreviewJob(null)}
        >
          <div
            className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3
                  id="preview-job-title"
                  className="text-lg font-semibold text-slate-800 truncate"
                >
                  {previewJob.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {previewJob.department} &middot; {previewJob.experience_years}
                  + years &middot; Created {formatDate(previewJob.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewJob(null)}
                aria-label="Close job preview"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {editingPreview ? (
                <form id="edit-job-form" onSubmit={handleSaveJobEdit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Job Title
                    </label>
                    <input
                      type="text"
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Department
                      </label>
                      <select
                        value={editDepartment}
                        onChange={(e) => setEditDepartment(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white"
                      >
                        {DEPARTMENTS.map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Min Experience (Yrs)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={editExp}
                        onChange={(e) => setEditExp(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Required Skills
                    </label>
                    <input
                      type="text"
                      value={editSkills}
                      onChange={(e) => setEditSkills(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Job Description
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none"
                    />
                  </div>
                </form>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Required Skills
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {previewJob.required_skills
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .map((skill) => (
                          <span
                            key={skill}
                            className="px-2.5 py-1 rounded-md bg-[#f0efff] text-[#544af4] text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                      Job Description
                    </p>
                    <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                      {previewJob.description}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCloneJob(previewJob)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Reuse in Form
                </button>
                {previewJob.status !== "approved" &&
                  previewJob.status !== "completed" &&
                  !editingPreview && (
                    <button
                      type="button"
                      onClick={() => setEditingPreview(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}
              </div>

              <div className="flex items-center gap-2.5">
                {editingPreview ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditingPreview(false)}
                      className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      form="edit-job-form"
                      disabled={savingEdit}
                      className="px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium hover:bg-[#4338ca] cursor-pointer disabled:opacity-50"
                    >
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setPreviewJob(null)}
                      className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                    {previewJob.status === "pending_approval" ? (
                      <Link
                        href={`/recruitment/${previewJob.id}/approval`}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium hover:bg-[#4338ca] transition-colors"
                      >
                        Review &amp; Approve
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    ) : (
                      (previewJob.status === "approved" ||
                        previewJob.status === "completed") && (
                        <Link
                          href={`/recruitment/${previewJob.id}/success`}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1f48d9] text-white text-xs font-medium hover:bg-[#1a3cb8] transition-colors"
                        >
                          View Results
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** HR Recruitment Dashboard page protected by HR role guard. */
export default function DashboardPage() {
  return (
    <AuthGuard requireRole="hr">
      <RecruitmentDashboardContent />
    </AuthGuard>
  );
}
