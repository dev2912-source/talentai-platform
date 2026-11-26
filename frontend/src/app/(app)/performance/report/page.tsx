"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Calendar,
  Download,
  Inbox,
  Loader2,
  Target,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiDownloadBlob, apiFetch } from "@/lib/api";
import type {
  PerformanceBatchResponse,
  PerformanceRecordOut,
} from "@/lib/types";

function getScoreTextColor(score: number | null): string {
  if (score === null) return "text-slate-600";
  if (score >= 85) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
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

function PerformanceReportInner() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id");
  const { token } = useAuth();

  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(
    batchIdParam,
  );
  const [records, setRecords] = useState<PerformanceRecordOut[]>([]);
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
      const data = await apiFetch<PerformanceBatchResponse>(
        `/api/performance/reports${query}`,
        {},
        token,
      );
      setResolvedBatchId(data.batch_id);
      setRecords(data.records);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load AI performance reports.",
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
        `/api/performance/reports/pdf${query}`,
        token,
      );
      triggerBlobDownload(blob, "performance_reports.pdf");
    } catch (err) {
      setDownloadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to download performance report PDF.",
      );
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="p-2 md:p-4 max-w-5xl mx-auto space-y-8">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/performance"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloadingPdf || loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1f48d9] text-white rounded-xl hover:bg-[#1a3cb8] transition-colors text-sm font-medium shadow-sm cursor-pointer disabled:opacity-60"
        >
          {downloadingPdf ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          <span>{downloadingPdf ? "Generating PDF..." : "Download PDF"}</span>
        </button>
      </div>

      {/* Centered Heading */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-800 mb-2">
          AI Performance Reports
        </h1>
        <p className="text-slate-500 text-sm">
          Bulk generated from your recent Excel upload.
        </p>
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

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center justify-center gap-3 text-slate-500 shadow-sm">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading AI performance reports...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3 shadow-sm">
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
      ) : records.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Inbox className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-800 mb-1">
            No performance reports found
          </h3>
          <p className="text-sm text-slate-500 mb-5">
            Upload a KPI Excel spreadsheet on the Performance dashboard to
            generate AI reviews.
          </p>
          <Link
            href="/performance"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors"
          >
            Upload Performance Data
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {records.map((record) => (
            <div
              key={record.id}
              className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm"
            >
              {/* Employee Header */}
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-6 pb-6 border-b border-slate-200">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-slate-800 flex flex-wrap items-center gap-3">
                    <span>{record.employee_name}</span>
                    <span className="text-xs font-medium px-3 py-1 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
                      {record.department}
                    </span>
                  </h2>
                  <div className="text-sm text-slate-500 mt-2 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-slate-400" />
                      Review Period: {record.review_period}
                    </span>
                    {record.employee_email && (
                      <span className="text-slate-400">
                        &middot; {record.employee_email}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Top Metrics */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 text-center">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Overall AI Score
                  </div>
                  <div
                    className={`text-5xl font-bold flex items-baseline justify-center gap-1 ${getScoreTextColor(
                      record.performance_score,
                    )}`}
                  >
                    <span>
                      {record.performance_score !== null
                        ? Math.round(record.performance_score)
                        : "—"}
                    </span>
                    {record.performance_score !== null && (
                      <span className="text-xl text-slate-400 font-medium">
                        /100
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl border border-slate-200 p-6 text-center">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    KPI Achievement
                  </div>
                  <div
                    className={`text-5xl font-bold flex items-baseline justify-center gap-1 ${getScoreTextColor(
                      record.kpi_achievement_percent,
                    )}`}
                  >
                    <span>
                      {record.kpi_achievement_percent !== null
                        ? Math.round(record.kpi_achievement_percent)
                        : "—"}
                    </span>
                    {record.kpi_achievement_percent !== null && (
                      <span className="text-xl text-slate-400 font-medium">
                        %
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Qualitative Analysis */}
              <div className="grid gap-5">
                <div className="bg-emerald-50/60 rounded-xl border border-emerald-200 p-6">
                  <h3 className="text-base font-semibold text-emerald-700 flex items-center gap-2 mb-2.5">
                    <ThumbsUp className="w-4 h-4" />
                    Key Strengths
                  </h3>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {record.strengths || "No strengths recorded."}
                  </p>
                </div>

                <div className="bg-amber-50/60 rounded-xl border border-amber-200 p-6">
                  <h3 className="text-base font-semibold text-amber-700 flex items-center gap-2 mb-2.5">
                    <TrendingUp className="w-4 h-4" />
                    Areas for Improvement
                  </h3>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {record.areas_for_improvement ||
                      "No improvement areas recorded."}
                  </p>
                </div>

                <div className="bg-[#f0efff]/70 rounded-xl border border-indigo-200 p-6">
                  <h3 className="text-base font-semibold text-[#544af4] flex items-center gap-2 mb-2.5">
                    <Target className="w-4 h-4" />
                    Recommended Actions
                  </h3>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {record.recommended_actions ||
                      "No recommended actions recorded."}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-slate-400 text-center pt-4 pb-2 flex items-center justify-center gap-2">
        <Bot className="w-4 h-4" />
        <span>Reports generated by TalentAI</span>
      </div>
    </div>
  );
}

/** HR AI Performance Report page wrapped in Suspense for searchParams. */
export default function PerformanceReportPage() {
  return (
    <AuthGuard requireRole="hr">
      <Suspense
        fallback={
          <div className="min-h-[60vh] flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent" />
          </div>
        }
      >
        <PerformanceReportInner />
      </Suspense>
    </AuthGuard>
  );
}
