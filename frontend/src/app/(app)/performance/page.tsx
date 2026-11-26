"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  FileSpreadsheet,
  Loader2,
  TrendingUp,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiFetch } from "@/lib/api";
import type { PerformanceBatchResponse } from "@/lib/types";

function PerformanceDashboardContent() {
  const router = useRouter();
  const { token } = useAuth();

  const [reviewPeriod, setReviewPeriod] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const period = reviewPeriod.trim();
    if (!period) {
      setError("Please enter a review period (e.g. Q1 2026).");
      return;
    }

    if (files.length === 0) {
      setError("Please upload an Excel (.xlsx or .xls) performance file.");
      return;
    }

    const formData = new FormData();
    formData.append("review_period", period);
    formData.append("file", files[0]);

    setSubmitting(true);
    try {
      const res = await apiFetch<PerformanceBatchResponse>(
        "/api/performance/upload",
        {
          method: "POST",
          body: formData,
        },
        token,
      );
      const target = res.batch_id
        ? `/performance/report?batch_id=${encodeURIComponent(res.batch_id)}`
        : "/performance/report";
      router.push(target);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Failed to generate performance reviews. Please verify the Excel file.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="p-2 md:p-4 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto pt-2">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#1f48d9] to-[#544af4] flex items-center justify-center shadow-lg shadow-[#1f48d9]/20">
          <TrendingUp className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-800 mb-2">
          Performance Review Agent
        </h1>
        <p className="text-slate-500 text-sm">
          Upload a global Excel file containing performance data for multiple
          employees to generate AI reviews in bulk.
        </p>
        <div className="mt-4">
          <Link
            href="/performance/report"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#544af4] hover:text-[#4338ca] transition-colors"
          >
            <span>View Latest Performance Reports</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Upload Card */}
      <div className="flex justify-center">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm w-full max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1f48d9] flex items-center justify-center border border-blue-100">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-800">
                Upload Performance Data
              </h2>
              <p className="text-sm text-slate-400">
                Supported formats: .xlsx, .xls
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="review-period"
                className="text-sm font-medium text-slate-700 block"
              >
                Review Period (e.g. Q1 2026){" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                id="review-period"
                type="text"
                required
                disabled={submitting}
                value={reviewPeriod}
                onChange={(e) => setReviewPeriod(e.target.value)}
                placeholder="Q1 2026"
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm disabled:opacity-60"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 block">
                Performance Data Excel <span className="text-red-500">*</span>
              </label>
              <FileDropzone
                files={files}
                onFilesChange={setFiles}
                accept=".xlsx,.xls"
                multiple={false}
                title="Click to upload or drag and drop"
                subtitle="Upload Excel file containing employee emails and KPI data"
                buttonLabel="Browse Files"
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-[#1f48d9] hover:bg-[#1a3cb8] text-white font-medium rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Analyzing Data with AI...</span>
                </>
              ) : (
                <>
                  <Bot className="w-5 h-5" />
                  <span>Generate Bulk Reviews</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** HR Performance Review Bulk Upload Dashboard protected by HR role guard. */
export default function PerformancePage() {
  return (
    <AuthGuard requireRole="hr">
      <PerformanceDashboardContent />
    </AuthGuard>
  );
}
