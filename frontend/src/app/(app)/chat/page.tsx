"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  Copy,
  DollarSign,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiFetch, triggerBlobDownload } from "@/lib/api";
import type {
  ChatResponse,
  FaqOut,
  PerformanceRecordOut,
  PolicyOut,
} from "@/lib/types";

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
}

const QUICK_TOPICS = [
  {
    id: "policies",
    title: "Company Policies",
    subtitle: "Remote work & conduct",
    prompt: "What are the key company policies I should know about?",
  },
  {
    id: "leave",
    title: "Leave Balance",
    subtitle: "PTO & sick leave",
    prompt: "What is my current leave balance and leave policy?",
  },
  {
    id: "salary",
    title: "Compensation & Dept",
    subtitle: "Personal profile metrics",
    prompt: "Can you share my current salary and department details?",
  },
] as const;

const QUICK_PROMPTS = [
  "What is my leave balance?",
  "What is the remote work policy?",
  "Show my salary details",
  "What is my attendance score?",
] as const;

function currentTimeLabel(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderInlineBold(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

/** Lightweight safe formatter for bold text, bullet lists, and paragraphs in AI replies. */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm text-slate-700 leading-relaxed">
      {lines.map((rawLine, idx) => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }
        const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#544af4] mt-2 shrink-0" />
              <span className="flex-1">{renderInlineBold(bulletMatch[1])}</span>
            </div>
          );
        }
        const numMatch = trimmed.match(/^(\d+\.)\s+(.+)$/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="font-semibold text-[#544af4] shrink-0">
                {numMatch[1]}
              </span>
              <span className="flex-1">{renderInlineBold(numMatch[2])}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInlineBold(rawLine)}</p>;
      })}
    </div>
  );
}

