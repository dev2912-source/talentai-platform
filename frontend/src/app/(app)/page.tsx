"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  ChevronDown,
  Loader2,
  Sparkles,
  Users,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiFetch } from "@/lib/api";
import type { JobPostingSummaryOut, ScreenJobResponse } from "@/lib/types";

const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "HR",
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

function RecruitmentDashboardContent() {
  const router = useRouter();
  const { token } = useAuth();

  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<string>("Engineering");
  const [requiredSkills, setRequiredSkills] = useState("");
  const [experienceYears, setExperienceYears] = useState("0");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<JobPostingSummaryOut[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    if (!token) return;
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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

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
    for (const file of files) {
      formData.append("resumes", file);
    }

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

  return (
    <div className="p-2 md:p-4 max-w-[1200px] mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-[28px] font-semibold text-slate-800 tracking-tight">
          Create Job Posting
        </h2>
        <p className="text-slate-500 mt-1">
          Post new positions and start recruiting top talent
        </p>
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
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Left Card: Job Details */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col h-full">
            <h3 className="mb-6 flex items-center gap-2 font-semibold text-lg text-slate-800">
              Job Details
              <Sparkles className="w-4 h-4 text-accent" />
            </h3>

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
                    Minimum Experience (Years)
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
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col h-full">
            <div className="flex items-center gap-3 mb-6">
              <h3 className="font-semibold text-lg text-slate-800">
                Candidate Ingestion
              </h3>
              <span className="px-3 py-1 text-[11px] bg-[#f0efff] text-[#544af4] font-medium rounded-full">
                AI-Powered
              </span>
            </div>

            <FileDropzone
              files={files}
              onFilesChange={setFiles}
              accept=".pdf,.docx,.doc,.txt"
              multiple
              disabled={submitting}
              className="flex-1"
            />
          </div>
        </div>
      </form>

      {/* Recent Job Postings */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Briefcase className="w-5 h-5 text-accent" />
            <h3 className="font-semibold text-lg text-slate-800">
              Recent Job Postings
            </h3>
          </div>
          <span className="text-xs font-medium text-slate-500">
            {jobs.length} {jobs.length === 1 ? "posting" : "postings"}
          </span>
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
        ) : jobs.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No job postings yet. Create your first job posting above to screen
            candidates.
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                {jobs.map((job) => {
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
                        <div className="font-medium text-slate-800">
                          {job.title}
                        </div>
                        <div className="text-xs text-slate-400 truncate max-w-xs">
                          {job.required_skills}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {job.department}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 font-medium">
                          <Users className="w-4 h-4 text-slate-400" />
                          {job.candidate_count}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {formatDate(job.created_at)}
                      </td>
                      <td className="px-6 py-4 text-right">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
