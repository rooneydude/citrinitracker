import { describe, it, expect } from "vitest";
import { isAvailableOnRobinhood, rebalance } from "./rebalance";
import type { GroupHolding, RobinhoodHolding } from "./types";

// ---------- fixtures ----------

function makeGroup(overrides: Partial<GroupHolding> = {}): GroupHolding {
  return {
    ticker: "NVDA US",
    cleanTicker: "NVDA",
    name: "NVIDIA",
    allocation: 10,
    basket: "AI",
    lastPrice: 100,
    isLong: true,
    exchange: "XNGS",
    isin: "",
    isOption: false,
    ...overrides,
  };
}

function makeRh(overrides: Partial<RobinhoodHolding> = {}): RobinhoodHolding {
  return {
    ticker: "NVDA",
    shares: 10,
    currentPrice: 100,
    marketValue: 1000,
    ...overrides,
  };
}

// ---------- isAvailableOnRobinhood ----------

describe("isAvailableOnRobinhood", () => {
  it("rejects options regardless of exchange", () => {
    expect(
      isAvailableOnRobinhood(
        makeGroup({ isOption: true, exchange: "XNGS", ticker: "NVDA 7 C220 US" })
      )
    ).toBe(false);
  });

  it("rejects known non-Robinhood exchanges (Tokyo, London, etc.)", () => {
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XTKS" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XLON" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XHKG" }))).toBe(false);
  });

  it("accepts known Robinhood exchanges (NYSE, NASDAQ, etc.)", () => {
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XNYS" }))).toBe(true);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XNGS" }))).toBe(true);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "ARCX" }))).toBe(true);
  });

  it("falls back to ticker suffix heuristic when exchange is unknown", () => {
    // Foreign suffix -> reject
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "5801 JP Equity", cleanTicker: "5801", exchange: "" })
      )
    ).toBe(false);
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "GLEN LN Equity", cleanTicker: "GLEN", exchange: "" })
      )
    ).toBe(false);

    // US suffix (not in the foreign list) -> accept
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "NVDA US Equity", cleanTicker: "NVDA", exchange: "" })
      )
    ).toBe(true);
  });

  it("rejects numeric-only cleanTicker (foreign-exchange numeric codes)", () => {
    expect(
      isAvailableOnRobinhood(
        makeGroup({
          ticker: "5801",
          cleanTicker: "5801",
          exchange: "",
        })
      )
    ).toBe(false);
  });

  it("defaults to available when nothing matches", () => {
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "TIC", cleanTicker: "TIC", exchange: "" })
      )
    ).toBe(true);
  });
});

// ---------- rebalance ----------