function EmployeeChatContent() {
  const { profile, token } = useAuth();
  const username = profile?.username || "Employee";
  const userInitial = username.trim().charAt(0).toUpperCase() || "E";
  const storageKey = profile?.id ? `talentai_chat_history_${profile.id}` : null;

  const [activeTopic, setActiveTopic] = useState<string>("policies");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSalary, setShowSalary] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const historyLoadedRef = useRef(false);

  // Browse Policies & FAQs modal
  const [showKbModal, setShowKbModal] = useState(false);
  const [kbPolicies, setKbPolicies] = useState<PolicyOut[]>([]);
  const [kbFaqs, setKbFaqs] = useState<FaqOut[]>([]);
  const [loadingKb, setLoadingKb] = useState(false);
  const [kbSearch, setKbSearch] = useState("");

  // My Performance Reviews modal
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [myReviews, setMyReviews] = useState<PerformanceRecordOut[]>([]);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!storageKey || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
      }
    } catch {
      // Ignore malformed stored chat history.
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !historyLoadedRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      // Ignore storage quota errors.
    }
  }, [messages, storageKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function sendMessage(rawText: string) {
    const message = rawText.trim();
    if (!message || sending || !token) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: "user",
      text: message,
      timestamp: currentTimeLabel(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const data = await apiFetch<ChatResponse>(
        "/api/chat",
        {
          method: "POST",
          body: JSON.stringify({ message }),
        },
        token,
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          sender: "assistant",
          text: data.response,
          timestamp: currentTimeLabel(),
        },
      ]);
    } catch (err) {
      const detail =
        err instanceof ApiError
          ? err.detail
          : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: "assistant",
          text: `Error: ${detail}`,
          timestamp: currentTimeLabel(),
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleNewConversation() {
    setMessages([]);
    setInput("");
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Ignore storage errors.
      }
    }
    inputRef.current?.focus();
  }

  function handleExportTranscript() {
    if (messages.length === 0) return;
    const lines = messages.map(
      (m) => `[${m.timestamp}] ${m.sender === "user" ? username : "TalentAI"}:\n${m.text}\n`,
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    triggerBlobDownload(blob, "talentai_chat_transcript.txt");
  }

  async function handleOpenKb() {
    setShowKbModal(true);
    if (!token || (kbPolicies.length > 0 || kbFaqs.length > 0)) return;
    setLoadingKb(true);
    try {
      const data = await apiFetch<{ policies: PolicyOut[]; faqs: FaqOut[] }>(
        "/api/chat/kb",
        {},
        token,
      );
      setKbPolicies(data.policies);
      setKbFaqs(data.faqs);
    } catch {
      // Handled by empty state.
    } finally {
      setLoadingKb(false);
    }
  }

  async function handleOpenReviews() {
    setShowReviewsModal(true);
    if (!token) return;
    setLoadingReviews(true);
    try {
      const data = await apiFetch<PerformanceRecordOut[]>(
        "/api/performance/my-reviews",
        {},
        token,
      );
      setMyReviews(data);
    } catch {
      // Handled by empty state.
    } finally {
      setLoadingReviews(false);
    }
  }

  async function handleCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    } catch {
      // Ignore clipboard permission errors in restricted contexts.
    }
  }

  const recentUserPrompts = messages
    .filter((m) => m.sender === "user")
    .slice(-5)
    .reverse();

  const lastUserMessage = [...messages].reverse().find((m) => m.sender === "user");
  const lastAssistantId = [...messages].reverse().find((m) => m.sender === "assistant")?.id;

  const filteredKbPolicies = useMemo(() => {
    const q = kbSearch.trim().toLowerCase();
    if (!q) return kbPolicies;
    return kbPolicies.filter(
      (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q),
    );
  }, [kbPolicies, kbSearch]);

  const filteredKbFaqs = useMemo(() => {
    const q = kbSearch.trim().toLowerCase();
    if (!q) return kbFaqs;
    return kbFaqs.filter(
      (f) => f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q),
    );
  }, [kbFaqs, kbSearch]);

  return (
    <div className="h-[calc(100dvh-5.25rem)] md:h-[calc(100dvh-3rem)] flex overflow-hidden bg-background rounded-2xl border border-slate-200 shadow-sm">
      {/* Left Topics & Session History Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 hidden md:flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200">
          <button
            type="button"
            onClick={handleNewConversation}
            className="w-full px-4 py-3 bg-[#544af4] text-white rounded-xl hover:bg-[#4338ca] transition-colors flex items-center justify-center gap-2 font-medium text-sm cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 px-2">
              Quick Topics
            </h4>
            <div className="space-y-1.5">
              {QUICK_TOPICS.map((topic) => {
                const isSelected = activeTopic === topic.id;
                return (
                  <button
                    key={topic.id}
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      setActiveTopic(topic.id);
                      void sendMessage(topic.prompt);
                    }}
                    className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer disabled:opacity-60 ${
                      isSelected
                        ? "bg-[#f0efff] border border-indigo-200"
                        : "hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {topic.title}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {topic.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {recentUserPrompts.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5 px-2">
                Asked This Session
              </h4>
              <div className="space-y-1">
                {recentUserPrompts.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={sending}
                    onClick={() => setInput(item.text)}
                    className="w-full px-3 py-2 rounded-lg text-left text-xs text-slate-600 hover:bg-slate-50 truncate transition-colors cursor-pointer"
                    title={item.text}
                  >
                    {item.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
        {/* Chat Header */}
        <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base sm:text-lg text-slate-800 leading-tight truncate">
                AI HR Assistant
              </h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 font-medium mt-0.5">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                <span className="truncate">
                  Connected to your profile &amp; HR Knowledge Base
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => void handleOpenKb()}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#544af4]" />
              <span className="hidden sm:inline">Policies &amp; FAQs</span>
              <span className="sm:hidden">Policies</span>
            </button>

            <button
              type="button"
              onClick={() => void handleOpenReviews()}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
            >
              <Award className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">My Reviews</span>
              <span className="sm:hidden">Reviews</span>
            </button>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleExportTranscript}
                title="Export chat transcript (.txt)"
                aria-label="Export chat transcript"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleNewConversation}
              title="New Conversation"
              className="md:hidden inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#544af4] text-white rounded-lg hover:bg-[#4338ca] transition-colors text-xs font-medium shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* Live Employee Profile Metrics Strip */}
        {profile && (
          <div className="px-4 sm:px-6 py-2.5 bg-slate-50/90 border-b border-slate-200 grid grid-cols-2 lg:grid-cols-4 gap-2 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 min-w-0">
              <Building2 className="w-3.5 h-3.5 text-[#544af4] shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                  Department
                </p>
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {profile.department}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 min-w-0">
              <CalendarDays className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                  Leave Balance
                </p>
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {profile.leave_balance} days
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 min-w-0">
              <Activity className="w-3.5 h-3.5 text-[#1f48d9] shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                  Attendance
                </p>
                <p className="text-xs font-semibold text-slate-800 truncate">
                  {profile.attendance_score}/100
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200/80 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <DollarSign className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                    Salary
                  </p>
                  <p className="text-xs font-semibold text-slate-800 truncate">
                    {showSalary
                      ? `$${Number(profile.salary).toLocaleString()}`
                      : "••••••"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSalary((prev) => !prev)}
                aria-label={showSalary ? "Hide salary" : "Show salary"}
                title={showSalary ? "Hide salary" : "Show salary"}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                {showSalary ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-5">
          {/* Welcome Message */}
          <div className="flex gap-2.5 sm:gap-4 justify-start">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-2xl min-w-0 space-y-3">
              <div className="rounded-2xl px-4 py-3 sm:px-5 sm:py-4 bg-white border border-slate-200 shadow-sm">
                <p className="leading-relaxed text-sm text-slate-700">
                  Hello <strong className="text-slate-900">{username}</strong>!
                  I am your AI HR Assistant. I can answer questions about company
                  policies, FAQs, and your personal HR records (leave balance,
                  attendance score, and compensation). How can I help you today?
                </p>
              </div>

              {/* Quick-prompt chips */}
              <div className="flex sm:flex-wrap gap-2 overflow-x-auto pb-1 sm:pb-0">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => void sendMessage(prompt)}
                    className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:border-[#544af4] hover:text-[#544af4] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dynamic Conversation */}
          {messages.map((msg) =>
            msg.sender === "user" ? (
              <div key={msg.id} className="flex gap-2.5 sm:gap-4 justify-end">
                <div className="max-w-2xl min-w-0">
                  <div className="rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 bg-[#544af4] text-white shadow-sm">
                    <p className="whitespace-pre-wrap leading-relaxed text-sm break-words">
                      {msg.text}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 px-1 text-right">
                    {msg.timestamp}
                  </p>
                </div>
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-[#1f48d9] to-[#544af4] flex items-center justify-center shrink-0 text-sm font-medium text-white shadow-sm">
                  {userInitial}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-2.5 sm:gap-4 justify-start">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="max-w-2xl min-w-0">
                  <div className="rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 bg-white border border-slate-200 shadow-sm">
                    <FormattedMessage text={msg.text} />
                  </div>
                  <div className="flex items-center gap-3 mt-1 px-1">
                    <span className="text-xs text-slate-400">
                      {msg.timestamp}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopy(msg.id, msg.text)}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    {msg.id === lastAssistantId && lastUserMessage && !sending && (
                      <button
                        type="button"
                        onClick={() => void sendMessage(lastUserMessage.text)}
                        className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-[#544af4] transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Regenerate</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="flex gap-2.5 sm:gap-4 justify-start">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
              <div className="max-w-2xl">
                <div className="rounded-2xl px-4 py-3 sm:px-5 sm:py-3.5 bg-white border border-slate-200 opacity-80">
                  <p className="text-sm italic text-slate-500">Thinking...</p>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Form */}
        <div className="p-3 sm:p-4 border-t border-slate-200 bg-white shrink-0">
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2.5 sm:gap-3 max-w-4xl mx-auto"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder="Ask about policies, leave balance, or salary..."
              autoComplete="off"
              required
              className="flex-1 min-w-0 px-3.5 sm:px-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="p-2.5 sm:p-3 bg-[#544af4] text-white rounded-xl hover:bg-[#4338ca] transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Browse Policies & FAQs Modal */}
      {showKbModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowKbModal(false)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#544af4]" />
                <h3 className="text-base font-semibold text-slate-800">
                  Company Policies &amp; FAQs
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowKbModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={kbSearch}
                  onChange={(e) => setKbSearch(e.target.value)}
                  placeholder="Search policies or FAQs..."
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {loadingKb ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-[#544af4]" />
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Company Policies ({filteredKbPolicies.length})
                    </h4>
                    {filteredKbPolicies.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="font-semibold text-sm text-slate-800">
                            {p.title}
                          </h5>
                          <button
                            type="button"
                            onClick={() => {
                              setShowKbModal(false);
                              void sendMessage(`Tell me more about ${p.title}`);
                            }}
                            className="text-xs text-[#544af4] font-medium hover:underline cursor-pointer shrink-0"
                          >
                            Ask AI
                          </button>
                        </div>
                        <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                          {p.content}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      FAQs ({filteredKbFaqs.length})
                    </h4>
                    {filteredKbFaqs.map((f) => (
                      <div
                        key={f.id}
                        className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="font-semibold text-sm text-slate-800">
                            {f.question}
                          </h5>
                          <button
                            type="button"
                            onClick={() => {
                              setShowKbModal(false);
                              void sendMessage(f.question);
                            }}
                            className="text-xs text-[#544af4] font-medium hover:underline cursor-pointer shrink-0"
                          >
                            Ask AI
                          </button>
                        </div>
                        <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                          {f.answer}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* My Performance Reviews Modal */}
      {showReviewsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowReviewsModal(false)}
        >
          <div
            className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-semibold text-slate-800">
                  My Performance Reviews
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReviewsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {loadingReviews ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                </div>
              ) : myReviews.length === 0 ? (
                <div className="text-center py-10 text-sm text-slate-500">
                  No performance reviews have been published for your account
                  yet.
                </div>
              ) : (
                myReviews.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-5 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {rec.review_period}
                        </p>
                        <p className="text-xs text-slate-500">
                          Department: {rec.department}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                          Score: {rec.performance_score ?? "—"}/100
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-[#f0efff] text-[#544af4] border border-indigo-200 text-xs font-semibold">
                          KPI: {rec.kpi_achievement_percent ?? "—"}%
                        </span>
                      </div>
                    </div>
                    {rec.strengths && (
                      <div className="text-xs text-slate-600">
                        <strong className="text-emerald-700">Strengths: </strong>
                        {rec.strengths}
                      </div>
                    )}
                    {rec.areas_for_improvement && (
                      <div className="text-xs text-slate-600">
                        <strong className="text-amber-700">
                          Areas for Improvement:{" "}
                        </strong>
                        {rec.areas_for_improvement}
                      </div>
                    )}
                    {rec.recommended_actions && (
                      <div className="text-xs text-slate-600">
                        <strong className="text-[#544af4]">
                          Recommended Actions:{" "}
                        </strong>
                        {rec.recommended_actions}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Employee AI HR Support Chat page protected by Employee role guard. */
export default function EmployeeChatPage() {
  return (
    <AuthGuard requireRole="employee">
      <EmployeeChatContent />
    </AuthGuard>
  );
}
