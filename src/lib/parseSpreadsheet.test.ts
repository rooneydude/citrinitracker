import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseGroupHoldings } from "./parseSpreadsheet";

// ---------- helpers ----------

/**
 * Builds an xlsx ArrayBuffer from a 2D array-of-arrays. The parser expects
 * at minimum:
 *   col 0  — Ticker (basket header / single-position ticker / summary label)
 *   col 1  — Security Ticker (for rows inside a basket)
 *   col 2  — Name
 *   col 3  — Citrindex Allocation
 *   col 5  — Basket Level metadata (contains "Net:" / "Long:" for basket headers)
 *   col 8  — Price
 *   col 11 — ISIN
 *   col 12 — Exchange
 * The first row is treated as a header and skipped by the parser.
 */
function buildXlsx(rows: unknown[][]): ArrayBuffer {
  const header = [
    "Ticker",
    "Security Ticker",
    "Name",
    "Citrindex Allocation",
    "_",
    "Basket Level",
    "_",
    "_",
    "Last Price",
    "_",
    "_",
    "ISIN",
    "MIC Primary Exchange",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Holdings");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

// Sparse row helper — positional args keep tests readable.
function basketHeader(name: string): unknown[] {
  // col 5 contains "Long:" which the parser uses to detect basket headers.
  return [name, "", "", "", "", "Long: 100% Short: 0%"];
}

function stockRow(
  ticker: string,
  name: string,
  allocation: number,
  opts: { price?: number; isin?: string; exchange?: string } = {}
): unknown[] {
  const row = new Array(13).fill("");
  row[1] = ticker;
  row[2] = name;
  row[3] = allocation;
  row[8] = opts.price ?? 0;
  row[11] = opts.isin ?? "";
  row[12] = opts.exchange ?? "";
  return row;
}

function singlePosition(
  ticker: string,
  name: string,
  allocation: number,
  opts: { price?: number; exchange?: string } = {}
): unknown[] {
  // Single-position rows have col 0 populated AND col 2/3 populated, but
  // NO "Net:" / "Long:" in col 5 (that's what distinguishes them from basket
  // headers).
  const row = new Array(13).fill("");
  row[0] = ticker;
  row[2] = name;
  row[3] = allocation;
  row[8] = opts.price ?? 0;
  row[12] = opts.exchange ?? "";
  return row;
}

function summaryRow(label: string): unknown[] {
  const row = new Array(13).fill("");
  row[0] = label;
  return row;
}

// ---------- tests ----------

describe("parseGroupHoldings", () => {
  it("parses a single basket with multiple stocks", () => {
    const buf = buildXlsx([
      basketHeader("AI Infrastructure"),
      stockRow("NVDA US Equity", "NVIDIA", 25, {
        price: 500,
        isin: "US67066G1040",
        exchange: "XNGS",
      }),
      stockRow("AMD US Equity", "Advanced Micro Devices", 15, {
        price: 120,
        exchange: "XNGS",
      }),
    ]);

    const holdings = parseGroupHoldings(buf);

    expect(holdings).toHaveLength(2);
    expect(holdings[0]).toMatchObject({
      ticker: "NVDA US Equity",
      cleanTicker: "NVDA",
      name: "NVIDIA",
      allocation: 25,
      basket: "AI Infrastructure",
      lastPrice: 500,
      isLong: true,
      exchange: "XNGS",
      isin: "US67066G1040",
      isOption: false,
    });
    expect(holdings[1].cleanTicker).toBe("AMD");
    expect(holdings[1].basket).toBe("AI Infrastructure");
  });

  it("tracks currentBasket across multiple basket headers", () => {
    const buf = buildXlsx([
      basketHeader("AI"),
      stockRow("NVDA US Equity", "NVIDIA", 10),
      basketHeader("Energy"),
      stockRow("XOM US Equity", "Exxon", 5),
      stockRow("CVX US Equity", "Chevron", 5),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings.map((h) => h.basket)).toEqual(["AI", "Energy", "Energy"]);
  });

  it("skips summary rows (Net exposure, Cash, Long/Short/Gross exposure)", () => {
    const buf = buildXlsx([
      basketHeader("AI"),
      stockRow("NVDA US Equity", "NVIDIA", 100),
      summaryRow("Net exposure"),
      summaryRow("Long exposure"),
      summaryRow("Short exposure"),
      summaryRow("Cash"),
      summaryRow("Gross exposure"),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].cleanTicker).toBe("NVDA");
  });

  it("skips 'Cash' placeholder rows inside a basket (col1 === 'Cash')", () => {
    const buf = buildXlsx([
      basketHeader("AI"),
      stockRow("NVDA US Equity", "NVIDIA", 50),
      stockRow("Cash", "", 0),
      stockRow("AMD US Equity", "AMD", 50),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings.map((h) => h.cleanTicker)).toEqual(["NVDA", "AMD"]);
  });

  it("cleans Bloomberg tickers to the first token", () => {
    const buf = buildXlsx([
      basketHeader("Mix"),
      stockRow("VRSN US Equity", "Verisign", 10),
      stockRow("5801 JP Equity", "Furukawa", 5),
      stockRow("GLEN LN Equity", "Glencore", 5),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings.map((h) => h.cleanTicker)).toEqual(["VRSN", "5801", "GLEN"]);
  });

  it("converts Bloomberg share-class slashes to dots (MOG/A -> MOG.A)", () => {
    const buf = buildXlsx([
      basketHeader("Defense"),
      stockRow("MOG/A US Equity", "Moog Class A", 10),
      stockRow("BRK/B US Equity", "Berkshire B", 10),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings[0].cleanTicker).toBe("MOG.A");
    expect(holdings[1].cleanTicker).toBe("BRK.B");
  });

  it("detects options by name pattern ('Calls on X')", () => {
    const buf = buildXlsx([
      basketHeader("Tactical"),
      stockRow("NVDA 7 C220 US", "July 26 Calls on NVIDIA", 5),
      stockRow("NVDA US Equity", "NVIDIA", 10),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings[0].isOption).toBe(true);
    expect(holdings[1].isOption).toBe(false);
  });

  it("detects options by ticker pattern (strike/expiry like '7 C220')", () => {
    const buf = buildXlsx([
      basketHeader("Tactical"),
      // Name doesn't contain "calls/puts on" but ticker shape does.
      stockRow("SPY 12 P450 US", "SPY Dec P450", 2),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings[0].isOption).toBe(true);
  });

  it("marks negative allocations as short (isLong=false)", () => {
    const buf = buildXlsx([
      basketHeader("LS Book"),
      stockRow("NVDA US Equity", "NVIDIA", 20),
      stockRow("TSLA US Equity", "Tesla", -10),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings[0].isLong).toBe(true);
    expect(holdings[1].isLong).toBe(false);
    expect(holdings[1].allocation).toBe(-10);
  });

  it("captures single-position standalone rows (col0 populated, no basket marker)", () => {
    const buf = buildXlsx([
      basketHeader("AI"),
      stockRow("NVDA US Equity", "NVIDIA", 50),
      singlePosition("TIC US Equity", "Tidewater", 5, {
        price: 42,
        exchange: "XNYS",
      }),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings).toHaveLength(2);
    const tic = holdings.find((h) => h.cleanTicker === "TIC");
    expect(tic).toBeDefined();
    expect(tic?.basket).toBe("Single Position");
    expect(tic?.lastPrice).toBe(42);
    expect(tic?.exchange).toBe("XNYS");
  });

  it("handles empty-string col0 the same as blank (rows inside a basket)", () => {
    // This is the regression guard for the previous bug: col0="" used to
    // route stock rows into the single-position branch with an empty ticker.
    const buf = buildXlsx([
      basketHeader("AI"),
      // Explicitly set col0 to "" (XLSX serializes these as empty strings,
      // not nulls, when the sheet came from Excel).
      (() => {
        const row = stockRow("NVDA US Equity", "NVIDIA", 100);
        row[0] = "";
        return row;
      })(),
    ]);

    const holdings = parseGroupHoldings(buf);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].ticker).toBe("NVDA US Equity");
    expect(holdings[0].cleanTicker).toBe("NVDA");
    expect(holdings[0].basket).toBe("AI");
  });

  it("returns an empty array for a sheet with only header + summary rows", () => {
    const buf = buildXlsx([summaryRow("Net exposure"), summaryRow("Cash")]);
    expect(parseGroupHoldings(buf)).toEqual([]);
  });
});
