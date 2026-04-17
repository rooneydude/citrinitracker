import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type AccountBase,
  type Holding,
  type Security,
} from "plaid";
import type { RobinhoodHolding } from "./types";

// Plaid removed the "development" environment in v41+, so we only support
// sandbox and production. Defaults to sandbox when PLAID_ENV is unset.
const envMap: Record<string, string> = {
  sandbox: PlaidEnvironments.sandbox,
  production: PlaidEnvironments.production,
};

const basePath =
  envMap[(process.env.PLAID_ENV ?? "sandbox").toLowerCase()] ??
  PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
      "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export function assertPlaidConfigured(): string | null {
  if (!process.env.PLAID_CLIENT_ID) return "PLAID_CLIENT_ID is not set";
  if (!process.env.PLAID_SECRET) return "PLAID_SECRET is not set";
  return null;
}

// Plaid account types that represent investable brokerage accounts.
const INVESTMENT_ACCOUNT_TYPES = new Set(["investment", "brokerage"]);

// Security types Robinhood can actually trade through this flow. Cash,
// mutual funds, fixed income, crypto, derivatives/options are excluded.
const TRADEABLE_SECURITY_TYPES = new Set(["equity", "etf"]);

// Real US equity/ETF tickers: 1–5 uppercase letters with an optional
// single-letter share-class suffix (e.g. BRK.B, BF.A). Rejects CUSIPs,
// option OCC codes, "U S Dollar", and other junk Plaid sometimes labels
// as equity in sandbox and real data alike.
const TICKER_PATTERN = /^[A-Z]{1,5}(\.[A-Z])?$/;

export interface MappedPlaidHoldings {
  holdings: RobinhoodHolding[];
  portfolioValue: number;
}

/**
 * Convert a Plaid `investmentsHoldingsGet` response into the
 * Robinhood-shaped holdings + portfolio value this app consumes.
 */
export function mapPlaidHoldings(
  accounts: AccountBase[],
  holdings: Holding[],
  securities: Security[]
): MappedPlaidHoldings {
  const securitiesMap = new Map(securities.map((s) => [s.security_id, s]));

  // Sum the value of investment/brokerage accounts. Prefer `current`, fall
  // back to `available` (some brokerages don't populate current for equities).
  const portfolioValue = accounts.reduce((sum, acct) => {
    if (!INVESTMENT_ACCOUNT_TYPES.has(acct.type)) return sum;
    const bal = acct.balances.current ?? acct.balances.available ?? 0;
    return sum + bal;
  }, 0);

  // Aggregate by ticker so a security appearing in multiple accounts
  // (IRA + 401k, etc.) collapses into one row.
  const byTicker = new Map<string, RobinhoodHolding>();

  for (const h of holdings) {
    const security = securitiesMap.get(h.security_id);
    if (!security) continue;
    if (!security.type || !TRADEABLE_SECURITY_TYPES.has(security.type)) continue;

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

  return {
    holdings: Array.from(byTicker.values()),
    portfolioValue,
  };
}
