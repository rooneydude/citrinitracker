import { NextResponse } from "next/server";
import {
  plaidClient,
  assertPlaidConfigured,
  mapPlaidHoldings,
} from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Refresh holdings using the stored access_token. Token is read from
// Supabase under the current user's RLS context, never sent by the client.
export async function POST() {
  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from("plaid_tokens")
    .select("access_token")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (tokenError) {
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }
  if (!tokenRow?.access_token) {
    return NextResponse.json(
      { error: "Plaid not connected" },
      { status: 400 }
    );
  }

  try {
    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token: tokenRow.access_token,
    });

    const mapped = mapPlaidHoldings(
      holdingsResponse.data.accounts,
      holdingsResponse.data.holdings,
      holdingsResponse.data.securities
    );

    await supabase
      .from("user_state")
      .upsert(
        {
          user_id: userData.user.id,
          plaid_last_refreshed_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    return NextResponse.json(mapped);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    // If Plaid says the token is dead (ITEM_LOGIN_REQUIRED etc.), drop
    // the row so the client UI falls back to Connect.
    const isItemError =
      message.includes("ITEM_LOGIN_REQUIRED") ||
      message.includes("INVALID_ACCESS_TOKEN") ||
      message.includes("INVALID_API_KEYS");
    if (isItemError) {
      await supabase
        .from("plaid_tokens")
        .delete()
        .eq("user_id", userData.user.id);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
