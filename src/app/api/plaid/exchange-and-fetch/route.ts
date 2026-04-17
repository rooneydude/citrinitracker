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

    // Plaid uses both "investment" and "brokerage" account types; accept both.
    const INVESTMENT_TYPES = new Set(["investment", "brokerage"]);

    // Sum the value of investment/brokerage accounts. Prefer `current`, fall
    // back to `available` (some brokerages don't populate current for equities).
    const portfolioValue = accounts.reduce((sum, acct) => {
      if (!INVESTMENT_TYPES.has(acct.type)) return sum;
      const bal = acct.balances.current ?? acct.balances.available ?? 0;
      return sum + bal;
    }, 0);

    // Only keep security types Robinhood can actually trade through this flow.
    // Mutual funds, fixed income, cash, crypto, options/derivatives, and
    // untyped holdings (CUSIPs without a ticker) are intentionally excluded.
    const TRADEABLE_TYPES = new Set(["equity", "etf"]);

    // Real US equity/ETF tickers are 1–5 uppercase letters with an optional
    // single-letter share-class suffix (e.g. BRK.B, BF.A). This rejects
    // CUSIPs, option OCC codes, "U S Dollar", and other junk that Plaid
    // sometimes classifies as equity in sandbox and real data alike.
    const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z])?$/;

    // Aggregate by ticker so a security appearing in multiple accounts collapses
    // into a single row (and avoids duplicate React keys).
    const byTicker = new Map<string, RobinhoodHolding>();

    for (const h of holdings) {
      const security = securitiesMap.get(h.security_id);
      if (!security) continue;
      if (!security.type || !TRADEABLE_TYPES.has(security.type)) continue;

      const ticker = security.ticker_symbol?.toUpperCase();
      if (!ticker || !TICKER_PATTERN.test(ticker)) continue;
      if (h.quantity <= 0) continue;

      const price = h.institution_price ?? security.close_price ?? 0;
      const value = h.institution_value ?? h.quantity * price;

      const existing = byTicker.get(ticker);
      if (existing) {
        existing.shares += h.quantity;
        existing.marketValue += value;
        // Keep the weighted-average price consistent with shares/value.
        existing.currentPrice =
          existing.shares > 0 ? existing.marketValue / existing.shares : price;
      } else {
        byTicker.set(ticker, {
          ticker,
          shares: h.quantity,
          currentPrice: price,
          marketValue: value,
        });
      }
    }

    const rhHoldings: RobinhoodHolding[] = Array.from(byTicker.values());

    return NextResponse.json({ holdings: rhHoldings, portfolioValue });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch holdings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
