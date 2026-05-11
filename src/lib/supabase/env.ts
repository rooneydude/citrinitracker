// Centralized so a missing env var fails loudly at boot rather than
// silently producing broken Supabase clients. Both values are safe to
// expose to the browser — the publishable key only grants the rights
// defined by RLS, never service-role access.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_PUBLISHABLE_KEY = required(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
);
