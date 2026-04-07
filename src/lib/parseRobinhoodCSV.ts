import { RobinhoodHolding } from "./types";

/**
 * Parse Robinhood CSV export.
 * Supports the standard Robinhood export format with columns:
 * Instrument, Quantity, Average Cost, Current Price, Total Return, Equity, ...
 *
 * Also supports a simple 2-column format: Ticker, Shares
 * (prices will use 0 and need to be filled from group data)
 */
export function parseRobinhoodCSV(csvText: string): RobinhoodHolding[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const holdings: RobinhoodHolding[] = [];

  // Detect format from header
  if (header.includes("instrument") || header.includes("symbol")) {
    // Standard Robinhood format
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const tickerIdx =
      headers.indexOf("instrument") !== -1
        ? headers.indexOf("instrument")
        : headers.indexOf("symbol");
    const qtyIdx =
      headers.indexOf("quantity") !== -1
        ? headers.indexOf("quantity")
        : headers.indexOf("shares");
    const priceIdx =
      headers.indexOf("current price") !== -1
        ? headers.indexOf("current price")
        : headers.indexOf("last price");
    const equityIdx =
      headers.indexOf("equity") !== -1
        ? headers.indexOf("equity")
        : headers.indexOf("market value");

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/['"$]/g, ""));
      if (cols.length < 2) continue;

      const ticker = cols[tickerIdx]?.toUpperCase();
      if (!ticker) continue;

      const shares = parseFloat(cols[qtyIdx]) || 0;
      const price = priceIdx >= 0 ? parseFloat(cols[priceIdx]) || 0 : 0;
      const equity = equityIdx >= 0 ? parseFloat(cols[equityIdx]) || 0 : shares * price;

      if (shares > 0) {
        holdings.push({
          ticker,
          shares,
          currentPrice: price,
          marketValue: equity > 0 ? equity : shares * price,
        });
      }
    }
  } else {
    // Simple format: each line is "TICKER, SHARES" or "TICKER SHARES"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip if it looks like a header
      if (/^[a-z]/i.test(line) && line.includes("ticker")) continue;

      const parts = line.split(/[,\t]+/).map((p) => p.trim());
      if (parts.length >= 2) {
        const ticker = parts[0].toUpperCase().replace(/['"]/g, "");
        const shares = parseFloat(parts[1]);
        if (ticker && !isNaN(shares) && shares > 0) {
          holdings.push({
            ticker,
            shares,
            currentPrice: 0,
            marketValue: 0,
          });
        }
      }
    }
  }

  return holdings;
}
