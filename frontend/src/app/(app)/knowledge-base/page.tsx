"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Database,
  Edit2,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquare,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiFetch } from "@/lib/api";
import type {
  ChatResponse,
  FaqOut,
  KbOverviewResponse,
  PolicyOut,
  UserProfileOut,
} from "@/lib/types";

function formatDate(iso: string | null): string {
  if (!iso) return "Recently";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Recently";
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function KnowledgeBaseContent() {
  const { token } = useAuth();

  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [faqs, setFaqs] = useState<FaqOut[]>([]);
  const [employees, setEmployees] = useState<UserProfileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Policy form & filter state
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyTitle, setPolicyTitle] = useState("");
  const [policyContent, setPolicyContent] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [confirmDeletePolicyId, setConfirmDeletePolicyId] = useState<string | null>(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const [policySearch, setPolicySearch] = useState("");
  const policyFormRef = useRef<HTMLDivElement>(null);

  // FAQ form & filter state
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [faqQuestion, setFaqQuestion] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [savingFaq, setSavingFaq] = useState(false);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [confirmDeleteFaqId, setConfirmDeleteFaqId] = useState<string | null>(null);
  const [deletingFaqId, setDeletingFaqId] = useState<string | null>(null);
  const [faqSearch, setFaqSearch] = useState("");
  const faqFormRef = useRef<HTMLDivElement>(null);

  // Employee directory search, filter, add & edit state
  const [empSearch, setEmpSearch] = useState("");
  const [empDeptFilter, setEmpDeptFilter] = useState("ALL");
  const [empActionError, setEmpActionError] = useState<string | null>(null);

  const [editingEmp, setEditingEmp] = useState<UserProfileOut | null>(null);
  const [editEmpDept, setEditEmpDept] = useState("");
  const [editEmpSalary, setEditEmpSalary] = useState("50000");
  const [editEmpLeave, setEditEmpLeave] = useState("10");
  const [editEmpAttendance, setEditEmpAttendance] = useState("100");
  const [savingEmpEdit, setSavingEmpEdit] = useState(false);

  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [newEmpUsername, setNewEmpUsername] = useState("");
  const [newEmpEmail, setNewEmpEmail] = useState("");
  const [newEmpPassword, setNewEmpPassword] = useState("");
  const [newEmpDept, setNewEmpDept] = useState("Engineering");
  const [newEmpSalary, setNewEmpSalary] = useState("65000");
  const [newEmpLeave, setNewEmpLeave] = useState("12");
  const [creatingEmp, setCreatingEmp] = useState(false);

  // Test AI Knowledge Base simulator state
  const [testQuestion, setTestQuestion] = useState("");
  const [testAnswer, setTestAnswer] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<KbOverviewResponse>(
        "/api/kb/overview",
        {},
        token,
      );
      setPolicies(data.policies);
      setFaqs(data.faqs);
      setEmployees(data.employees);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? err.detail
          : "Unable to load knowledge base data.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  function resetPolicyForm() {
    setEditingPolicyId(null);
    setPolicyTitle("");
    setPolicyContent("");
    setPolicyError(null);
  }

  function resetFaqForm() {
    setEditingFaqId(null);
    setFaqQuestion("");
    setFaqAnswer("");
    setFaqError(null);
  }

  function startEditPolicy(policy: PolicyOut) {
    setEditingPolicyId(policy.id);
    setPolicyTitle(policy.title);
    setPolicyContent(policy.content);
    setPolicyError(null);
    policyFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function startEditFaq(faq: FaqOut) {
    setEditingFaqId(faq.id);
    setFaqQuestion(faq.question);
    setFaqAnswer(faq.answer);
    setFaqError(null);
    faqFormRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function startEditEmployee(emp: UserProfileOut) {
    setEditingEmp(emp);
    setEditEmpDept(emp.department);
    setEditEmpSalary(String(emp.salary));
    setEditEmpLeave(String(emp.leave_balance));
    setEditEmpAttendance(String(emp.attendance_score));
    setEmpActionError(null);
  }

  async function handlePolicySubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;

    const title = policyTitle.trim();
    const content = policyContent.trim();
    if (!title || !content) {
      setPolicyError("Policy title and content are required.");
      return;
    }

    setPolicyError(null);
    setSavingPolicy(true);
    try {
      if (editingPolicyId) {
        const updated = await apiFetch<PolicyOut>(
          `/api/kb/policies/${editingPolicyId}`,
          {
            method: "PUT",
            body: JSON.stringify({ title, content }),
          },
          token,
        );
        setPolicies((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)),
        );
      } else {
        const created = await apiFetch<PolicyOut>(
          "/api/kb/policies",
          {
            method: "POST",
            body: JSON.stringify({ title, content }),
          },
          token,
        );
        setPolicies((prev) => [created, ...prev]);
      }
      resetPolicyForm();
    } catch (err) {
      setPolicyError(
        err instanceof ApiError ? err.detail : "Unable to save policy.",
      );
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleDeletePolicy(policyId: string) {
    if (!token) return;
    setPolicyError(null);
    setDeletingPolicyId(policyId);
    try {
      await apiFetch<{ status: string; id: string }>(
        `/api/kb/policies/${policyId}`,
        { method: "DELETE" },
        token,
      );
      setPolicies((prev) => prev.filter((p) => p.id !== policyId));
      setConfirmDeletePolicyId(null);
      if (editingPolicyId === policyId) {
        resetPolicyForm();
      }
    } catch (err) {
      setPolicyError(
        err instanceof ApiError ? err.detail : "Unable to delete policy.",
      );
    } finally {
      setDeletingPolicyId(null);
    }
  }

  async function handleFaqSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;

    const question = faqQuestion.trim();
    const answer = faqAnswer.trim();
    if (!question || !answer) {
      setFaqError("Question and answer are required.");
      return;
    }

    setFaqError(null);
    setSavingFaq(true);
    try {
      if (editingFaqId) {
        const updated = await apiFetch<FaqOut>(
          `/api/kb/faqs/${editingFaqId}`,
          {
            method: "PUT",
            body: JSON.stringify({ question, answer }),
          },
          token,
        );
        setFaqs((prev) =>
          prev.map((f) => (f.id === updated.id ? updated : f)),
        );
      } else {
        const created = await apiFetch<FaqOut>(
          "/api/kb/faqs",
          {
            method: "POST",
            body: JSON.stringify({ question, answer }),
          },
          token,
        );
        setFaqs((prev) => [created, ...prev]);
      }
      resetFaqForm();
    } catch (err) {
      setFaqError(
        err instanceof ApiError ? err.detail : "Unable to save FAQ.",
      );
    } finally {
      setSavingFaq(false);
    }
  }

  async function handleDeleteFaq(faqId: string) {
    if (!token) return;
    setFaqError(null);
    setDeletingFaqId(faqId);
    try {
      await apiFetch<{ status: string; id: string }>(
        `/api/kb/faqs/${faqId}`,
        { method: "DELETE" },
        token,
      );
      setFaqs((prev) => prev.filter((f) => f.id !== faqId));
      setConfirmDeleteFaqId(null);
      if (editingFaqId === faqId) {
        resetFaqForm();
      }
    } catch (err) {
      setFaqError(
        err instanceof ApiError ? err.detail : "Unable to delete FAQ.",
      );
    } finally {
      setDeletingFaqId(null);
    }
  }

  async function handleSaveEmployeeEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || !editingEmp || savingEmpEdit) return;
    setSavingEmpEdit(true);
    setEmpActionError(null);
    try {
      const updated = await apiFetch<UserProfileOut>(
        `/api/kb/employees/${editingEmp.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            department: editEmpDept.trim() || "General",
            salary: Math.max(0, Number(editEmpSalary) || 0),
            leave_balance: Math.max(0, Number.parseInt(editEmpLeave, 10) || 0),
            attendance_score: Math.max(
              0,
              Math.min(100, Number.parseInt(editEmpAttendance, 10) || 0),
            ),
          }),
        },
        token,
      );
      setEmployees((prev) =>
        prev.map((emp) => (emp.id === updated.id ? updated : emp)),
      );
      setEditingEmp(null);
    } catch (err) {
      setEmpActionError(
        err instanceof ApiError ? err.detail : "Unable to update employee.",
      );
    } finally {
      setSavingEmpEdit(false);
    }
  }

  async function handleCreateEmployee(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || creatingEmp) return;
    setCreatingEmp(true);
    setEmpActionError(null);
    try {
      const created = await apiFetch<UserProfileOut>(
        "/api/kb/employees",
        {
          method: "POST",
          body: JSON.stringify({
            username: newEmpUsername.trim(),
            email: newEmpEmail.trim(),
            password: newEmpPassword,
            department: newEmpDept.trim() || "Engineering",
            salary: Math.max(0, Number(newEmpSalary) || 50000),
            leave_balance: Math.max(0, Number.parseInt(newEmpLeave, 10) || 10),
            attendance_score: 100,
          }),
        },
        token,
      );
      setEmployees((prev) => [created, ...prev]);
      setNewEmpUsername("");
      setNewEmpEmail("");
      setNewEmpPassword("");
      setShowAddEmpModal(false);
    } catch (err) {
      setEmpActionError(
        err instanceof ApiError ? err.detail : "Unable to create employee.",
      );
    } finally {
      setCreatingEmp(false);
    }
  }

  async function handleTestAiQuery(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = testQuestion.trim();
    if (!token || !q || testingAi) return;
    setTestingAi(true);
    setTestError(null);
    try {
      const res = await apiFetch<ChatResponse>(
        "/api/kb/test-query",
        {
          method: "POST",
          body: JSON.stringify({ message: q }),
        },
        token,
      );
      setTestAnswer(res.response);
    } catch (err) {
      setTestError(
        err instanceof ApiError ? err.detail : "Unable to test AI response.",
      );
    } finally {
      setTestingAi(false);
    }
  }

  const avgAttendance = useMemo(() => {
    if (employees.length === 0) return 0;
    return Math.round(
      employees.reduce((sum, emp) => sum + (emp.attendance_score || 0), 0) /
        employees.length,
    );
  }, [employees]);

  const departments = useMemo(() => {
    const set = new Set(employees.map((e) => e.department).filter(Boolean));
    return ["ALL", ...Array.from(set).sort()];
  }, [employees]);

  const filteredPolicies = useMemo(() => {
    const q = policySearch.trim().toLowerCase();
    if (!q) return policies;
    return policies.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q),
    );
  }, [policies, policySearch]);

  const filteredFaqs = useMemo(() => {
    const q = faqSearch.trim().toLowerCase();
    if (!q) return faqs;
    return faqs.filter(
      (f) =>
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q),
    );
  }, [faqs, faqSearch]);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    return employees.filter((emp) => {
      if (empDeptFilter !== "ALL" && emp.department !== empDeptFilter) {
        return false;
      }
      if (!q) return true;
      return (
        emp.username.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        emp.department.toLowerCase().includes(q)
      );
    });
  }, [empDeptFilter, empSearch, employees]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading Knowledge Base...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-800">
          Unable to load Knowledge Base
        </h2>
        <p className="text-sm text-slate-500">{loadError}</p>
        <button
          type="button"
          onClick={loadOverview}
          className="px-4 py-2 rounded-lg bg-[#1f48d9] text-white text-sm font-medium hover:bg-[#1a3cb8] transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-2 md:p-4 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-800">
            Knowledge Base Management
          </h2>
          <p className="text-slate-500 mt-1 text-sm">
            Manage Company Policies, FAQs, and Employee HR Metrics for the AI
            Support Agent.
          </p>
        </div>
        <div className="px-4 py-2 bg-[#f0efff] text-[#544af4] rounded-xl border border-indigo-200 flex items-center gap-2 self-start sm:self-auto">
          <Database className="w-4 h-4" />
          <span className="text-sm font-medium">Knowledge Base Live</span>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#1f48d9] flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Policies</p>
            <p className="text-xl font-bold text-slate-800">{policies.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f0efff] text-[#544af4] flex items-center justify-center shrink-0">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">FAQs</p>
            <p className="text-xl font-bold text-slate-800">{faqs.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Employees</p>
            <p className="text-xl font-bold text-slate-800">{employees.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Avg Attendance</p>
            <p className="text-xl font-bold text-slate-800">{avgAttendance}%</p>
          </div>
        </div>
      </div>

      {/* Test AI Knowledge Base Simulator */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#f0efff] text-[#544af4] flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Test AI Knowledge Base
            </h3>
            <p className="text-xs text-slate-500">
              Preview how the Employee AI Assistant responds using your latest
              policies and FAQs
            </p>
          </div>
        </div>

        <form onSubmit={handleTestAiQuery} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={testQuestion}
            onChange={(e) => setTestQuestion(e.target.value)}
            disabled={testingAi}
            placeholder="Ask a test question (e.g. What is our remote work policy?)..."
            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
          />
          <button
            type="submit"
            disabled={testingAi || !testQuestion.trim()}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#544af4] hover:bg-[#4338ca] text-white text-sm font-medium rounded-xl transition-colors cursor-pointer disabled:opacity-50 shrink-0"
          >
            {testingAi ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>{testingAi ? "Testing..." : "Test Query"}</span>
          </button>
        </form>

        {testError && (
          <p className="text-xs text-red-600">{testError}</p>
        )}
        {testAnswer && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
            {testAnswer}
          </div>
        )}
      </section>

      {/* 2-Column Policies & FAQs Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Policies Column */}
        <div className="space-y-6">
          <div
            ref={policyFormRef}
            className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm"
          >
            <h3 className="font-semibold text-lg text-slate-800 mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#1f48d9]" />
              {editingPolicyId ? "Edit Policy" : "Add/Edit Policy"}
            </h3>

            {policyError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{policyError}</span>
              </div>
            )}

            <form onSubmit={handlePolicySubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="policy-title"
                  className="text-sm font-medium text-slate-700 block"
                >
                  Policy Title
                </label>
                <input
                  id="policy-title"
                  type="text"
                  required
                  disabled={savingPolicy}
                  value={policyTitle}
                  onChange={(e) => setPolicyTitle(e.target.value)}
                  placeholder="e.g. Remote Work Policy"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm disabled:opacity-60"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="policy-content"
                  className="text-sm font-medium text-slate-700 block"
                >
                  Content
                </label>
                <textarea
                  id="policy-content"
                  rows={4}
                  required
                  disabled={savingPolicy}
                  value={policyContent}
                  onChange={(e) => setPolicyContent(e.target.value)}
                  placeholder="Enter the detailed policy text here..."
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm resize-none disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={savingPolicy}
                className="w-full py-2.5 bg-[#1f48d9] hover:bg-[#1a3cb8] text-white font-medium rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {savingPolicy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>
                  {savingPolicy
                    ? "Saving..."
                    : editingPolicyId
                      ? "Update Policy"
                      : "Save Policy"}
                </span>
              </button>

              {editingPolicyId && (
                <button
                  type="button"
                  onClick={resetPolicyForm}
                  disabled={savingPolicy}
                  className="w-full py-2 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors text-sm cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </form>
          </div>

          {/* Existing Policies */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-slate-500" />
                Existing Policies
                <span className="text-xs font-medium text-slate-400">
                  ({filteredPolicies.length})
                </span>
              </h3>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                  placeholder="Search policies..."
                  className="w-44 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
                />
              </div>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {filteredPolicies.length === 0 ? (
                <div className="text-center p-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  No policies found.
                </div>
              ) : (
                filteredPolicies.map((policy) => (
                  <div
                    key={policy.id}
                    className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 hover:border-[#1f48d9]/40 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-800 leading-tight">
                          {policy.title}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 mb-2">
                          Updated: {formatDate(policy.last_updated)}
                        </p>
                        <p className="text-sm text-slate-600 line-clamp-3 whitespace-pre-wrap">
                          {policy.content}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditPolicy(policy)}
                          title="Edit policy"
                          aria-label={`Edit ${policy.title}`}
                          className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-[#544af4] hover:text-white hover:border-[#544af4] transition-colors text-slate-500 cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {confirmDeletePolicyId === policy.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingPolicyId === policy.id}
                              onClick={() => void handleDeletePolicy(policy.id)}
                              className="px-2 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg cursor-pointer"
                            >
                              {deletingPolicyId === policy.id ? "..." : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePolicyId(null)}
                              className="px-2 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePolicyId(policy.id)}
                            title="Delete policy"
                            aria-label={`Delete ${policy.title}`}
                            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-slate-500 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* FAQs Column */}
        <div className="space-y-6">
          <div
            ref={faqFormRef}
            className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm"
          >
            <h3 className="font-semibold text-lg text-slate-800 mb-4 flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-[#544af4]" />
              {editingFaqId ? "Edit FAQ" : "Add/Edit FAQ"}
            </h3>

            {faqError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{faqError}</span>
              </div>
            )}

            <form onSubmit={handleFaqSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="faq-question"
                  className="text-sm font-medium text-slate-700 block"
                >
                  Question
                </label>
                <input
                  id="faq-question"
                  type="text"
                  required
                  disabled={savingFaq}
                  value={faqQuestion}
                  onChange={(e) => setFaqQuestion(e.target.value)}
                  placeholder="e.g. How many vacation days do I get?"
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm disabled:opacity-60"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="faq-answer"
                  className="text-sm font-medium text-slate-700 block"
                >
                  Answer
                </label>
                <textarea
                  id="faq-answer"
                  rows={3}
                  required
                  disabled={savingFaq}
                  value={faqAnswer}
                  onChange={(e) => setFaqAnswer(e.target.value)}
                  placeholder="Enter the detailed answer..."
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm resize-none disabled:opacity-60"
                />
              </div>

              <button
                type="submit"
                disabled={savingFaq}
                className="w-full py-2.5 bg-[#544af4] hover:bg-[#4338ca] text-white font-medium rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
              >
                {savingFaq ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>
                  {savingFaq
                    ? "Saving..."
                    : editingFaqId
                      ? "Update FAQ"
                      : "Save FAQ"}
                </span>
              </button>

              {editingFaqId && (
                <button
                  type="button"
                  onClick={resetFaqForm}
                  disabled={savingFaq}
                  className="w-full py-2 bg-slate-100 text-slate-700 font-medium rounded-xl hover:bg-slate-200 transition-colors text-sm cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </form>
          </div>

          {/* Existing FAQs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-slate-500" />
                Existing FAQs
                <span className="text-xs font-medium text-slate-400">
                  ({filteredFaqs.length})
                </span>
              </h3>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={faqSearch}
                  onChange={(e) => setFaqSearch(e.target.value)}
                  placeholder="Search FAQs..."
                  className="w-44 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
                />
              </div>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {filteredFaqs.length === 0 ? (
                <div className="text-center p-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  No FAQs found.
                </div>
              ) : (
                filteredFaqs.map((faq) => (
                  <div
                    key={faq.id}
                    className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 hover:border-[#544af4]/40 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-slate-800 leading-tight mb-2">
                          <span className="text-[#544af4] mr-1">Q:</span>
                          {faq.question}
                        </h4>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                          <span className="text-slate-400 font-medium mr-1">
                            A:
                          </span>
                          {faq.answer}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEditFaq(faq)}
                          title="Edit FAQ"
                          aria-label={`Edit ${faq.question}`}
                          className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-[#544af4] hover:text-white hover:border-[#544af4] transition-colors text-slate-500 cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {confirmDeleteFaqId === faq.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={deletingFaqId === faq.id}
                              onClick={() => void handleDeleteFaq(faq.id)}
                              className="px-2 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg cursor-pointer"
                            >
                              {deletingFaqId === faq.id ? "..." : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteFaqId(null)}
                              className="px-2 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs rounded-lg cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFaqId(faq.id)}
                            title="Delete FAQ"
                            aria-label={`Delete ${faq.question}`}
                            className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-slate-500 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Employee Directory */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#544af4]" />
            <h3 className="font-semibold text-lg text-slate-800">
              Employee Directory
            </h3>
            <span className="text-xs font-medium text-slate-400">
              ({filteredEmployees.length})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                placeholder="Search employees..."
                className="w-44 sm:w-52 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white"
              />
            </div>

            <select
              value={empDeptFilter}
              onChange={(e) => setEmpDeptFilter(e.target.value)}
              aria-label="Filter by department"
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept === "ALL" ? "All Departments" : dept}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                setEmpActionError(null);
                setShowAddEmpModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#544af4] hover:bg-[#4338ca] text-white text-xs font-medium transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add Employee</span>
            </button>
          </div>
        </div>

        {empActionError && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {empActionError}
          </div>
        )}

        {filteredEmployees.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No employee profiles match your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold">Employee</th>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold">Department</th>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold">Salary</th>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold">Leave Balance</th>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold">
                    Attendance Score
                  </th>
                  <th className="px-4 sm:px-6 py-3.5 font-semibold text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredEmployees.map((emp) => (
                  <tr
                    key={emp.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-4 sm:px-6 py-4">
                      <div className="font-medium text-slate-800">
                        {emp.username}
                      </div>
                      <div className="text-xs text-slate-400">{emp.email}</div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-slate-600 whitespace-nowrap">
                      {emp.department}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-slate-700 font-medium whitespace-nowrap">
                      ${Number(emp.salary).toLocaleString()}
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-slate-600 whitespace-nowrap">
                      {emp.leave_balance} days
                    </td>
                    <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          emp.attendance_score >= 85
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : emp.attendance_score >= 60
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {emp.attendance_score}%
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => startEditEmployee(emp)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Edit Employee Modal */}
      {editingEmp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setEditingEmp(null)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Edit {editingEmp.username}
                </h3>
                <p className="text-xs text-slate-400">{editingEmp.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingEmp(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEmployeeEdit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Department
                </label>
                <input
                  type="text"
                  required
                  value={editEmpDept}
                  onChange={(e) => setEditEmpDept(e.target.value)}
                  className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Salary ($)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editEmpSalary}
                    onChange={(e) => setEditEmpSalary(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Leave (Days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editEmpLeave}
                    onChange={(e) => setEditEmpLeave(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Attendance (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={editEmpAttendance}
                    onChange={(e) => setEditEmpAttendance(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEmpEdit}
                  className="px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {savingEmpEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddEmpModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowAddEmpModal(false)}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">
                Onboard New Employee
              </h3>
              <button
                type="button"
                onClick={() => setShowAddEmpModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateEmployee} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    value={newEmpUsername}
                    onChange={(e) => setNewEmpUsername(e.target.value)}
                    placeholder="priya"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Department *
                  </label>
                  <input
                    type="text"
                    required
                    value={newEmpDept}
                    onChange={(e) => setNewEmpDept(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={newEmpEmail}
                  onChange={(e) => setNewEmpEmail(e.target.value)}
                  placeholder="priya@company.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Temporary Password * (min 6 chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newEmpPassword}
                  onChange={(e) => setNewEmpPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Salary ($)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newEmpSalary}
                    onChange={(e) => setNewEmpSalary(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Leave Balance (Days)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newEmpLeave}
                    onChange={(e) => setNewEmpLeave(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddEmpModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingEmp}
                  className="px-4 py-2 rounded-xl bg-[#544af4] text-white text-xs font-medium cursor-pointer disabled:opacity-60"
                >
                  {creatingEmp ? "Creating..." : "Create Employee"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** HR Knowledge Base Management page protected by HR role guard. */
export default function KnowledgeBasePage() {
  return (
    <AuthGuard requireRole="hr">
      <KnowledgeBaseContent />
    </AuthGuard>
  );
}
