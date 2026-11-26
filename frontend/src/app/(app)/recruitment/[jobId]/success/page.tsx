"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  Home,
  Loader2,
  MailCheck,
  Send,
  XCircle,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiFetch } from "@/lib/api";
import type {
  CandidateOut,
  JobDetailResponse,
  JobPostingOut,
} from "@/lib/types";

function formatCreatedDate(iso: string | null): string {
  if (!iso) return "Recently";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Recently";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getScoreBadgeClasses(score: number): string {
  if (score >= 75) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (score >= 50) {
    return "bg-amber-50 text-amber-700 border-amber-200";
  }
  return "bg-red-50 text-red-700 border-red-200";
}

function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return "CA";
  return clean.slice(0, 2).toUpperCase();
}

function SuccessContent() {
  const params = useParams<{ jobId: string }>();
  const jobId = params?.jobId;
  const { token } = useAuth();

  const [job, setJob] = useState<JobPostingOut | null>(null);
  const [candidates, setCandidates] = useState<CandidateOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobDetail = useCallback(async () => {
    if (!token || !jobId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<JobDetailResponse>(
        `/api/recruitment/jobs/${jobId}`,
        {},
        token,
      );
      setJob(data.job);
      setCandidates(data.candidates);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load recruitment summary.",
      );
    } finally {
      setLoading(false);
    }
  }, [jobId, token]);

  useEffect(() => {
    loadJobDetail();
  }, [loadJobDetail]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading recruitment summary...</p>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-800">
          Unable to load summary
        </h2>
        <p className="text-sm text-slate-500">
          {error || "The requested job posting could not be found."}
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

  const sentCount = candidates.filter((c) => c.email_sent).length;
  const isComplete = job.status === "approved" || job.status === "completed";
  const statusDisplay = isComplete
    ? "Complete"
    : job.status
        .replace(/_/g, " ")
        .replace(/\b\w/g, (ch) => ch.toUpperCase());

  return (
    <div className="p-2 md:p-6 max-w-5xl mx-auto space-y-8">
      {/* Success Header */}
      <div className="text-center max-w-2xl mx-auto">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-500/10 border-2 border-green-500/20 flex items-center justify-center shadow-xl shadow-green-500/20">
          <Check className="w-10 h-10 text-green-500" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">
          Emails Sent Successfully!
        </h1>
        <p className="text-slate-500">
          All interview invitation emails have been dispatched. Here&apos;s a
          summary of your recruitment pipeline.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center shadow-sm">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Emails Sent
          </div>
          <div className="text-5xl font-bold text-green-500">{sentCount}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center shadow-sm flex flex-col justify-center items-center">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Pipeline Status
          </div>
          <div className="px-4 py-2 bg-green-500/10 text-green-600 border border-green-500/20 rounded-full inline-flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-5 h-5" />
            <span>{statusDisplay}</span>
          </div>
        </div>
      </div>

      {/* Job Info Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 to-transparent pointer-events-none" />
        <div className="flex items-center gap-4 relative z-10">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 text-green-600 flex items-center justify-center border border-green-500/20 shrink-0">
            <Briefcase className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">{job.title}</h2>
            <p className="text-sm text-slate-500 mt-1">
              {job.required_skills} &middot; {job.experience_years}+ years
              &middot; Created {formatCreatedDate(job.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Sent Invitations Table */}
      {candidates.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Send className="w-5 h-5 text-accent" />
              Sent Invitations
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 font-semibold">Candidate</th>
                  <th className="px-6 py-4 font-semibold">Email</th>
                  <th className="px-6 py-4 font-semibold">Match Score</th>
                  <th className="px-6 py-4 font-semibold">Interview Slot</th>
                  <th className="px-6 py-4 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {candidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1f48d9] to-[#544af4] flex items-center justify-center text-xs font-medium text-white shrink-0">
                          {getInitials(candidate.name)}
                        </div>
                        <span className="font-medium text-slate-800">
                          {candidate.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {candidate.email || "N/A"}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getScoreBadgeClasses(candidate.match_score)}`}
                      >
                        {Math.round(candidate.match_score)}%
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="w-4 h-4 shrink-0" />
                        <span>{candidate.interview_slot || "TBD"}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {candidate.email_sent ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                          <MailCheck className="w-4 h-4" />
                          Sent
                        </span>
                      ) : candidate.status === "rejected" ? (
                        <span className="inline-flex items-center gap-1.5 text-red-500 font-medium">
                          <XCircle className="w-4 h-4" />
                          Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-slate-500 font-medium">
                          Shortlisted
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Back to Dashboard */}
      <div className="text-center pt-2">
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 px-8 py-3 bg-[#1f48d9] hover:bg-[#1a3cb8] text-white font-medium rounded-xl transition-colors shadow-lg shadow-[#1f48d9]/20"
        >
          <Home className="w-5 h-5" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

/** Recruitment pipeline completion and sent invitations summary page. */
export default function RecruitmentSuccessPage() {
  return (
    <AuthGuard requireRole="hr">
      <SuccessContent />
    </AuthGuard>
  );
}
