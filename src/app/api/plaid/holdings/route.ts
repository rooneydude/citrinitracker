import { NextResponse } from "next/server";
import {
  plaidClient,
  assertPlaidConfigured,
  mapPlaidHoldings,
} from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh holdings using the stored access_token. The token is read from
 * the `plaid_tokens` table (RLS-scoped to the authenticated user); it is
 * never sent over the wire or stored in the browser.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("plaid_tokens")
    .select("access_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (tokenErr) {
    return NextResponse.json(
      { error: `Failed to read Plaid token: ${tokenErr.message}` },
      { status: 500 }
    );
  }
  if (!tokenRow?.access_token) {
    return NextResponse.json({ connected: false }, { status: 200 });
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

    await supabase.from("user_state").upsert(
      {
        user_id: user.id,
        rh_holdings: mapped.holdings,
        portfolio_value: mapped.portfolioValue > 0 ? mapped.portfolioValue : null,
        plaid_last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    return NextResponse.json({ ...mapped, connected: true });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    // Common case: token revoked. Tell the client to forget the connection
    // so it shows "Connect" again instead of looping refresh attempts.
    const tokenDead = /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN|ITEM_NOT_FOUND/.test(
      message
    );
    if (tokenDead) {
      await supabase.from("plaid_tokens").delete().eq("user_id", user.id);
    }
    return NextResponse.json(
      { error: message, connected: !tokenDead },
      { status: 400 }
    );
  }
}
