"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Bot,
  Calendar,
  Download,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Percent,
  Search,
  Target,
  ThumbsUp,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiDownloadBlob, apiFetch, triggerBlobDownload } from "@/lib/api";
import type {
  PerformanceBatchResponse,
  PerformanceBatchSummaryOut,
  PerformanceRecordOut,
} from "@/lib/types";

function getScoreTextColor(score: number | null): string {
  if (score === null) return "text-slate-600";
  if (score >= 85) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function formatBatchLabel(batch: PerformanceBatchSummaryOut, idx: number): string {
  const period = batch.review_period || `Batch ${idx + 1}`;
  const datePart = batch.created_at
    ? new Date(batch.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  return `${period}${datePart ? ` · ${datePart}` : ""} (${batch.employee_count})`;
}

function PerformanceReportInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id");
  const { token } = useAuth();

  const [resolvedBatchId, setResolvedBatchId] = useState<string | null>(
    batchIdParam,
  );
  const [batches, setBatches] = useState<PerformanceBatchSummaryOut[]>([]);
  const [records, setRecords] = useState<PerformanceRecordOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingExcel, setDownloadingExcel] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"score_desc" | "kpi_desc" | "name_asc">("score_desc");

  const loadReports = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setConfirmDeleteBatch(false);
    try {
      const query = batchIdParam
        ? `?batch_id=${encodeURIComponent(batchIdParam)}`
        : "";
      const [data, batchList] = await Promise.all([
        apiFetch<PerformanceBatchResponse>(
          `/api/performance/reports${query}`,
          {},
          token,
        ),
        apiFetch<PerformanceBatchSummaryOut[]>(
          "/api/performance/batches",
          {},
          token,
        ).catch(() => [] as PerformanceBatchSummaryOut[]),
      ]);
      setResolvedBatchId(data.batch_id);
      setRecords(data.records);
      setBatches(batchList);
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
        `/api/performance/reports/excel${query}`,
        token,
      );
      triggerBlobDownload(blob, "performance_reports.xlsx");
    } catch (err) {
      setDownloadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to download performance report Excel.",
      );
    } finally {
      setDownloadingExcel(false);
    }
  }

  async function handleDeleteBatch() {
    const targetBatch = resolvedBatchId ?? batchIdParam;
    if (!token || !targetBatch || deletingBatch) return;
    setDeletingBatch(true);
    setDownloadError(null);
    try {
      await apiFetch<{ status: string; batch_id: string }>(
        `/api/performance/batches/${encodeURIComponent(targetBatch)}`,
        { method: "DELETE" },
        token,
      );
      setConfirmDeleteBatch(false);
      if (batchIdParam) {
        router.push("/performance/report");
      } else {
        await loadReports();
      }
    } catch (err) {
      setDownloadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to delete performance batch.",
      );
    } finally {
      setDeletingBatch(false);
    }
  }

  const kpis = useMemo(() => {
    const scored = records.filter((r) => r.performance_score !== null);
    const avgScore = scored.length
      ? Math.round(
          scored.reduce((sum, r) => sum + (r.performance_score ?? 0), 0) /
            scored.length,
        )
      : null;
    const kpiItems = records.filter((r) => r.kpi_achievement_percent !== null);
    const avgKpi = kpiItems.length
      ? Math.round(
          kpiItems.reduce((sum, r) => sum + (r.kpi_achievement_percent ?? 0), 0) /
            kpiItems.length,
        )
      : null;
    const topRecord = [...records].sort(
      (a, b) => (b.performance_score ?? -1) - (a.performance_score ?? -1),
    )[0];
    return {
      count: records.length,
      avgScore,
      avgKpi,
      topPerformer: topRecord?.employee_name ?? "—",
    };
  }, [records]);

  const departments = useMemo(() => {
    const set = new Set(records.map((r) => r.department).filter(Boolean));
    return ["ALL", ...Array.from(set).sort()];
  }, [records]);

  const visibleRecords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = records.filter((r) => {
      if (deptFilter !== "ALL" && r.department !== deptFilter) return false;
      if (!q) return true;
      return (
        r.employee_name.toLowerCase().includes(q) ||
        r.employee_email.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === "kpi_desc") {
        return (b.kpi_achievement_percent ?? -1) - (a.kpi_achievement_percent ?? -1);
      }
      if (sortBy === "name_asc") {
        return a.employee_name.localeCompare(b.employee_name);
      }
      return (b.performance_score ?? -1) - (a.performance_score ?? -1);
    });
  }, [deptFilter, records, searchQuery, sortBy]);

  return (
    <div className="p-2 md:p-4 max-w-5xl mx-auto space-y-6 sm:space-y-8">
      {/* Top Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <Link
          href="/performance"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors text-sm font-medium self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className="flex flex-wrap items-center gap-2.5">
          {batches.length > 0 && (
            <select
              value={resolvedBatchId ?? ""}
              onChange={(e) => {
                const next = e.target.value;
                router.push(
                  next
                    ? `/performance/report?batch_id=${encodeURIComponent(next)}`
                    : "/performance/report",
                );
              }}
              aria-label="Select performance review batch"
              className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {batches.map((batch, idx) => (
                <option key={batch.batch_id} value={batch.batch_id}>
                  {formatBatchLabel(batch, idx)}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={downloadingExcel || loading || records.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors text-sm font-medium cursor-pointer disabled:opacity-60"
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
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1f48d9] text-white rounded-xl hover:bg-[#1a3cb8] transition-colors text-sm font-medium shadow-sm cursor-pointer disabled:opacity-60"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{downloadingPdf ? "Generating PDF..." : "Download PDF"}</span>
          </button>

          {records.length > 0 &&
            (confirmDeleteBatch ? (
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={deletingBatch}
                  onClick={() => void handleDeleteBatch()}
                  className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  {deletingBatch ? "..." : "Confirm Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteBatch(false)}
                  className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDeleteBatch(true)}
                title="Delete this review batch"
                aria-label="Delete this review batch"
                className="p-2 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ))}
        </div>
      </div>

      {/* Centered Heading */}
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800 mb-2">
          AI Performance Reports
        </h1>
        <p className="text-slate-500 text-sm">
          Bulk generated from your recent Excel upload.
        </p>
      </div>

      {/* Top Executive KPI Cards */}
      {!loading && !error && records.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1f48d9] flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Reviewed</p>
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
            <div className="w-10 h-10 rounded-xl bg-[#f0efff] text-[#544af4] flex items-center justify-center shrink-0">
              <Percent className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Avg KPI</p>
              <p className="text-xl font-bold text-slate-800">
                {kpis.avgKpi !== null ? `${kpis.avgKpi}%` : "N/A"}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">Top Performer</p>
              <p className="text-sm font-bold text-slate-800 truncate">
                {kpis.topPerformer}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search, Department Filter & Sort Bar */}
      {!loading && !error && records.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search employee name or email..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              aria-label="Filter by department"
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d === "ALL" ? "All Departments" : d}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "score_desc" | "kpi_desc" | "name_asc")
              }
              aria-label="Sort performance records"
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="score_desc">AI Score: High → Low</option>
              <option value="kpi_desc">KPI Achievement: High → Low</option>
              <option value="name_asc">Name: A → Z</option>
            </select>
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
      ) : visibleRecords.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Inbox className="w-6 h-6 text-slate-400" />
          </div>
          <h3 className="text-base font-medium text-slate-800 mb-1">
            No performance reports found
          </h3>
          <p className="text-sm text-slate-500 mb-5">
            {records.length === 0
              ? "Upload a KPI Excel spreadsheet on the Performance dashboard to generate AI reviews."
              : "No employees match your current search or department filter."}
          </p>
          {records.length === 0 && (
            <Link
              href="/performance"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors"
            >
              Upload Performance Data
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {visibleRecords.map((record) => (
            <div
              key={record.id}
              className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm"
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
                    className={`text-4xl sm:text-5xl font-bold flex items-baseline justify-center gap-1 ${getScoreTextColor(
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
                    className={`text-4xl sm:text-5xl font-bold flex items-baseline justify-center gap-1 ${getScoreTextColor(
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
