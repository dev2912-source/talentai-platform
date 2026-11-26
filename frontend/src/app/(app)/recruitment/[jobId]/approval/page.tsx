"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Download,
  FilePlus2,
  FileText,
  Loader2,
  Mail,
  MailCheck,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { CircularScore } from "@/components/CircularScore";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiDownloadBlob, apiFetch, triggerBlobDownload } from "@/lib/api";
import type {
  ApproveJobRequest,
  ApproveJobResponse,
  CandidateOut,
  JobDetailResponse,
  JobPostingOut,
  ScreenJobResponse,
} from "@/lib/types";

interface CandidateDraftState {
  approved: boolean;
  email: string;
  interview_slot: string;
  email_subject: string;
  email_body: string;
}

function parseSkills(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function getJobStatusBadgeClasses(status: string): string {
  if (status === "approved" || status === "completed") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (status === "pending_approval") {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  if (status === "screening") {
    return "bg-indigo-50 text-indigo-700 border-indigo-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}

function ApprovalContent() {
  const params = useParams<{ jobId: string }>();
  const jobId = params?.jobId;
  const router = useRouter();
  const { token } = useAuth();

  const [job, setJob] = useState<JobPostingOut | null>(null);
  const [candidates, setCandidates] = useState<CandidateOut[]>([]);
  const [emailMode, setEmailMode] = useState<string>("console");
  const [drafts, setDrafts] = useState<Record<string, CandidateDraftState>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingCandId, setDeletingCandId] = useState<string | null>(null);
  const [confirmDeleteCandId, setConfirmDeleteCandId] = useState<string | null>(null);

  const [filterMode, setFilterMode] = useState<"all" | "approved" | "rejected">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"score_desc" | "score_asc" | "name_asc">("score_desc");

  const [showAddResumes, setShowAddResumes] = useState(false);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [rescreening, setRescreening] = useState(false);

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualScore, setManualScore] = useState("80");
  const [manualSkills, setManualSkills] = useState("");
  const [manualSlot, setManualSlot] = useState("Tomorrow, 10:00 AM UTC");
  const [savingManual, setSavingManual] = useState(false);

  const loadJobDetail = useCallback(async () => {
    if (!token || !jobId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<JobDetailResponse>(
        `/api/recruitment/jobs/${jobId}`,
        {},
        token,
      );
      setJob(data.job);
      setCandidates(data.candidates);
      if (data.email_mode) setEmailMode(data.email_mode);

      const initialDrafts: Record<string, CandidateDraftState> = {};
      for (const candidate of data.candidates) {
        initialDrafts[candidate.id] = {
          approved: candidate.email_sent || candidate.status !== "rejected",
          email: candidate.email || "",
          interview_slot: candidate.interview_slot || "TBD",
          email_subject:
            candidate.email_subject ||
            `Interview Invitation — ${data.job.title}`,
          email_body: candidate.email_body || "",
        };
      }
      setDrafts(initialDrafts);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load recruitment screening results.",
      );
    } finally {
      setLoading(false);
    }
  }, [jobId, token]);

  useEffect(() => {
    loadJobDetail();
  }, [loadJobDetail]);

  function updateDraft(
    candidateId: string,
    patch: Partial<CandidateDraftState>,
  ) {
    setDrafts((prev) => {
      const current = prev[candidateId];
      if (!current) return prev;
      return {
        ...prev,
        [candidateId]: { ...current, ...patch },
      };
    });
  }

  async function handleApproveSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const jobLocked =
      job?.status === "approved" || job?.status === "completed";
    if (!jobId || !token || jobLocked) return;

    setSubmitError(null);
    setSubmitting(true);

    const payload: ApproveJobRequest = {
      decisions: candidates.map((c) => {
        const draft = drafts[c.id];
        return {
          candidate_id: c.id,
          approved: draft?.approved ?? true,
          email: draft?.email ?? c.email ?? "",
          email_subject: draft?.email_subject ?? c.email_subject,
          email_body: draft?.email_body ?? c.email_body,
          interview_slot: draft?.interview_slot ?? c.interview_slot,
        };
      }),
    };

    try {
      await apiFetch<ApproveJobResponse>(
        `/api/recruitment/jobs/${jobId}/approve`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token,
      );
      router.push(`/recruitment/${jobId}/success`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "Failed to approve and send invitations. Please try again.",
      );
      setSubmitting(false);
    }
  }

  async function handleDownloadResume(candidate: CandidateOut) {
    if (!token || downloadingId) return;
    setDownloadingId(candidate.id);
    setSubmitError(null);
    try {
      const blob = await apiDownloadBlob(
        `/api/recruitment/candidates/${candidate.id}/resume`,
        token,
      );
      triggerBlobDownload(blob, candidate.resume_source || "resume.pdf");
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "Unable to download candidate resume.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  function applyBulkDecision(mode: "all" | "none" | "high_score") {
    if (isJobApproved || submitting) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const candidate of candidates) {
        if (candidate.email_sent) continue;
        const current = next[candidate.id];
        if (!current) continue;
        const approved =
          mode === "all"
            ? true
            : mode === "none"
              ? false
              : candidate.match_score >= 75;
        next[candidate.id] = { ...current, approved };
      }
      return next;
    });
  }

  async function handleAddResumes() {
    if (!jobId || !token || extraFiles.length === 0 || rescreening) return;
    setRescreening(true);
    setSubmitError(null);
    const formData = new FormData();
    formData.append("min_score", "40");
    for (const file of extraFiles) {
      formData.append("resumes", file);
    }
    try {
      await apiFetch<ScreenJobResponse>(
        `/api/recruitment/jobs/${jobId}/rescreen`,
        {
          method: "POST",
          body: formData,
        },
        token,
      );
      setExtraFiles([]);
      setShowAddResumes(false);
      await loadJobDetail();
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "Failed to screen additional resumes.",
      );
    } finally {
      setRescreening(false);
    }
  }

  async function handleDeleteCandidate(candidateId: string) {
    if (!token || deletingCandId) return;
    setDeletingCandId(candidateId);
    setSubmitError(null);
    try {
      await apiFetch<{ status: string; id: string }>(
        `/api/recruitment/candidates/${candidateId}`,
        { method: "DELETE" },
        token,
      );
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      setConfirmDeleteCandId(null);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "Unable to remove candidate.",
      );
    } finally {
      setDeletingCandId(null);
    }
  }

  async function handleManualCandidateSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!jobId || !token || !manualName.trim() || savingManual) return;
    setSavingManual(true);
    setSubmitError(null);
    try {
      const created = await apiFetch<CandidateOut>(
        `/api/recruitment/jobs/${jobId}/candidates`,
        {
          method: "POST",
          body: JSON.stringify({
            name: manualName.trim(),
            email: manualEmail.trim() || null,
            match_score: Math.max(0, Math.min(100, Number(manualScore) || 75)),
            matched_skills: manualSkills.trim(),
            interview_slot: manualSlot.trim() || "TBD",
          }),
        },
        token,
      );
      setCandidates((prev) => [created, ...prev]);
      setDrafts((prev) => ({
        ...prev,
        [created.id]: {
          approved: true,
          email: created.email || "",
          interview_slot: created.interview_slot || "TBD",
          email_subject: created.email_subject,
          email_body: created.email_body,
        },
      }));
      setManualName("");
      setManualEmail("");
      setManualScore("80");
      setManualSkills("");
      setShowManualModal(false);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err.detail
          : "Unable to add candidate.",
      );
    } finally {
      setSavingManual(false);
    }
  }

  const visibleCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = candidates.filter((c) => {
      const isApproved = drafts[c.id]?.approved ?? true;
      if (filterMode === "approved" && !isApproved) return false;
      if (filterMode === "rejected" && isApproved) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        c.matched_skills.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "score_asc") return a.match_score - b.match_score;
      if (sortBy === "name_asc") return a.name.localeCompare(b.name);
      return b.match_score - a.match_score;
    });
  }, [candidates, drafts, filterMode, searchQuery, sortBy]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium">
            Loading AI screening results...
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !job) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-800">
          Unable to load job approval screen
        </h2>
        <p className="text-sm text-slate-500">
          {loadError || "The requested job posting could not be found."}
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={loadJobDetail}
            className="px-4 py-2 rounded-lg bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors cursor-pointer"
          >
            Retry
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const isJobApproved =
    job.status === "approved" || job.status === "completed";
  const approvedCount = candidates.filter(
    (c) => drafts[c.id]?.approved ?? true,
  ).length;
  const rejectedCount = candidates.length - approvedCount;

  return (
    <div className="p-2 md:p-4 max-w-7xl mx-auto space-y-6">
      {/* Top Breadcrumb */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-semibold text-slate-800">
              {job.title}
            </h2>
            <span
              className={`px-2.5 py-0.5 text-xs font-medium rounded-full border ${getJobStatusBadgeClasses(
                job.status,
              )}`}
            >
              {formatStatusLabel(job.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {job.department} &middot; {job.experience_years}+ years &middot;{" "}
            {job.required_skills}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium ${
              emailMode === "smtp"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-600 border-slate-200"
            }`}
          >
            {emailMode === "smtp" ? "SMTP Live" : "Demo Console Mode"}
          </span>
          <div className="px-4 py-2 bg-[#f0efff] text-[#544af4] rounded-xl border border-indigo-200/70 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">
              {candidates.length}{" "}
              {candidates.length === 1 ? "Candidate" : "Candidates"} Shortlisted
            </span>
          </div>
          {candidates.length > 0 && (
            <div className="text-xs font-medium text-slate-500">
              <span className="text-emerald-600">{approvedCount} Approved</span>
              {" · "}
              <span className="text-red-500">{rejectedCount} Rejected</span>
            </div>
          )}
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

      {candidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4 shadow-sm">
          <p className="text-slate-700 font-medium">
            No candidates were shortlisted for this job posting.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {!isJobApproved && (
              <button
                type="button"
                onClick={() => setShowAddResumes((v) => !v)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#544af4] text-white text-sm font-medium hover:bg-[#4338ca] transition-colors cursor-pointer"
              >
                <FilePlus2 className="w-4 h-4" />
                Screen More Resumes
              </button>
            )}
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors"
            >
              Return to Dashboard
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleApproveSubmit} className="space-y-6">
          {/* Bulk Actions, Filter & Sort Toolbar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {!isJobApproved && (
                <>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => applyBulkDecision("all")}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Approve All
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => applyBulkDecision("high_score")}
                    className="px-3 py-1.5 rounded-lg bg-[#f0efff] text-[#544af4] border border-indigo-200 hover:bg-indigo-100 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Approve &ge; 75%
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => applyBulkDecision("none")}
                    className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-xs font-medium transition-colors cursor-pointer"
                  >
                    Reject All
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddResumes((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    <span>Add Resumes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Add Manual</span>
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter candidates..."
                  className="w-full sm:w-44 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
                />
              </div>

              <div className="flex items-center gap-1">
                {(["all", "approved", "rejected"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setFilterMode(mode)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                      filterMode === mode
                        ? "bg-[#544af4] text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "score_desc" | "score_asc" | "name_asc")
                }
                aria-label="Sort candidates"
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="score_desc">Score: High → Low</option>
                <option value="score_asc">Score: Low → High</option>
                <option value="name_asc">Name: A → Z</option>
              </select>
            </div>
          </div>

          {showAddResumes && !isJobApproved && (
            <div className="bg-white rounded-2xl border border-indigo-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">
                  Screen Additional Resumes for {job.title}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddResumes(false)}
                  className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  Close
                </button>
              </div>
              <FileDropzone
                files={extraFiles}
                onFilesChange={setExtraFiles}
                accept=".pdf,.docx,.txt"
                multiple
                disabled={rescreening}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={rescreening || extraFiles.length === 0}
                  onClick={() => void handleAddResumes()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#544af4] hover:bg-[#4338ca] text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  {rescreening ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Screening...</span>
                    </>
                  ) : (
                    <span>Screen &amp; Add Candidates</span>
                  )}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {visibleCandidates.map((candidate) => {
              const draft = drafts[candidate.id] ?? {
                approved: true,
                email: candidate.email || "",
                interview_slot: candidate.interview_slot || "TBD",
                email_subject: candidate.email_subject || "",
                email_body: candidate.email_body || "",
              };
              const skills = parseSkills(candidate.matched_skills);
              const isCandidateSent = Boolean(candidate.email_sent);
              const isCandidateLocked = isJobApproved || isCandidateSent;

              return (
                <div
                  key={candidate.id}
                  className={`bg-white rounded-2xl border p-4 sm:p-6 shadow-sm transition-all flex flex-col gap-5 ${
                    draft.approved
                      ? "border-slate-200 hover:border-accent/40 hover:shadow-md"
                      : "border-red-200/80 bg-slate-50/70 opacity-85"
                  }`}
                >
                  {/* Candidate Header + Circular Score */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-800 truncate">
                          {candidate.name}
                        </h3>
                        {isCandidateSent && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <MailCheck className="w-3.5 h-3.5" />
                            Invitation Already Sent
                          </span>
                        )}
                        {!isCandidateSent && !draft.email.trim() && draft.approved && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Missing Email
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <input
                          type="email"
                          disabled={submitting || isCandidateLocked}
                          readOnly={isCandidateLocked}
                          value={draft.email}
                          onChange={(e) =>
                            updateDraft(candidate.id, { email: e.target.value })
                          }
                          placeholder="Enter candidate email..."
                          aria-label={`Email for ${candidate.name}`}
                          className="w-full max-w-xs px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white disabled:opacity-60"
                        />
                        {!isCandidateLocked && (
                          confirmDeleteCandId === candidate.id ? (
                            <div className="inline-flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                disabled={deletingCandId === candidate.id}
                                onClick={() => void handleDeleteCandidate(candidate.id)}
                                className="px-2 py-0.5 rounded bg-red-600 text-white text-[11px] font-medium cursor-pointer"
                              >
                                {deletingCandId === candidate.id ? "..." : "Remove"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCandId(null)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteCandId(candidate.id)}
                              title="Remove candidate"
                              aria-label={`Remove ${candidate.name}`}
                              className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
                      {candidate.resume_source && (
                        <div className="flex items-center gap-2 pt-0.5">
                          <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              {candidate.resume_source}
                            </span>
                          </p>
                          {candidate.resume_storage_path && (
                            <button
                              type="button"
                              disabled={downloadingId === candidate.id}
                              onClick={() => void handleDownloadResume(candidate)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                            >
                              {downloadingId === candidate.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                              <span>Resume</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <CircularScore score={candidate.match_score} />
                  </div>

                  {/* Matched Skills Pills */}
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-2">
                      Matched Skills
                    </p>
                    {skills.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {skills.map((skill) => (
                          <span
                            key={skill}
                            className="px-2.5 py-1 bg-accent/10 text-accent text-xs font-medium rounded-md border border-accent/20"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        No specific skills listed
                      </span>
                    )}
                  </div>

                  {/* Approve / Reject Toggle */}
                  <div className="flex items-center gap-2.5 sm:gap-3 pt-1">
                    <button
                      type="button"
                      disabled={submitting || isCandidateLocked}
                      onClick={() =>
                        updateDraft(candidate.id, { approved: true })
                      }
                      className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                        draft.approved
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      Approve
                    </button>

                    <button
                      type="button"
                      disabled={submitting || isCandidateLocked}
                      onClick={() =>
                        updateDraft(candidate.id, { approved: false })
                      }
                      className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                        !draft.approved
                          ? "bg-red-600 text-white border-red-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                      }`}
                    >
                      <XCircle className="w-4 h-4 shrink-0" />
                      Reject
                    </button>
                  </div>

                  {/* Interview Slot */}
                  <div>
                    <label
                      htmlFor={`slot-${candidate.id}`}
                      className="block mb-1.5 text-xs font-medium text-slate-500 flex items-center gap-1.5"
                    >
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      Interview Slot
                    </label>
                    <input
                      id={`slot-${candidate.id}`}
                      type="text"
                      disabled={submitting || isCandidateLocked}
                      readOnly={isCandidateLocked}
                      value={draft.interview_slot}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          interview_slot: e.target.value,
                        })
                      }
                      placeholder="e.g. Tomorrow, 2:00 PM UTC"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-60 disabled:bg-slate-50"
                    />
                  </div>

                  {/* Email Subject */}
                  <div>
                    <label
                      htmlFor={`subject-${candidate.id}`}
                      className="block mb-1.5 text-xs font-medium text-slate-500"
                    >
                      Email Subject
                    </label>
                    <input
                      id={`subject-${candidate.id}`}
                      type="text"
                      disabled={submitting || isCandidateLocked}
                      readOnly={isCandidateLocked}
                      value={draft.email_subject}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          email_subject: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-60 disabled:bg-slate-50"
                    />
                  </div>

                  {/* Email Body */}
                  <div className="flex-1 flex flex-col">
                    <label
                      htmlFor={`body-${candidate.id}`}
                      className="block mb-1.5 text-xs font-medium text-slate-500"
                    >
                      Email Body
                    </label>
                    <textarea
                      id={`body-${candidate.id}`}
                      rows={8}
                      disabled={submitting || isCandidateLocked}
                      readOnly={isCandidateLocked}
                      value={draft.email_body}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          email_body: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-y disabled:opacity-60 disabled:bg-slate-50"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Primary Submit Bar */}
          {isJobApproved ? (
            <div className="bg-emerald-50/70 rounded-2xl border border-emerald-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="text-sm text-emerald-800 flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>
                  This job posting is already finalized. Sent invitations and
                  decisions are read-only.
                </span>
              </div>
              <Link
                href={`/recruitment/${jobId}/success`}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors text-sm shadow-sm inline-flex items-center justify-center gap-2 shrink-0"
              >
                <MailCheck className="w-4 h-4" />
                <span>View Results</span>
              </Link>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="text-sm text-slate-600">
                Ready to dispatch invitations to{" "}
                <span className="font-semibold text-slate-900">
                  {approvedCount}
                </span>{" "}
                approved {approvedCount === 1 ? "candidate" : "candidates"}
                {rejectedCount > 0 && (
                  <span>
                    {" "}
                    ({rejectedCount} marked as rejected)
                  </span>
                )}
                .
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="px-7 py-3.5 bg-[#1f48d9] hover:bg-[#1a3cb8] text-white font-medium rounded-xl transition-colors text-sm shadow-sm inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending Invitations...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve &amp; Send Invitations</span>
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      )}

      {/* Manual Candidate Modal */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowManualModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">
                Add Candidate Manually
              </h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleManualCandidateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="priya@example.com"
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Match Score (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={manualScore}
                    onChange={(e) => setManualScore(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Matched Skills
                </label>
                <input
                  type="text"
                  value={manualSkills}
                  onChange={(e) => setManualSkills(e.target.value)}
                  placeholder="Python, FastAPI, PostgreSQL"
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Interview Slot
                </label>
                <input
                  type="text"
                  value={manualSlot}
                  onChange={(e) => setManualSlot(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingManual}
                  className="px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingManual ? "Adding..." : "Add Candidate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** HR Human-in-the-Loop candidate review and email approval page. */
export default function RecruitmentApprovalPage() {
  return (
    <AuthGuard requireRole="hr">
      <ApprovalContent />
    </AuthGuard>
  );
}
