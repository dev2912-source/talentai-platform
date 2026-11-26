"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Award,
  CalendarOff,
  Clock,
  Download,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiDownloadBlob, apiFetch, triggerBlobDownload } from "@/lib/api";
import type {
  AttendanceBatchSummaryOut,
  AttendanceReportBatchResponse,
  AttendanceReportOut,
} from "@/lib/types";

function getScoreBadgeClass(score: number | null): string {
  if (score === null) return "bg-slate-100 text-slate-600 border-slate-200";
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 50) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function formatBatchLabel(batch: AttendanceBatchSummaryOut, idx: number): string {
  const datePart = batch.created_at
    ? new Date(batch.created_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : `Batch ${idx + 1}`;
  return `${datePart} (${batch.employee_count} ${batch.employee_count === 1 ? "emp" : "emps"})`;
}

function AttendanceReportInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id");
  const { token } = useAuth();

  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(
    batchIdParam,
  );
  const [batches, setBatches] = useState<AttendanceBatchSummaryOut[]>([]);
  const [reports, setReports] = useState<AttendanceReportOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"score_desc" | "hours_desc" | "leaves_desc" | "name_asc">("score_desc");

  const loadReports = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = batchIdParam
        ? `?batch_id=${encodeURIComponent(batchIdParam)}`
        : "";
      const [data, batchList] = await Promise.all([
        apiFetch<AttendanceReportBatchResponse>(
          `/api/attendance/reports${query}`,
          {},
          token,
        ),
        apiFetch<AttendanceBatchSummaryOut[]>(
          "/api/attendance/batches",
          {},
          token,
        ).catch(() => [] as AttendanceBatchSummaryOut[]),
      ]);
      setResolvedBatchId(data.batch_id);
      setReports(data.reports);
      setBatches(batchList);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load AI attendance reports.",
      );
    } finally {
      setLoading(false);
    }
  }, [batchIdParam, token]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  async function handleDownloadPdf() {
    if (!token || downloadingPdf) return;
    setDownloadError(null);
    setDownloadingPdf(true);
    try {
      const targetBatch = resolvedBatchId ?? batchIdParam;
      const query = targetBatch
        ? `?batch_id=${encodeURIComponent(targetBatch)}`
        : "";
      const blob = await apiDownloadBlob(
        `/api/attendance/reports/pdf${query}`,
        token,
      );
      triggerBlobDownload(blob, "attendance_report.pdf");
    } catch (err) {
      setDownloadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to download attendance report PDF.",
      );
    } finally {
      setDownloadingPdf(false);
    }
  }

  async function handleDownloadExcel() {
    if (!token || downloadingExcel) return;
    setDownloadError(null);
    setDownloadingExcel(true);
    try {
      const targetBatch = resolvedBatchId ?? batchIdParam;
      const query = targetBatch
        ? `?batch_id=${encodeURIComponent(targetBatch)}`
        : "";
      const blob = await apiDownloadBlob(
        `/api/attendance/reports/excel${query}`,
        token,
      );
      triggerBlobDownload(blob, "attendance_report.xlsx");
    } catch (err) {
      setDownloadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to download attendance report Excel.",
      );
    } finally {
      setDownloadingExcel(false);
    }
  }

  const kpis = useMemo(() => {
    const scored = reports.filter((r) => r.ai_score !== null);
    const avgScore = scored.length
      ? Math.round(
          scored.reduce((sum, r) => sum + (r.ai_score ?? 0), 0) / scored.length,
        )
      : null;
    const totalHours = Math.round(
      reports.reduce((sum, r) => sum + (r.total_hours || 0), 0) * 10,
    ) / 10;
    const totalLeaves = reports.reduce((sum, r) => sum + (r.leaves_taken || 0), 0);
    return {
      count: reports.length,
      avgScore,
      totalHours,
      totalLeaves,
    };
  }, [reports]);

  const visibleReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? reports.filter((r) => r.employee_name.toLowerCase().includes(q))
      : reports;
    return [...filtered].sort((a, b) => {
      if (sortBy === "hours_desc") return b.total_hours - a.total_hours;
      if (sortBy === "leaves_desc") return b.leaves_taken - a.leaves_taken;
      if (sortBy === "name_asc") return a.employee_name.localeCompare(b.employee_name);
      return (b.ai_score ?? -1) - (a.ai_score ?? -1);
    });
  }, [reports, searchQuery, sortBy]);

  return (
    <div className="p-2 md:p-4 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800">
            AI Attendance Report
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Agent evaluation of employee work hours and reliability.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {batches.length > 0 && (
            <select
              value={resolvedBatchId ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                router.push(
                  next
                    ? `/attendance/report?batch_id=${encodeURIComponent(next)}`
                    : "/attendance/report",
                );
              }}
              aria-label="Select report batch"
              className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {batches.map((batch, idx) => (
                <option key={batch.batch_id} value={batch.batch_id}>
                  {formatBatchLabel(batch, idx)}
                </option>
              ))}
            </select>
          )}

          <Link
            href="/attendance"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors text-sm font-medium"
          >
            <Upload className="w-4 h-4" />
            Upload Another
          </Link>

          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={downloadingExcel || loading || reports.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-50 text-teal-700 border border-teal-200 rounded-xl hover:bg-teal-100 transition-colors text-sm font-medium cursor-pointer disabled:opacity-60"
          >
            {downloadingExcel ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
            <span>{downloadingExcel ? "Exporting..." : "Download Excel"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors text-sm font-medium cursor-pointer disabled:opacity-60"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{downloadingPdf ? "Generating PDF..." : "Download PDF"}</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {!loading && !error && reports.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1f48d9] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Employees</p>
              <p className="text-xl font-bold text-slate-800">{kpis.count}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Avg AI Score</p>
              <p className="text-xl font-bold text-slate-800">
                {kpis.avgScore !== null ? `${kpis.avgScore}/100` : "N/A"}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Total Hours</p>
              <p className="text-xl font-bold text-slate-800">
                {kpis.totalHours}h
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <CalendarOff className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Total Leaves</p>
              <p className="text-xl font-bold text-slate-800">
                {kpis.totalLeaves}d
              </p>
            </div>
          </div>
        </div>
      )}

      {downloadError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{downloadError}</span>
        </div>
      )}

      {/* Report Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {!loading && !error && reports.length > 0 && (
          <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employee name..."
                className="w-full sm:w-60 pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as
                    | "score_desc"
                    | "hours_desc"
                    | "leaves_desc"
                    | "name_asc",
                )
              }
              aria-label="Sort attendance report"
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="score_desc">AI Score: High → Low</option>
              <option value="hours_desc">Total Hours: High → Low</option>
              <option value="leaves_desc">Leaves: High → Low</option>
              <option value="name_asc">Name: A → Z</option>
            </select>
          </div>
        )}

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
            <p className="text-sm font-medium">Loading AI attendance report...</p>
          </div>
        ) : error ? (
          <div className="p-10 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={loadReports}
              className="px-4 py-2 rounded-lg bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 sm:px-6 py-4 font-semibold">Employee Name</th>
                  <th className="px-4 sm:px-6 py-4 font-semibold">Total Hours</th>
                  <th className="px-4 sm:px-6 py-4 font-semibold">Leaves Taken</th>
                  <th className="px-4 sm:px-6 py-4 font-semibold">AI Score</th>
                  <th className="px-4 sm:px-6 py-4 font-semibold">Agent Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleReports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                        <Inbox className="w-6 h-6 text-slate-400" />
                      </div>
                      <h3 className="text-base font-medium text-slate-800 mb-1">
                        No data to report
                      </h3>
                      <p className="text-sm text-slate-500">
                        {reports.length === 0
                          ? "Ensure the uploaded Excel file contains valid login/logout data."
                          : "No employees match your current search."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  visibleReports.map((report) => (
                    <tr
                      key={report.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-4 sm:px-6 py-4 font-medium text-slate-800 whitespace-nowrap">
                        {report.employee_name}
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="font-medium">
                            {report.total_hours}
                          </span>
                          <span className="text-slate-500">hrs</span>
                        </div>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            report.leaves_taken > 0
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {report.leaves_taken} days
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getScoreBadgeClass(
                            report.ai_score,
                          )}`}
                        >
                          {report.ai_score !== null
                            ? `${report.ai_score}/100`
                            : "N/A"}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 max-w-md">
                        <p
                          className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap"
                          title={report.ai_feedback}
                        >
                          {report.ai_feedback}
                        </p>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/** HR AI Attendance Report page wrapped in Suspense for searchParams. */
export default function AttendanceReportPage() {
  return (
    <AuthGuard requireRole="hr">
      <Suspense
        fallback={
          <div className="min-h-[60vh] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        }
      >
        <AttendanceReportInner />
      </Suspense>
    </AuthGuard>
  );
}
