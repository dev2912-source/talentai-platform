"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Plus, Send, Sparkles } from "lucide-react";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/components/AuthProvider";
import { ApiError, apiFetch } from "@/lib/api";
import type { ChatResponse } from "@/lib/types";

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
}

const RECENT_TOPICS = [
  {
    id: "policies",
    title: "Company Policies",
    time: "Just now",
    prompt: "What are the key company policies I should know about?",
  },
  {
    id: "leave",
    title: "Leave Balance Inquiry",
    time: "Yesterday",
    prompt: "What is my current leave balance?",
  },
  {
    id: "salary",
    title: "Salary Details",
    time: "3 days ago",
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

function EmployeeChatContent() {
  const { profile, token } = useAuth();
  const username = profile?.username || "Employee";
  const userInitial = username.trim().charAt(0).toUpperCase() || "E";

  const [activeTopic, setActiveTopic] = useState<string>("policies");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    sendMessage(input);
  }

  function handleNewConversation() {
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  }

  return (
    <div className="h-[calc(100vh-3rem)] flex overflow-hidden bg-background rounded-2xl border border-slate-200 shadow-sm">
      {/* Left Recent Chats Sidebar */}
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

        <div className="flex-1 overflow-auto p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 px-2">
            Recent Chats
          </h4>
          <div className="space-y-1.5">
            {RECENT_TOPICS.map((topic) => {
              const isSelected = activeTopic === topic.id;
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => {
                    setActiveTopic(topic.id);
                    setInput(topic.prompt);
                    inputRef.current?.focus();
                  }}
                  className={`w-full px-3 py-3 rounded-xl text-left transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#f0efff] border border-indigo-200"
                      : "hover:bg-slate-50 border border-transparent"
                  }`}
                >
                  <p className="text-sm font-medium text-slate-800 truncate mb-0.5">
                    {topic.title}
                  </p>
                  <p className="text-xs text-slate-400">{topic.time}</p>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]">
        {/* Chat Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-lg text-slate-800 leading-tight">
              AI HR Assistant
            </h3>
            <p className="text-xs text-slate-500 flex items-center gap-1.5 font-medium mt-0.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Online and ready to help
            </p>
          </div>
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Welcome Message */}
          <div className="flex gap-4 justify-start">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="max-w-2xl space-y-3">
              <div className="rounded-2xl px-5 py-4 bg-white border border-slate-200 shadow-sm">
                <p className="whitespace-pre-wrap leading-relaxed text-sm text-slate-700">
                  Hello <strong>{username}</strong>! I am your AI HR Assistant.
                  I can help you with company policies, FAQs, and your personal
                  data (like salary and leave balance). How can I help you
                  today?
                </p>
              </div>

              {/* Quick-prompt chips */}
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => sendMessage(prompt)}
                    className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:border-[#544af4] hover:text-[#544af4] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <p className="text-xs text-slate-400 px-1">Just now</p>
            </div>
          </div>

          {/* Dynamic Conversation */}
          {messages.map((msg) =>
            msg.sender === "user" ? (
              <div key={msg.id} className="flex gap-4 justify-end">
                <div className="max-w-2xl">
                  <div className="rounded-2xl px-5 py-3.5 bg-[#544af4] text-white shadow-sm">
                    <p className="whitespace-pre-wrap leading-relaxed text-sm">
                      {msg.text}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 px-1 text-right">
                    {msg.timestamp}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#1f48d9] to-[#544af4] flex items-center justify-center shrink-0 text-sm font-medium text-white shadow-sm">
                  {userInitial}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex gap-4 justify-start">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="max-w-2xl">
                  <div className="rounded-2xl px-5 py-3.5 bg-white border border-slate-200 shadow-sm">
                    <p className="whitespace-pre-wrap leading-relaxed text-sm text-slate-700">
                      {msg.text}
                    </p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 px-1">
                    {msg.timestamp}
                  </p>
                </div>
              </div>
            ),
          )}

          {sending && (
            <div className="flex gap-4 justify-start">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#544af4] to-[#1f48d9] flex items-center justify-center shrink-0 shadow-sm">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
              <div className="max-w-2xl">
                <div className="rounded-2xl px-5 py-3.5 bg-white border border-slate-200 opacity-80">
                  <p className="text-sm italic text-slate-500">
                    Agent is typing...
                  </p>
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Form */}
        <div className="p-4 sm:p-5 border-t border-slate-200 bg-white shrink-0">
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-3 max-w-4xl mx-auto"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder="Ask me anything about HR, your data, or company policies..."
              autoComplete="off"
              required
              className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all text-sm disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="p-3 bg-[#544af4] text-white rounded-xl hover:bg-[#4338ca] transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-2.5 text-center">
            AI-powered responses may take a moment. Please do not share highly
            sensitive passwords.
          </p>
        </div>
      </div>
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
