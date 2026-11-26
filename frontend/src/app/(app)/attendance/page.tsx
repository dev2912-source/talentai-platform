"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Fingerprint,
  Loader2,
  LogIn,
  LogOut,
  ScanLine,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiDownloadBlob, apiFetch } from "@/lib/api";
import type {
  AttendanceLogOut,
  AttendanceReportBatchResponse,
  TapDataOut,
  TapResponse,
} from "@/lib/types";

const DEVICE_OPTIONS = [
  { value: "rfid_scanner", label: "RFID Scanner" },
  { value: "nfc_reader", label: "NFC Reader" },
  { value: "biometric", label: "Biometric" },
  { value: "qr_scanner", label: "QR Scanner" },
] as const;

function formatTapTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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

function AttendanceContent() {
  const router = useRouter();
  const { profile, token } = useAuth();
  const isHr = Boolean(profile?.is_hr);

  const [employeeId, setEmployeeId] = useState("EMP-0001");
  const employeeIdInitializedRef = useRef(false);
  const [deviceType, setDeviceType] = useState<string>("rfid_scanner");
  const [location, setLocation] = useState("Main Entrance Gate");

  const [tapping, setTapping] = useState(false);
  const [pulseActive, setPulseActive] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const [lastTap, setLastTap] = useState<TapDataOut | null>(null);
  const [tapBadge, setTapBadge] = useState<string | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);

  const [logs, setLogs] = useState<AttendanceLogOut[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const badgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!profile || employeeIdInitializedRef.current) return;
    employeeIdInitializedRef.current = true;
    if (profile.is_hr) {
      const cleanName = (profile.username || "ADMIN").trim().toUpperCase();
      setEmployeeId(`HR-${cleanName}`);
    } else {
      const cleanId = (profile.id || "0001").slice(0, 8).toUpperCase();
      setEmployeeId(`EMP-${cleanId}`);
    }
  }, [profile]);

  useEffect(() => {
    return () => {
      if (badgeTimeoutRef.current) clearTimeout(badgeTimeoutRef.current);
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    };
  }, []);

  const loadLogs = useCallback(async () => {
    if (!token || !isHr) return;
    setLoadingLogs(true);
    setLogsError(null);
    try {
      const data = await apiFetch<AttendanceLogOut[]>(
        "/api/attendance/logs",
        {},
        token,
      );
      setLogs(data);
    } catch (err) {
      setLogsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load attendance logs.",
      );
    } finally {
      setLoadingLogs(false);
    }
  }, [isHr, token]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  async function handleSimulateTap() {
    const trimmedId = employeeId.trim();
    if (!trimmedId) {
      setTapError("Please enter an Employee ID.");
      return;
    }

    setTapError(null);
    setPulseKey((prev) => prev + 1);
    setPulseActive(true);
    if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = setTimeout(() => setPulseActive(false), 900);

    setTapping(true);
    try {
      const res = await apiFetch<TapResponse>(
        "/api/attendance/tap",
        {
          method: "POST",
          body: JSON.stringify({
            employeeId: trimmedId,
            timestamp: new Date().toISOString(),
            deviceType,
            location: location.trim() || "Main Entrance Gate",
          }),
        },
        token,
      );

      setLastTap(res.data);
      setTapBadge(res.data.tapType);
      if (badgeTimeoutRef.current) clearTimeout(badgeTimeoutRef.current);
      badgeTimeoutRef.current = setTimeout(() => setTapBadge(null), 1200);

      if (isHr) {
        const newEntry: AttendanceLogOut = {
          id: res.data.id,
          employee_id: res.data.employeeId,
          timestamp: res.data.timestamp,
          device_type: res.data.deviceType,
          location: res.data.location,
          tap_type: res.data.tapType,
          created_at: res.data.timestamp,
        };
        setLogs((prev) => [newEntry, ...prev]);
      }
    } catch (err) {
      setTapError(
        err instanceof ApiError
          ? err.detail
          : "Unable to record card tap. Please try again.",
      );
    } finally {
      setTapping(false);
    }
  }

  async function handleExportExcel() {
    if (!token || exportingExcel) return;
    setExportError(null);
    setExportingExcel(true);
    try {
      const blob = await apiDownloadBlob("/api/attendance/export-excel", token);
      triggerBlobDownload(blob, "attendance_logs.xlsx");
    } catch (err) {
      setExportError(
        err instanceof ApiError
          ? err.detail
          : "Failed to export attendance Excel file.",
      );
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleTimesheetSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);

    if (files.length === 0) {
      setUploadError("Please select an Excel (.xlsx or .xls) timesheet file.");
      return;
    }

    const formData = new FormData();
    formData.append("file", files[0]);

    setUploading(true);
    try {
      const res = await apiFetch<AttendanceReportBatchResponse>(
        "/api/attendance/upload",
        {
          method: "POST",
          body: formData,
        },
        token,
      );
      const target = res.batch_id
        ? `/attendance/report?batch_id=${encodeURIComponent(res.batch_id)}`
        : "/attendance/report";
      router.push(target);
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.detail
          : "Timesheet analysis failed. Please verify the Excel file format.",
      );
      setUploading(false);
    }
  }

  return (
    <div className="p-2 md:p-4 max-w-[1200px] mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200 shrink-0">
            <Fingerprint className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-slate-800">
              Attendance Tracker
            </h1>
            <p className="text-slate-500 mt-0.5 text-sm">
              Tap your card to check in or check out
            </p>
          </div>
        </div>

        {isHr && (
          <Link
            href="/attendance/report"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm self-start sm:self-auto"
          >
            <span>View Latest AI Report</span>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </Link>
        )}
      </div>

      {/* Card Tap Device & HR Live Activity Log */}
      <div
        className={`grid grid-cols-1 gap-6 items-stretch ${
          isHr ? "lg:grid-cols-2" : "max-w-xl mx-auto"
        }`}
      >
        {/* Card Tap Simulator */}
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col h-full">
          <div className="flex items-center gap-3 mb-6">
            <h3 className="font-semibold text-lg text-slate-800">
              Card Tap Device
            </h3>
            <span className="px-3 py-1 text-[11px] bg-emerald-50 text-emerald-600 font-medium rounded-full">
              Simulator
            </span>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="relative mb-6 flex items-center justify-center">
              {pulseActive && (
                <div key={pulseKey} className="contents">
                  <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
                  <span
                    className="absolute -inset-3 rounded-full border-2 border-teal-400 animate-ping opacity-40 pointer-events-none"
                    style={{ animationDelay: "150ms" }}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleSimulateTap}
                disabled={tapping}
                className="relative w-32 h-32 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex flex-col items-center justify-center shadow-lg shadow-emerald-200 hover:shadow-xl hover:shadow-emerald-300 transition-all duration-300 hover:scale-105 active:scale-95 z-10 cursor-pointer disabled:opacity-80"
              >
                {tapping ? (
                  <>
                    <Loader2 className="w-9 h-9 mb-1 animate-spin" />
                    <span className="text-[11px] font-semibold tracking-wider uppercase">
                      Tapping
                    </span>
                  </>
                ) : tapBadge ? (
                  <>
                    <Check className="w-10 h-10 mb-1" />
                    <span className="text-[11px] font-semibold tracking-wider uppercase">
                      {tapBadge}
                    </span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-10 h-10 mb-1" />
                    <span className="text-[11px] font-semibold tracking-wider uppercase">
                      Tap
                    </span>
                  </>
                )}
              </button>
            </div>

            <p className="text-sm text-slate-500 text-center max-w-[270px]">
              Click the button to simulate a card tap. The system will
              automatically determine Check-In or Check-Out.
            </p>

            {/* Configuration */}
            <div className="mt-6 w-full space-y-3">
              <div>
                <label
                  htmlFor="sim-employee-id"
                  className="block mb-1.5 text-[13px] font-medium text-slate-500"
                >
                  Employee ID
                </label>
                <input
                  id="sim-employee-id"
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="sim-device-type"
                    className="block mb-1.5 text-[13px] font-medium text-slate-500"
                  >
                    Device Type
                  </label>
                  <div className="relative">
                    <select
                      id="sim-device-type"
                      value={deviceType}
                      onChange={(e) => setDeviceType(e.target.value)}
                      className="w-full px-4 py-2.5 pr-10 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm appearance-none"
                    >
                      {DEVICE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-500 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="sim-location"
                    className="block mb-1.5 text-[13px] font-medium text-slate-500"
                  >
                    Location
                  </label>
                  <input
                    id="sim-location"
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-sm"
                  />
                </div>
              </div>
            </div>

            {tapError && (
              <div
                role="alert"
                className="mt-4 w-full p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{tapError}</span>
              </div>
            )}

            {/* Last Tap Status Card */}
            {lastTap && (
              <div className="mt-5 w-full">
                <div
                  className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
                    lastTap.tapType === "IN"
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-amber-50 border-amber-200"
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      lastTap.tapType === "IN"
                        ? "bg-emerald-100 text-emerald-600"
                        : "bg-amber-100 text-amber-600"
                    }`}
                  >
                    {lastTap.tapType === "IN" ? (
                      <LogIn className="w-4 h-4" />
                    ) : (
                      <LogOut className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-semibold ${
                        lastTap.tapType === "IN"
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }`}
                    >
                      {lastTap.tapType === "IN"
                        ? "Checked In Successfully"
                        : "Checked Out Successfully"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {formatTapTime(lastTap.timestamp)} &middot; Tap #
                      {lastTap.tapNumber} &middot; {lastTap.location}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Activity Log (HR Only) */}
        {isHr && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm flex flex-col h-full">
            <div className="flex items-center justify-between gap-3 mb-6">
              <h3 className="font-semibold text-lg text-slate-800">
                Live Activity Log
              </h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={exportingExcel}
                  title="Export all attendance logs to Excel"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {exportingExcel ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{exportingExcel ? "Exporting..." : "Export Excel"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLogs([])}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  Clear log
                </button>
              </div>
            </div>

            {exportError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{exportError}</span>
              </div>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto max-h-[420px] pr-1">
              {loadingLogs ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-slate-400 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                  <p className="text-sm">Loading activity log...</p>
                </div>
              ) : logsError ? (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between gap-3">
                  <span>{logsError}</span>
                  <button
                    type="button"
                    onClick={loadLogs}
                    className="px-3 py-1 rounded-lg bg-white border border-red-200 text-xs font-medium hover:bg-red-100 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                    <ScanLine className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-400 font-medium">
                    No taps recorded yet
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Click the button to simulate a card tap
                  </p>
                </div>
              ) : (
                logs.map((log, index) => {
                  const isIn = log.tap_type === "IN";
                  return (
                    <div
                      key={`${log.id}-${log.timestamp}-${index}`}
                      className={`flex items-center gap-3 p-3 rounded-xl border ${
                        isIn
                          ? "bg-emerald-50 border-emerald-100"
                          : "bg-amber-50 border-amber-100"
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isIn
                            ? "bg-emerald-100 text-emerald-600"
                            : "bg-amber-100 text-amber-600"
                        }`}
                      >
                        {isIn ? (
                          <LogIn className="w-4 h-4" />
                        ) : (
                          <LogOut className="w-4 h-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-700 truncate">
                            {log.employee_id}
                          </p>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                              isIn
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {isIn ? "CHECK-IN" : "CHECK-OUT"}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {formatTapTime(log.timestamp)} &middot;{" "}
                          {log.device_type} &middot; {log.location}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* AI Timesheet Analysis (HR Only) */}
      {isHr && (
        <section className="pt-2">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            AI Timesheet Analysis
          </h2>
          <div className="flex justify-center">
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm w-full max-w-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center border border-teal-100">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">
                    Upload Timesheet
                  </h3>
                  <p className="text-sm text-slate-400">
                    Supported formats: .xlsx, .xls
                  </p>
                </div>
              </div>

              {uploadError && (
                <div
                  role="alert"
                  className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{uploadError}</span>
                </div>
              )}

              <form onSubmit={handleTimesheetSubmit} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700 block">
                    Employee Timesheet <span className="text-red-500">*</span>
                  </label>
                  <FileDropzone
                    files={files}
                    onFilesChange={setFiles}
                    accept=".xlsx,.xls"
                    multiple={false}
                    title="Click to upload or drag and drop"
                    subtitle="Upload Excel file containing login and logout times"
                    buttonLabel="Browse Files"
                    disabled={uploading}
                  />
                </div>

                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full py-3.5 bg-gradient-to-r from-teal-500 to-emerald-600 text-white font-medium rounded-xl hover:opacity-95 transition-all shadow-md shadow-teal-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Analyzing Data...</span>
                    </>
                  ) : (
                    <>
                      <Bot className="w-5 h-5" />
                      <span>Generate AI Attendance Report</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Attendance Tracker & AI Timesheet Analyzer accessible to both HR and Employees. */
export default function AttendancePage() {
  return (
    <AuthGuard>
      <AttendanceContent />
    </AuthGuard>
  );
}
