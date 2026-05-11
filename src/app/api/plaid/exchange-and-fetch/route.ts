import { NextResponse } from "next/server";
import {
  plaidClient,
  assertPlaidConfigured,
  mapPlaidHoldings,
} from "@/lib/plaid";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exchanges a Plaid public_token for an access_token, stores the
// access_token in Supabase keyed to the signed-in user, and returns
// only the mapped holdings. The access_token NEVER leaves the server.
export async function POST(request: Request) {
  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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

    const nowIso = new Date().toISOString();
    const { error: tokenError } = await supabase
      .from("plaid_tokens")
      .upsert(
        {
          user_id: userData.user.id,
          access_token: accessToken,
          item_id: itemId,
        },
        { onConflict: "user_id" }
      );

    if (tokenError) {
      return NextResponse.json(
        { error: `Failed to store Plaid token: ${tokenError.message}` },
        { status: 500 }
      );
    }

    await supabase
      .from("user_state")
      .upsert(
        { user_id: userData.user.id, plaid_last_refreshed_at: nowIso },
        { onConflict: "user_id" }
      );

    return NextResponse.json(mapped);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
