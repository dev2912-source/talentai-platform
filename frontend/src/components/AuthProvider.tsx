"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { ApiError, apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { UserProfileOut } from "@/lib/types";

export interface AuthContextValue {
  user: User | null;
  profile: UserProfileOut | null;
  token: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: (overrideToken?: string) => Promise<UserProfileOut | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Global authentication provider syncing Supabase session with FastAPI /api/auth/me. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfileOut | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const activeTokenRef = useRef<string | null>(null);
  const profileRef = useRef<UserProfileOut | null>(null);
  const inFlightFetchRef = useRef<{
    token: string;
    promise: Promise<UserProfileOut | null>;
  } | null>(null);

  const clearAuthState = useCallback(() => {
    activeTokenRef.current = null;
    profileRef.current = null;
    setUser(null);
    setToken(null);
    setProfile(null);
  }, []);

  const fetchProfileWithToken = useCallback(
    async (accessToken: string): Promise<UserProfileOut | null> => {
      if (inFlightFetchRef.current?.token === accessToken) {
        return await inFlightFetchRef.current.promise;
      }

      const promise = (async (): Promise<UserProfileOut | null> => {
        try {
          const me = await apiFetch<UserProfileOut>("/api/auth/me", {}, accessToken);
          if (activeTokenRef.current === accessToken) {
            profileRef.current = me;
            setProfile(me);
          }
          return me;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            clearAuthState();
            try {
              await supabase.auth.signOut();
            } catch {
              // Ignore signOut cleanup failures after clearing local auth state.
            }
          }
          return null;
        }
      })();

      inFlightFetchRef.current = { token: accessToken, promise };
      try {
        return await promise;
      } finally {
        if (inFlightFetchRef.current?.promise === promise) {
          inFlightFetchRef.current = null;
        }
      }
    },
    [clearAuthState],
  );

  const refreshProfile = useCallback(
    async (overrideToken?: string): Promise<UserProfileOut | null> => {
      const targetToken = overrideToken ?? activeTokenRef.current;
      if (!targetToken) {
        profileRef.current = null;
        setProfile(null);
        return null;
      }
      activeTokenRef.current = targetToken;
      setToken(targetToken);
      return await fetchProfileWithToken(targetToken);
    },
    [fetchProfileWithToken],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      clearAuthState();
    }
  }, [clearAuthState]);

  useEffect(() => {
    let mounted = true;

    async function bootstrapSession() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (session?.access_token) {
          activeTokenRef.current = session.access_token;
          setUser(session.user);
          setToken(session.access_token);
          await fetchProfileWithToken(session.access_token);
        } else {
          clearAuthState();
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;

      if (session?.access_token) {
        const nextToken = session.access_token;
        const tokenChanged = activeTokenRef.current !== nextToken;
        activeTokenRef.current = nextToken;
        setUser(session.user);
        setToken(nextToken);

        if (tokenChanged) {
          if (!profileRef.current) {
            setLoading(true);
          }
          await fetchProfileWithToken(nextToken);
          if (!mounted) return;
        }
      } else {
        clearAuthState();
      }

      if (mounted) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [clearAuthState, fetchProfileWithToken]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        token,
        loading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Read current TalentAI authentication state and helpers. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
