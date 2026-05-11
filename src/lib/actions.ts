"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { GroupHolding, RobinhoodHolding } from "@/lib/types";

// Server Actions for syncing app state to Supabase. Each action verifies
// auth and writes only the current user's row. RLS enforces this even
// if a caller tried to spoof a user_id — but we still set it explicitly
// from auth.getUser() so the row key matches.

async function authedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

async function upsert(
  patch: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: "Not signed in." };

  const { error: upsertError } = await supabase
    .from("user_state")
    .upsert({ user_id: data.user.id, ...patch }, { onConflict: "user_id" });

  if (upsertError) return { ok: false, error: upsertError.message };

  // Revalidate the home route so a server-rendered hydration on the next
  // request sees the new state.
  revalidatePath("/");
  return { ok: true };
}

export async function saveGroupHoldings(
  holdings: GroupHolding[]
): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(holdings)) return { ok: false, error: "Invalid payload." };
  return upsert({
    group_holdings: holdings,
    group_holdings_parsed_at: new Date().toISOString(),
  });
}

export async function clearGroupHoldings(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const userId = await authedUserId();
  if (!userId) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_state")
    .update({
      group_holdings: [],
      group_holdings_parsed_at: null,
      excluded: [],
      force_included: [],
      portfolio_value: null,
      rh_holdings: [],
    })
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function saveExcluded(
  excluded: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(excluded)) return { ok: false, error: "Invalid payload." };
  return upsert({ excluded });
}

export async function saveForceIncluded(
  forceIncluded: string[]
): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(forceIncluded))
    return { ok: false, error: "Invalid payload." };
  return upsert({ force_included: forceIncluded });
}

export async function savePortfolioValue(
  value: string
): Promise<{ ok: boolean; error?: string }> {
  const n = parseFloat(value);
  const portfolio_value = Number.isFinite(n) && n > 0 ? n : null;
  return upsert({ portfolio_value });
}

export async function saveRhHoldings(
  rhHoldings: RobinhoodHolding[]
): Promise<{ ok: boolean; error?: string }> {
  if (!Array.isArray(rhHoldings))
    return { ok: false, error: "Invalid payload." };
  return upsert({ rh_holdings: rhHoldings });
}
