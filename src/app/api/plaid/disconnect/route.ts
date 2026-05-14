import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { error } = await supabase
    .from("plaid_tokens")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: `Failed to disconnect: ${error.message}` },
      { status: 500 }
    );
  }

  // Also wipe holdings + last-refresh timestamp from user_state so the UI
  // doesn't keep showing stale Robinhood positions after a disconnect.
  await supabase
    .from("user_state")
    .update({
      rh_holdings: [],
      plaid_last_refreshed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  return NextResponse.json({ connected: false });
}
