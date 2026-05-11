// Lazy env access so the module graph can be imported during build
// without these vars set. Calls fail loudly at request time if they're
// still missing on the deployed instance.
//
// Both values are safe to expose to the browser — the publishable key
// only grants what RLS allows, never service-role access.
export function getSupabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  return { url, key };
}
