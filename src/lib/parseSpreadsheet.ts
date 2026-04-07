import * as XLSX from "xlsx";
import { GroupHolding } from "./types";

interface RawRow {
  ticker: string | null;
  securityTicker: string | null;
  name: string | null;
  citrindexAllocation: number | null;
  basketAllocation: number | null;
  basketLevel: string | null;
  dollarAllocation: number | null;
  shareCount: number | null;
  lastPrice: number | null;
  costDate: string | null;
  costPrice: number | null;
  isin: string | null;
  micExchange: string | null;
}

function isOptionTicker(ticker: string, name: string): boolean {
  // Options have patterns like "NVDA 7 C220 US" or names like "July 26 Calls on..."
  const optionNamePattern = /(calls|puts|call|put) on/i;
  const optionTickerPattern = /\d+\s+[CP]\d+/;
  return optionNamePattern.test(name) || optionTickerPattern.test(ticker);
}

function cleanTicker(ticker: string): string {
  // "NVDA US" -> "NVDA", "5801 JP" -> "5801", "NOK US" -> "NOK"
  return ticker.replace(/\s+(US|JP|TT|FP|GR|LN|HK|AU|CN|KS|SP|IT|IM|SM|SS|NO|FH|DC|BB)$/i, "").trim();
}

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

    const col0 = row[0]; // Ticker (basket-level tickers or null for stock rows)
    const col1 = row[1]; // Security Ticker
    const col2 = row[2]; // Name
    const col3 = row[3]; // Citrindex Allocation
    const col5 = row[5]; // Basket Level

    // Detect basket header rows: col0 has a value, col5 has basket info string
    if (col0 !== null && col0 !== undefined) {
      const basketLevel = String(col5 || "");
      // Basket headers have long info strings with "Net:" or are single-ticker rows
      if (basketLevel.includes("Net:") || basketLevel.includes("Long:")) {
        currentBasket = String(col0);
        continue;
      }

      // Summary rows: "Net exposure", "Long exposure", "Short exposure", "Cash", "Gross exposure"
      const summaryLabels = ["Net exposure", "Long exposure", "Short exposure", "Cash", "Gross exposure"];
      if (summaryLabels.includes(String(col0))) {
        continue;
      }

      // Single-ticker basket rows (like TIC US, CWB US, NVDA options, SPXW options)
      // These have col0 = ticker, col1 = null, col2 = name
      if (col2 !== null && col2 !== undefined && col3 !== null && col3 !== undefined) {
        const ticker = String(col0);
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
        continue;
      }
    }

    // Stock rows within a basket: col0 is null, col1 has security ticker
    if ((col0 === null || col0 === undefined) && col1 !== null && col1 !== undefined) {
      const ticker = String(col1);
      const name = String(col2 || "");
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
