import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return value;
}

export async function createAuthenticatedSupabaseClient() {
  const { getToken, isAuthenticated, userId } = await auth();

  if (!isAuthenticated || !userId) {
    throw new Error("Authentication is required to access Supabase.");
  }

  const token = await getToken();

  if (!token) {
    throw new Error("Clerk did not provide a Supabase session token.");
  }

  const supabaseUrl = requireEnvironmentVariable("SUPABASE_URL");
  const supabasePublishableKey = requireEnvironmentVariable(
    "SUPABASE_PUBLISHABLE_KEY",
  );
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    accessToken: async () => token,
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return { client, userId };
}
