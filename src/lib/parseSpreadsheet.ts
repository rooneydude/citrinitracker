import * as XLSX from "xlsx";
import { GroupHolding } from "./types";

function isOptionTicker(ticker: string, name: string): boolean {
  // Natural-language name: "July 26 Calls on NVDA", "Puts on AAPL", etc.
  const optionNamePattern = /(calls|puts|call|put) on/i;
  // Bloomberg option ticker: "NVDA 7 C220 US" — space-separated C/P + strike.
  const optionBloombergPattern = /\d+\s+[CP]\d+/;
  // OCC option symbol: "NVDA240119C00500000" — no spaces, date + C/P + strike
  // padded to 8 digits. Matches underlying + 6-digit YYMMDD + C|P + 8 digits.
  const optionOccPattern = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;
  return (
    optionNamePattern.test(name) ||
    optionBloombergPattern.test(ticker) ||
    optionOccPattern.test(ticker.trim())
  );
}

function cleanTicker(ticker: string): string {
  // Bloomberg format is "SYMBOL EXCHANGE CLASS" (e.g. "VRSN US Equity",
  // "5801 JP Equity", "MOG/A US Equity"). We want just SYMBOL.
  const trimmed = ticker.trim();
  const firstSpace = trimmed.indexOf(" ");
  const symbol = firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed;
  // Normalize share-class separators to ".". Bloomberg uses "/", some CSV
  // sources use "-", Robinhood/Plaid use ".". e.g. MOG/A, BRK-B -> MOG.A, BRK.B.
  return symbol.replace(/[/-]/g, ".");
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

const SUMMARY_LABELS = new Set([
  "Net exposure",
  "Long exposure",
  "Short exposure",
  "Cash",
  "Gross exposure",
]);

export function parseGroupHoldings(buffer: ArrayBuffer): GroupHolding[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const holdings: GroupHolding[] = [];
  let currentBasket = "";

  // Skip header row (index 0)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const col0 = row[0]; // Ticker (basket name / single-position ticker / summary label)
    const col1 = row[1]; // Security Ticker (for rows inside a basket)
    const col2 = row[2]; // Name
    const col3 = row[3]; // Citrindex Allocation
    const col5 = row[5]; // Basket Level metadata

    // Case 1: col0 has content — it's either a summary row, a basket header,
    // or a single-ticker standalone position.
    if (!isBlank(col0)) {
      const col0Str = String(col0);

      if (SUMMARY_LABELS.has(col0Str)) continue;

      const basketLevel = String(col5 || "");
      if (basketLevel.includes("Net:") || basketLevel.includes("Long:")) {
        currentBasket = col0Str;
        continue;
      }

      // Single-ticker standalone position (e.g. "TIC US Equity" at the bottom)
      if (!isBlank(col2) && !isBlank(col3)) {
        const ticker = col0Str;
        const name = String(col2);
        const allocation = Number(col3);
        const price = Number(row[8]) || 0;
        const isin = row[11] ? String(row[11]) : "";
        const exchange = row[12] ? String(row[12]) : "";

        holdings.push({
          ticker,
          cleanTicker: cleanTicker(ticker),
          name,
          allocation,
          basket: "Single Position",
          lastPrice: price,
          isLong: allocation > 0,
          exchange,
          isin,
          isOption: isOptionTicker(ticker, name),
        });
      }
      continue;
    }

    // Case 2: col0 is blank — it's a stock row inside the most recent basket.
    // Skip "Cash" placeholder rows (col1 === "Cash") since they aren't holdings.
    if (!isBlank(col1) && String(col1).trim() !== "Cash") {
      const ticker = String(col1);
      const name = isBlank(col2) ? "" : String(col2);
      const allocation = Number(col3) || 0;
      const price = Number(row[8]) || 0;
      const isin = row[11] ? String(row[11]) : "";
      const exchange = row[12] ? String(row[12]) : "";

      holdings.push({
        ticker,
        cleanTicker: cleanTicker(ticker),
        name,
        allocation,
        basket: currentBasket,
        lastPrice: price,
        isLong: allocation > 0,
        exchange,
        isin,
        isOption: isOptionTicker(ticker, name),
      });
    }
  }

  return holdings;
}
