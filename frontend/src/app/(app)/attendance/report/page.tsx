"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Clock,
  Download,
  Inbox,
  Loader2,
  Upload,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiDownloadBlob, apiFetch } from "@/lib/api";
import type {
  AttendanceReportBatchResponse,
  AttendanceReportOut,
} from "@/lib/types";

function getScoreBadgeClass(score: number | null): string {
  if (score === null) return "bg-slate-100 text-slate-600 border-slate-200";
  if (score >= 80) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 50) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function AttendanceReportInner() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id");
  const { token } = useAuth();

  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(
    batchIdParam,
  );
  const [reports, setReports] = useState<AttendanceReportOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const query = batchIdParam
        ? `?batch_id=${encodeURIComponent(batchIdParam)}`
        : "";
      const data = await apiFetch<AttendanceReportBatchResponse>(
        `/api/attendance/reports${query}`,
        {},
        token,
      );
      setResolvedBatchId(data.batch_id);
      setReports(data.reports);
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

  return (
    <div className="p-2 md:p-4 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-800">
            AI Attendance Report
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            Agent evaluation of employee work hours and reliability.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/attendance"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors text-sm font-medium"
          >
            <Upload className="w-4 h-4" />
            Upload Another
          </Link>
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
                  <th className="px-6 py-4 font-semibold">Employee Name</th>
                  <th className="px-6 py-4 font-semibold">Total Hours</th>
                  <th className="px-6 py-4 font-semibold">Leaves Taken</th>
                  <th className="px-6 py-4 font-semibold">AI Score</th>
                  <th className="px-6 py-4 font-semibold">Agent Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                        <Inbox className="w-6 h-6 text-slate-400" />
                      </div>
                      <h3 className="text-base font-medium text-slate-800 mb-1">
                        No data to report
                      </h3>
                      <p className="text-sm text-slate-500">
                        Ensure the uploaded Excel file contains valid
                        login/logout data.
                      </p>
                    </td>
                  </tr>
                ) : (
                  reports.map((report) => (
                    <tr
                      key={report.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-6 py-4 font-medium text-slate-800">
                        {report.employee_name}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="font-medium">
                            {report.total_hours}
                          </span>
                          <span className="text-slate-500">hrs</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
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
                      <td className="px-6 py-4">
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
                      <td className="px-6 py-4 max-w-md">
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
