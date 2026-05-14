import { NextResponse } from "next/server";
import {
  plaidClient,
  assertPlaidConfigured,
  mapPlaidHoldings,
} from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

  try {
    const { public_token } = await request.json();

    if (!public_token || typeof public_token !== "string") {
      return NextResponse.json(
        { error: "Missing public_token" },
        { status: 400 }
      );
    }

    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
      public_token,
    });
    const accessToken = exchangeResponse.data.access_token;
    const itemId = exchangeResponse.data.item_id;

    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token: accessToken,
    });

    const mapped = mapPlaidHoldings(
      holdingsResponse.data.accounts,
      holdingsResponse.data.holdings,
      holdingsResponse.data.securities
    );

    // Persist the access_token server-side — it never goes to the client.
    const { error: tokenErr } = await supabase
      .from("plaid_tokens")
      .upsert(
        {
          user_id: user.id,
          access_token: accessToken,
          item_id: itemId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (tokenErr) {
      return NextResponse.json(
        { error: `Failed to store Plaid token: ${tokenErr.message}` },
        { status: 500 }
      );
    }

    // Reflect the fresh holdings back into user_state so a reload sees them
    // even before the next Plaid refresh fires.
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
