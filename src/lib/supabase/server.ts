import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./env";

// Server-side Supabase client. Reads the user's auth cookie so every
// query runs with their JWT — RLS policies on user_state and plaid_tokens
// enforce row-level isolation, so a logged-in user can only ever see/write
// their own rows regardless of how the query is written.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Calling set() from a Server Component throws — that's fine,
          // the proxy refreshes the session on the next request.
        }
      },
    },
  });
}