describe("rebalance", () => {
  it("generates a BUY when a target has no current holding", () => {
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const result = rebalance(groups, [], 10_000, new Set());

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      ticker: "NVDA",
      action: "BUY",
      targetValue: 10_000,
      currentValue: 0,
      deltaValue: 10_000,
      deltaShares: 100,
    });
  });

  it("emits no trade when already balanced within $1", () => {
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [makeRh({ ticker: "NVDA", shares: 100, marketValue: 10_000 })];
    const result = rebalance(groups, rh, 10_000, new Set());
    expect(result.trades).toHaveLength(0);
  });

  it("emits SELL when over-held vs target", () => {
    // Two longs at 50% each so reweight factor stays 1.0 and targets map
    // cleanly to dollar values.
    const groups = [
      makeGroup({ cleanTicker: "NVDA", allocation: 50 }),
      makeGroup({ cleanTicker: "AAPL", allocation: 50, ticker: "AAPL US Equity" }),
    ];
    // 50% target of $10k = $5k, but we hold $8k of NVDA.
    const rh = [makeRh({ ticker: "NVDA", shares: 80, marketValue: 8_000 })];
    const result = rebalance(groups, rh, 10_000, new Set());

    const nvdaTrade = result.trades.find((t) => t.ticker === "NVDA");
    expect(nvdaTrade).toMatchObject({
      action: "SELL",
      targetValue: 5_000,
      currentValue: 8_000,
      deltaValue: -3_000,
    });
  });

  it("reweights remaining longs to 100% when some are excluded", () => {
    // Target: 40% NVDA (US), 60% GLEN (LN, not on RH).
    // After excluding GLEN, NVDA should scale up from 40% -> 100%.
    const groups = [
      makeGroup({ cleanTicker: "NVDA", allocation: 40, exchange: "XNGS" }),
      makeGroup({
        ticker: "GLEN LN Equity",
        cleanTicker: "GLEN",
        allocation: 60,
        exchange: "XLON",
      }),
    ];
    const result = rebalance(groups, [], 10_000, new Set());

    expect(result.reweightFactor).toBeCloseTo(100 / 40, 6);
    expect(result.excludedHoldings).toHaveLength(1);
    expect(result.excludedHoldings[0].cleanTicker).toBe("GLEN");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].targetWeight).toBeCloseTo(100, 6);
    expect(result.trades[0].targetValue).toBeCloseTo(10_000, 6);
  });

  it("honors manually-excluded tickers (by group ticker, not cleanTicker)", () => {
    // Two targets; user manually excludes NVDA by its *original* ticker.
    const groups = [
      makeGroup({
        ticker: "NVDA US Equity",
        cleanTicker: "NVDA",
        allocation: 50,
      }),
      makeGroup({
        ticker: "AAPL US Equity",
        cleanTicker: "AAPL",
        allocation: 50,
      }),
    ];
    const result = rebalance(
      groups,
      [],
      10_000,
      new Set(["NVDA US Equity"])
    );

    const tradedTickers = result.trades.map((t) => t.ticker);
    expect(tradedTickers).toContain("AAPL");
    expect(tradedTickers).not.toContain("NVDA");
    expect(result.excludedHoldings.map((h) => h.cleanTicker)).toContain("NVDA");
  });

  it("ignores short positions (isLong=false) when sizing longs", () => {
    const groups = [
      makeGroup({ cleanTicker: "NVDA", allocation: 50, isLong: true }),
      makeGroup({
        cleanTicker: "XYZ",
        allocation: -20,
        isLong: false,
        ticker: "XYZ US Equity",
      }),
    ];
    const result = rebalance(groups, [], 10_000, new Set());

    // totalLongAlloc is 50 (shorts excluded from reweight math).
    expect(result.reweightFactor).toBeCloseTo(100 / 50, 6);
    // Only NVDA generates a trade; XYZ short is dropped silently.
    expect(result.trades.map((t) => t.ticker)).toEqual(["NVDA"]);
  });

  it("flags current holdings not in the target as SELL to zero", () => {
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      makeRh({ ticker: "NVDA", shares: 100, marketValue: 10_000 }),
      // Stranded holding not in the target list:
      makeRh({
        ticker: "OLD",
        shares: 5,
        currentPrice: 40,
        marketValue: 200,
      }),
    ];
    const result = rebalance(groups, rh, 10_000, new Set());

    const oldTrade = result.trades.find((t) => t.ticker === "OLD");
    expect(oldTrade).toBeDefined();
    expect(oldTrade).toMatchObject({
      action: "SELL",
      targetValue: 0,
      currentValue: 200,
      deltaValue: -200,
      deltaShares: -5,
      basket: "Not in target",
    });
  });

  it("filters out micro-deltas under $1", () => {
    // Single 100% target of $10k; held $9999.5 -> $0.50 delta, should be
    // dropped. (Using 100% avoids the reweight factor kicking in.)
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      makeRh({ ticker: "NVDA", shares: 99.995, marketValue: 9_999.5 }),
    ];
    const result = rebalance(groups, rh, 10_000, new Set());
    expect(result.trades).toHaveLength(0);
  });

  it("sorts trades by |deltaValue| descending", () => {
    const groups = [
      makeGroup({ cleanTicker: "A", allocation: 10 }),
      makeGroup({ cleanTicker: "B", allocation: 50, ticker: "B US Equity" }),
      makeGroup({ cleanTicker: "C", allocation: 40, ticker: "C US Equity" }),
    ];
    const result = rebalance(groups, [], 100_000, new Set());

    const deltas = result.trades.map((t) => Math.abs(t.deltaValue));
    const sorted = [...deltas].sort((a, b) => b - a);
    expect(deltas).toEqual(sorted);
    expect(result.trades[0].ticker).toBe("B");
  });

  it("handles portfolio value of 0 without NaN", () => {
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const result = rebalance(groups, [], 0, new Set());

    // targetValue = 0, currentValue = 0 -> delta <= $1 threshold -> no trade.
    expect(result.trades).toHaveLength(0);
    expect(result.portfolioValue).toBe(0);
  });

  it("handles 100% excluded universe (no trades, factor=1)", () => {
    // All targets on a foreign exchange -> nothing available.
    const groups = [
      makeGroup({
        ticker: "GLEN LN Equity",
        cleanTicker: "GLEN",
        allocation: 100,
        exchange: "XLON",
      }),
    ];
    const result = rebalance(groups, [], 10_000, new Set());

    expect(result.trades).toHaveLength(0);
    expect(result.reweightFactor).toBe(1);
    expect(result.excludedHoldings).toHaveLength(1);
  });

  it("matches current Robinhood holdings case-insensitively", () => {
    const groups = [
      makeGroup({ cleanTicker: "nvda", allocation: 100 }), // lowercase in sheet
    ];
    const rh = [makeRh({ ticker: "NVDA", shares: 100, marketValue: 10_000 })];
    const result = rebalance(groups, rh, 10_000, new Set());
    // Already balanced -> 0 trades.
    expect(result.trades).toHaveLength(0);
  });
});
