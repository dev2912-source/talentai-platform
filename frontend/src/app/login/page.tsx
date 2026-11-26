"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Info,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const DEMO_HR_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_HR_EMAIL || "admin@company.com";
const DEMO_HR_PASSWORD =
  process.env.NEXT_PUBLIC_DEMO_HR_PASSWORD || "admin123";
const DEMO_EMP_EMAIL =
  process.env.NEXT_PUBLIC_DEMO_EMP_EMAIL || "john@company.com";
const DEMO_EMP_PASSWORD =
  process.env.NEXT_PUBLIC_DEMO_EMP_PASSWORD || "pass123";

/** Login screen with email/password form and 1-click Demo HR / Employee sign-in. */
export default function LoginPage() {
  const router = useRouter();
  const { profile, loading, refreshProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState<"form" | "hr" | "emp" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && profile) {
      router.replace(profile.is_hr ? "/" : "/chat");
    }
  }, [loading, profile, router]);

  async function performSignIn(
    targetEmail: string,
    targetPassword: string,
    mode: "form" | "hr" | "emp",
  ) {
    setError(null);
    if (!isSupabaseConfigured()) {
      setError(
        "Supabase credentials are not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local.",
      );
      return;
    }

    setSubmitting(mode);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: targetEmail.trim(),
        password: targetPassword,
      });

      if (authError || !data.session?.access_token) {
        setError(authError?.message || "Invalid email or password.");
        return;
      }

      const me = await refreshProfile(data.session.access_token);
      if (!me) {
        setError(
          "Signed in, but could not load user profile from /api/auth/me. Check backend availability.",
        );
        return;
      }

      router.replace(me.is_hr ? "/" : "/chat");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to sign in right now.",
      );
    } finally {
      setSubmitting(null);
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void performSignIn(email, password, "form");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent/20 via-background to-background" />
      <div className="absolute top-1/4 -left-64 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 -right-64 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-chart-1 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-accent/20">
              <div
                className="w-6 h-6 bg-white rounded"
                style={{
                  clipPath:
                    "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                }}
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Enter your credentials to access TalentAI
            </p>
          </div>

          {/* Auth Tab Switcher */}
          <div className="flex bg-secondary/50 rounded-lg p-1 mb-6 border border-border">
            <Link
              href="/login"
              className="flex-1 text-center py-2 text-sm font-medium rounded-md bg-card text-foreground shadow shadow-black/10"
            >
              Login
            </Link>
            <Link
              href="/signup"
              className="flex-1 text-center py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign Up
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground block"
                htmlFor="login-email"
              >
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  id="login-email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm transition-all"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground block"
                htmlFor="login-password"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  id="login-password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-sm transition-all"
                  placeholder="Enter your password"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting !== null}
              className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:opacity-90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 mt-4 cursor-pointer disabled:opacity-60"
            >
              {submitting === "form" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* 1-Click Demo Logins */}
          <div className="mt-6 space-y-3">
            <div className="text-xs p-3 bg-accent/5 border border-accent/15 rounded-lg text-left text-muted-foreground space-y-1">
              <p className="font-semibold text-accent flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Demo Accounts (1-Click Login)
              </p>
              <p>
                HR: <span className="font-mono text-foreground">{DEMO_HR_EMAIL}</span>{" "}
                | <span className="font-mono text-foreground">{DEMO_HR_PASSWORD}</span>
              </p>
              <p>
                Employee:{" "}
                <span className="font-mono text-foreground">{DEMO_EMP_EMAIL}</span> |{" "}
                <span className="font-mono text-foreground">{DEMO_EMP_PASSWORD}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => {
                  setEmail(DEMO_HR_EMAIL);
                  setPassword(DEMO_HR_PASSWORD);
                  void performSignIn(DEMO_HR_EMAIL, DEMO_HR_PASSWORD, "hr");
                }}
                className="py-2 px-3 rounded-lg border border-border bg-secondary hover:bg-muted text-foreground text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                {submitting === "hr" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                )}
                Demo HR Login
              </button>

              <button
                type="button"
                disabled={submitting !== null}
                onClick={() => {
                  setEmail(DEMO_EMP_EMAIL);
                  setPassword(DEMO_EMP_PASSWORD);
                  void performSignIn(DEMO_EMP_EMAIL, DEMO_EMP_PASSWORD, "emp");
                }}
                className="py-2 px-3 rounded-lg border border-border bg-secondary hover:bg-muted text-foreground text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                {submitting === "emp" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : (
                  <User className="w-3.5 h-3.5 text-primary" />
                )}
                Demo Employee Login
              </button>
            </div>
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="text-accent font-medium hover:underline"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
