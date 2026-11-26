import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://placeholder.supabase.co";
const FALLBACK_ANON_KEY = "placeholder-anon-key";

let client: SupabaseClient | null = null;

/** Return true when real Supabase public credentials are configured. */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url &&
      key &&
      url !== FALLBACK_URL &&
      !url.includes("your-project.supabase.co") &&
      key !== FALLBACK_ANON_KEY &&
      key !== "your-supabase-anon-key",
  );
}

/**
 * Return the singleton Supabase browser client, falling back to harmless
 * placeholder credentials when public env vars are absent during `next build`.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

/** Shared singleton Supabase client instance initialized with build-safe defaults. */
export const supabase: SupabaseClient = getSupabaseClient();
