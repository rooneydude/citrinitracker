import { NextResponse } from "next/server";
import {
  plaidClient,
  assertPlaidConfigured,
  mapPlaidHoldings,
} from "@/lib/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh holdings using an already-exchanged access_token. Called on
 * subsequent page loads / manual refresh without a re-link.
 */
export async function POST(request: Request) {
  const configError = assertPlaidConfigured();
  if (configError) {
    return NextResponse.json({ error: configError }, { status: 500 });
  }

  try {
    const { access_token } = await request.json();

    if (!access_token || typeof access_token !== "string") {
      return NextResponse.json(
        { error: "Missing access_token" },
        { status: 400 }
      );
    }

    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token,
    });

    const mapped = mapPlaidHoldings(
      holdingsResponse.data.accounts,
      holdingsResponse.data.holdings,
      holdingsResponse.data.securities
    );

    return NextResponse.json(mapped);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
