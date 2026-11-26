"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface AuthGuardProps {
  children: ReactNode;
  requireRole?: "hr" | "employee";
}

/** Route guard enforcing Supabase authentication and optional HR/Employee role access. */
export function AuthGuard({ children, requireRole }: AuthGuardProps) {
  const router = useRouter();
  const { user, profile, token, loading, refreshProfile, signOut } = useAuth();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user || !token) {
      router.replace("/login");
      return;
    }

    if (profile && requireRole === "hr" && !profile.is_hr) {
      router.replace("/chat");
      return;
    }

    if (profile && requireRole === "employee" && profile.is_hr) {
      router.replace("/");
    }
  }, [loading, profile, requireRole, router, token, user]);

  if (loading || !user || !token) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium">Loading TalentAI workspace...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-lg text-center space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            Unable to load your profile
          </h2>
          <p className="text-sm text-muted-foreground">
            Please verify the backend API is running and try again.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                try {
                  await refreshProfile();
                } finally {
                  setRetrying(false);
                }
              }}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${retrying ? "animate-spin" : ""}`} />
              Retry
            </button>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (requireRole === "hr" && !profile.is_hr) {
    return null;
  }
  if (requireRole === "employee" && profile.is_hr) {
    return null;
  }

  return <>{children}</>;
}
