"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Sparkles,
  XCircle,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { CircularScore } from "@/components/CircularScore";
import { ApiError, apiFetch } from "@/lib/api";
import type {
  ApproveJobRequest,
  ApproveJobResponse,
  CandidateOut,
  JobDetailResponse,
  JobPostingOut,
} from "@/lib/types";

interface CandidateDraftState {
  approved: boolean;
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

function ApprovalContent() {
  const params = useParams<{ jobId: string }>();
  const jobId = params?.jobId;
  const router = useRouter();
  const { token } = useAuth();

  const [job, setJob] = useState<JobPostingOut | null>(null);
  const [candidates, setCandidates] = useState<CandidateOut[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CandidateDraftState>>({});

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadJobDetail = useCallback(async () => {
    if (!token || !jobId) return;
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

      const initialDrafts: Record<string, CandidateDraftState> = {};
      for (const candidate of data.candidates) {
        initialDrafts[candidate.id] = {
          approved: candidate.status !== "rejected",
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
    if (!jobId || !token) return;

    setSubmitError(null);
    setSubmitting(true);

    const payload: ApproveJobRequest = {
      decisions: candidates.map((c) => {
        const draft = drafts[c.id];
        return {
          candidate_id: c.id,
          approved: draft?.approved ?? true,
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
            <span className="px-2.5 py-0.5 text-xs font-medium rounded-full border bg-amber-50 text-amber-700 border-amber-200">
              {formatStatusLabel(job.status)}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {job.department} &middot; {job.experience_years}+ years &middot;{" "}
            {job.required_skills}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3 shadow-sm">
          <p className="text-slate-700 font-medium">
            No candidates were shortlisted for this job posting.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors"
          >
            Return to Dashboard
          </Link>
        </div>
      ) : (
        <form onSubmit={handleApproveSubmit} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {candidates.map((candidate) => {
              const draft = drafts[candidate.id] ?? {
                approved: true,
                interview_slot: candidate.interview_slot || "TBD",
                email_subject: candidate.email_subject || "",
                email_body: candidate.email_body || "",
              };
              const skills = parseSkills(candidate.matched_skills);

              return (
                <div
                  key={candidate.id}
                  className={`bg-white rounded-2xl border p-6 shadow-sm transition-all flex flex-col gap-5 ${
                    draft.approved
                      ? "border-slate-200 hover:border-accent/40 hover:shadow-md"
                      : "border-red-200/80 bg-slate-50/70 opacity-85"
                  }`}
                >
                  {/* Candidate Header + Circular Score */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <h3 className="text-lg font-semibold text-slate-800 truncate">
                        {candidate.name}
                      </h3>
                      <p className="text-sm text-slate-500 flex items-center gap-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">
                          {candidate.email || "No email extracted"}
                        </span>
                      </p>
                      {candidate.resume_source && (
                        <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">
                            {candidate.resume_source}
                          </span>
                        </p>
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
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        updateDraft(candidate.id, { approved: true })
                      }
                      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        draft.approved
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200"
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve
                    </button>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        updateDraft(candidate.id, { approved: false })
                      }
                      className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-medium border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        !draft.approved
                          ? "bg-red-600 text-white border-red-600 shadow-sm"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                      }`}
                    >
                      <XCircle className="w-4 h-4" />
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
                      disabled={submitting}
                      value={draft.interview_slot}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          interview_slot: e.target.value,
                        })
                      }
                      placeholder="e.g. Tomorrow, 2:00 PM UTC"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-60"
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
                      disabled={submitting}
                      value={draft.email_subject}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          email_subject: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-60"
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
                      disabled={submitting}
                      value={draft.email_body}
                      onChange={(e) =>
                        updateDraft(candidate.id, {
                          email_body: e.target.value,
                        })
                      }
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-y disabled:opacity-60"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Primary Submit Bar */}
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
        </form>
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
