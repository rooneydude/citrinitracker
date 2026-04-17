import { NextResponse } from "next/server";
import { plaidClient, assertPlaidConfigured } from "@/lib/plaid";
import type { RobinhoodHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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

    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token: accessToken,
    });

    const { accounts, holdings, securities } = holdingsResponse.data;

    const securitiesMap = new Map(securities.map((s) => [s.security_id, s]));

    // Sum the value of investment accounts. Prefer `current`, fall back to
    // `available` (some brokerages don't populate current for equities).
    const portfolioValue = accounts.reduce((sum, acct) => {
      if (acct.type !== "investment") return sum;
      const bal = acct.balances.current ?? acct.balances.available ?? 0;
      return sum + bal;
    }, 0);

    const rhHoldings: RobinhoodHolding[] = holdings
      .map((h) => {
        const security = securitiesMap.get(h.security_id);
        if (!security) return null;

        const ticker =
          security.ticker_symbol?.toUpperCase() ?? security.name ?? "";
        if (!ticker || ticker === "CUR:USD") return null;

        const shares = h.quantity;
        const price = h.institution_price ?? security.close_price ?? 0;
        const value = h.institution_value ?? shares * price;

        return {
          ticker,
          shares,
          currentPrice: price,
          marketValue: value,
        } satisfies RobinhoodHolding;
      })
      .filter((h): h is RobinhoodHolding => h !== null && h.shares > 0);

    return NextResponse.json({ holdings: rhHoldings, portfolioValue });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
