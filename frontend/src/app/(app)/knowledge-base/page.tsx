"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  Database,
  Edit2,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquare,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiFetch } from "@/lib/api";
import type {
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

  // Policy form state
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [policyTitle, setPolicyTitle] = useState("");
  const [policyContent, setPolicyContent] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [deletingPolicyId, setDeletingPolicyId] = useState<string | null>(null);
  const policyFormRef = useRef<HTMLDivElement>(null);

  // FAQ form state
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);
  const [faqQuestion, setFaqQuestion] = useState("");
  const [faqAnswer, setFaqAnswer] = useState("");
  const [savingFaq, setSavingFaq] = useState(false);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [deletingFaqId, setDeletingFaqId] = useState<string | null>(null);
  const faqFormRef = useRef<HTMLDivElement>(null);

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
    <div className="p-2 md:p-4 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-800">
            Knowledge Base Management
          </h2>
          <p className="text-slate-500 mt-1 text-sm">
            Manage Company Policies and FAQs for the AI Support Agent.
          </p>
        </div>
        <div className="px-4 py-2 bg-[#f0efff] text-[#544af4] rounded-xl border border-indigo-200 flex items-center gap-2 self-start sm:self-auto">
          <Database className="w-4 h-4" />
          <span className="text-sm font-medium">Vector DB Synced</span>
        </div>
      </div>

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
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-slate-500" />
                Existing Policies
              </h3>
              <span className="text-xs font-medium text-slate-400">
                {policies.length}
              </span>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {policies.length === 0 ? (
                <div className="text-center p-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  No policies found.
                </div>
              ) : (
                policies.map((policy) => (
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
                        <button
                          type="button"
                          disabled={deletingPolicyId === policy.id}
                          onClick={() => handleDeletePolicy(policy.id)}
                          title="Delete policy"
                          aria-label={`Delete ${policy.title}`}
                          className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-slate-500 cursor-pointer disabled:opacity-50"
                        >
                          {deletingPolicyId === policy.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
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
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-slate-800 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-slate-500" />
                Existing FAQs
              </h3>
              <span className="text-xs font-medium text-slate-400">
                {faqs.length}
              </span>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {faqs.length === 0 ? (
                <div className="text-center p-6 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                  No FAQs found.
                </div>
              ) : (
                faqs.map((faq) => (
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
                        <button
                          type="button"
                          disabled={deletingFaqId === faq.id}
                          onClick={() => handleDeleteFaq(faq.id)}
                          title="Delete FAQ"
                          aria-label={`Delete ${faq.question}`}
                          className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors text-slate-500 cursor-pointer disabled:opacity-50"
                        >
                          {deletingFaqId === faq.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
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
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#544af4]" />
            <h3 className="font-semibold text-lg text-slate-800">
              Employee Directory
            </h3>
          </div>
          <span className="text-xs font-medium text-slate-500">
            {employees.length}{" "}
            {employees.length === 1 ? "employee" : "employees"}
          </span>
        </div>

        {employees.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No employee profiles registered yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">Employee</th>
                  <th className="px-6 py-3.5 font-semibold">Department</th>
                  <th className="px-6 py-3.5 font-semibold">Salary</th>
                  <th className="px-6 py-3.5 font-semibold">Leave Balance</th>
                  <th className="px-6 py-3.5 font-semibold">
                    Attendance Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {employees.map((emp) => (
                  <tr
                    key={emp.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-800">
                        {emp.username}
                      </div>
                      <div className="text-xs text-slate-400">{emp.email}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {emp.department}
                    </td>
                    <td className="px-6 py-4 text-slate-700 font-medium">
                      ${Number(emp.salary).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-slate-600">
                      {emp.leave_balance} days
                    </td>
                    <td className="px-6 py-4">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
