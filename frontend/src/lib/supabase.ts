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

/** Lazy singleton Supabase client that remains safe during build-time prerendering. */
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

export const supabase: SupabaseClient = getSupabaseClient();
