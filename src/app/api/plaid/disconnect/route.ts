import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forget the user's Plaid connection. Deletes the access_token row and
// clears the last-refreshed timestamp. The client should also clear its
// local holdings UI state.
export async function POST() {
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const userId = userData.user.id;

  const { error: deleteError } = await supabase
    .from("plaid_tokens")
    .delete()
    .eq("user_id", userId);

  if (deleteError) {
    return NextResponse.json(
      { error: deleteError.message },
      { status: 500 }
    );
  }

  await supabase
    .from("user_state")
    .update({ plaid_last_refreshed_at: null, rh_holdings: [] })
    .eq("user_id", userId);

  return NextResponse.json({ ok: true });
}
