"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
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
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { FileDropzone } from "@/components/FileDropzone";
import { ApiError, apiDownloadBlob, apiFetch, triggerBlobDownload } from "@/lib/api";
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

function AttendanceContent() {
  const router = useRouter();
  const { profile, token } = useAuth();
  const isHr = Boolean(profile?.is_hr);

  const [employeeId, setEmployeeId] = useState("EMP-0001");
  const employeeIdInitializedRef = useRef(false);
  const [deviceType, setDeviceType] = useState<string>("rfid_scanner");
  const [location, setLocation] = useState("Bengaluru HQ - Outer Ring Road");

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
  const [downloadingSample, setDownloadingSample] = useState(false);
  const [deletingLogId, setDeletingLogId] = useState<string | number | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [logTypeFilter, setLogTypeFilter] = useState<"ALL" | "IN" | "OUT">("ALL");

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
    if (!token) {
      setLoadingLogs(false);
      return;
    }
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
  }, [token]);

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

      if (res.data) {
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
      const endpoint = isHr
        ? "/api/attendance/export-excel"
        : "/api/attendance/my-export";
      const blob = await apiDownloadBlob(endpoint, token);
      triggerBlobDownload(
        blob,
        isHr ? "attendance_logs.xlsx" : "my_attendance_logs.xlsx",
      );
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

  async function handleDownloadSampleTimesheet() {
    if (!token || downloadingSample) return;
    setUploadError(null);
    setDownloadingSample(true);
    try {
      const blob = await apiDownloadBlob("/api/attendance/sample-timesheet", token);
      triggerBlobDownload(blob, "sample_attendance_timesheet.xlsx");
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.detail
          : "Failed to download sample timesheet.",
      );
    } finally {
      setDownloadingSample(false);
    }
  }

  async function handleDeleteLog(logId: string | number) {
    if (!token || !isHr || deletingLogId !== null) return;
    setDeletingLogId(logId);
    setLogsError(null);
    try {
      await apiFetch<{ status: string; id: number }>(
        `/api/attendance/logs/${logId}`,
        { method: "DELETE" },
        token,
      );
      setLogs((prev) => prev.filter((item) => item.id !== logId));
    } catch (err) {
      setLogsError(
        err instanceof ApiError
          ? err.detail
          : "Unable to delete attendance log.",
      );
    } finally {
      setDeletingLogId(null);
    }
  }

  const logStats = useMemo(() => {
    const checkIns = logs.filter((l) => l.tap_type === "IN").length;
    const checkOuts = logs.filter((l) => l.tap_type === "OUT").length;
    const latestTap = logs[0]?.tap_type ?? null;

    const todayStr = new Date().toDateString();
    const todayTaps = logs
      .filter((l) => new Date(l.timestamp).toDateString() === todayStr)
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

    let totalMs = 0;
    let activeIn: number | null = null;
    for (const tap of todayTaps) {
      const ts = new Date(tap.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      if (tap.tap_type === "IN" && activeIn === null) {
        activeIn = ts;
      } else if (tap.tap_type === "OUT" && activeIn !== null) {
        totalMs += Math.max(0, ts - activeIn);
        activeIn = null;
      }
    }
    if (activeIn !== null) {
      totalMs += Math.max(0, Date.now() - activeIn);
    }
    const totalMinutes = Math.floor(totalMs / 60000);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const hoursTodayLabel = `${hrs}h ${mins}m`;

    return {
      total: logs.length,
      checkIns,
      checkOuts,
      latestTap,
      hoursTodayLabel,
      isActiveShift: activeIn !== null,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((log) => {
      if (logTypeFilter !== "ALL" && log.tap_type !== logTypeFilter) {
        return false;
      }
      if (!q) return true;
      return (
        log.employee_id.toLowerCase().includes(q) ||
        log.location.toLowerCase().includes(q) ||
        log.device_type.toLowerCase().includes(q)
      );
    });
  }, [logSearch, logTypeFilter, logs]);

  async function handleTimesheetSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);

    if (!token) {
      setUploadError("Authentication session missing. Please sign in again.");
      return;
    }

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
    <div className="p-1 sm:p-2 md:p-4 max-w-[1200px] mx-auto space-y-6 sm:space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-200 shrink-0">
            <Fingerprint className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-slate-800">
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

      {/* Live Attendance Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              {isHr ? "Recent Taps" : "My Taps"}
            </p>
            <p className="text-xl font-bold text-slate-800">{logStats.total}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <LogIn className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Check-Ins
            </p>
            <p className="text-xl font-bold text-slate-800">
              {logStats.checkIns}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <LogOut className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              Check-Outs
            </p>
            <p className="text-xl font-bold text-slate-800">
              {logStats.checkOuts}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
            <Fingerprint className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate">
              {isHr ? "Latest Status" : "Hours Today"}
            </p>
            {isHr ? (
              <p className="text-sm font-bold text-slate-800 truncate">
                {logStats.latestTap === "IN"
                  ? "Checked In"
                  : logStats.latestTap === "OUT"
                    ? "Checked Out"
                    : "No Taps Yet"}
              </p>
            ) : (
              <p className="text-base font-bold text-slate-800 truncate flex items-center gap-1.5">
                <span>{logStats.hoursTodayLabel}</span>
                {logStats.isActiveShift && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                    Active
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Card Tap Device & Live Activity Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Card Tap Simulator */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm flex flex-col h-full">
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

        {/* Live Activity Log (All for HR, Own Taps for Employee) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm flex flex-col h-full">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-lg text-slate-800">
              {isHr ? "Live Activity Log" : "My Recent Taps"}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={exportingExcel}
                title="Export attendance logs to Excel"
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
                onClick={() => void loadLogs()}
                disabled={loadingLogs}
                title="Refresh logs"
                aria-label="Refresh logs"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loadingLogs ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          {/* Search & Tap Type Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search ID or location..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              />
            </div>
            <div className="flex items-center gap-1">
              {(["ALL", "IN", "OUT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setLogTypeFilter(t)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    logTypeFilter === t
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t}
                </button>
              ))}
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
              ) : filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                    <ScanLine className="w-6 h-6 text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-400 font-medium">
                    {logs.length === 0
                      ? "No taps recorded yet"
                      : "No taps match your search or filter"}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {logs.length === 0
                      ? "Click the button to simulate a card tap"
                      : "Try clearing the search box or tap filter"}
                  </p>
                </div>
              ) : (
                filteredLogs.map((log, index) => {
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
                      {isHr && (
                        <button
                          type="button"
                          disabled={deletingLogId === log.id}
                          onClick={() => void handleDeleteLog(log.id)}
                          title="Delete tap log"
                          aria-label={`Delete log ${log.id}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        >
                          {deletingLogId === log.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
      </div>

      {/* AI Timesheet Analysis (HR Only) */}
      {isHr && (
        <section className="pt-2">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">
            AI Timesheet Analysis
          </h2>
          <div className="flex justify-center">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 lg:p-8 shadow-sm w-full max-w-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
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

                <button
                  type="button"
                  onClick={() => void handleDownloadSampleTimesheet()}
                  disabled={downloadingSample}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                >
                  {downloadingSample ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>Sample Timesheet (.xlsx)</span>
                </button>
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
