import { describe, it, expect } from "vitest";
import { isAvailableOnRobinhood, rebalance, tradeThreshold } from "./rebalance";
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

  it("rejects recently-added MIC codes (Swiss, Toronto, Tel Aviv, Mexico, Brazil)", () => {
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XSWX" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XTSE" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XTAE" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XMEX" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XBSP" }))).toBe(false);
    expect(isAvailableOnRobinhood(makeGroup({ exchange: "XJSE" }))).toBe(false);
  });

  it("rejects extended Bloomberg country suffixes (SW, CT, SJ, BZ, CH)", () => {
    // Swiss
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "NESN SW Equity", cleanTicker: "NESN", exchange: "" })
      )
    ).toBe(false);
    // Canada (Toronto)
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "SHOP CT Equity", cleanTicker: "SHOP", exchange: "" })
      )
    ).toBe(false);
    // South Africa
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "NPN SJ Equity", cleanTicker: "NPN", exchange: "" })
      )
    ).toBe(false);
    // Brazil
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "PETR4 BZ Equity", cleanTicker: "PETR4", exchange: "" })
      )
    ).toBe(false);
    // China (ambiguous with Switzerland 'CH' but it's the Bloomberg code for China)
    expect(
      isAvailableOnRobinhood(
        makeGroup({ ticker: "600519 CH Equity", cleanTicker: "600519", exchange: "" })
      )
    ).toBe(false);
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

  it("honors manually-excluded tickers keyed by cleanTicker (uppercase)", () => {
    // Two targets; user manually excludes NVDA by its cleanTicker.
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
    const result = rebalance(groups, [], 10_000, new Set(["NVDA"]));

    const tradedTickers = result.trades.map((t) => t.ticker);
    expect(tradedTickers).toContain("AAPL");
    expect(tradedTickers).not.toContain("NVDA");
    expect(result.excludedHoldings.map((h) => h.cleanTicker)).toContain("NVDA");
  });

  it("excludes same cleanTicker even if it appears in multiple baskets", () => {
    // NVDA shows up in two baskets with slightly different Bloomberg strings.
    // One manual exclusion (by cleanTicker) should kill both.
    const groups = [
      makeGroup({
        ticker: "NVDA US Equity",
        cleanTicker: "NVDA",
        basket: "AI",
        allocation: 25,
      }),
      makeGroup({
        ticker: "NVDA",
        cleanTicker: "NVDA",
        basket: "Semis",
        allocation: 25,
      }),
      makeGroup({
        ticker: "AAPL US Equity",
        cleanTicker: "AAPL",
        allocation: 50,
      }),
    ];
    const result = rebalance(groups, [], 10_000, new Set(["NVDA"]));
    expect(result.trades.map((t) => t.ticker)).toEqual(["AAPL"]);
    // Both NVDA rows end up in excludedHoldings.
    expect(
      result.excludedHoldings.filter((h) => h.cleanTicker === "NVDA")
    ).toHaveLength(2);
  });

  it("force-include overrides auto-exclusion (e.g. misclassified foreign heuristic)", () => {
    // GLEN would normally be auto-excluded by exchange=XLON. Force-include it.
    const groups = [
      makeGroup({ cleanTicker: "NVDA", allocation: 50, exchange: "XNGS" }),
      makeGroup({
        ticker: "GLEN LN Equity",
        cleanTicker: "GLEN",
        allocation: 50,
        exchange: "XLON",
      }),
    ];
    const result = rebalance(
      groups,
      [],
      10_000,
      new Set(),
      new Set(["GLEN"])
    );
    // Both are now in the universe; reweight factor should be 1.
    expect(result.reweightFactor).toBeCloseTo(1, 6);
    expect(result.excludedHoldings).toHaveLength(0);
    expect(result.trades.map((t) => t.ticker).sort()).toEqual(["GLEN", "NVDA"]);
  });

  it("manual exclusion wins over force-include when both are set", () => {
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const result = rebalance(
      groups,
      [],
      10_000,
      new Set(["NVDA"]),
      new Set(["NVDA"])
    );
    expect(result.trades).toHaveLength(0);
    expect(result.excludedHoldings).toHaveLength(1);
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

  it("filters out micro-deltas under $1 on a $10k portfolio (floor)", () => {
    // Single 100% target of $10k; held $9999.5 -> $0.50 delta, should be
    // dropped. (Using 100% avoids the reweight factor kicking in.)
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      makeRh({ ticker: "NVDA", shares: 99.995, marketValue: 9_999.5 }),
    ];
    const result = rebalance(groups, rh, 10_000, new Set());
    expect(result.trades).toHaveLength(0);
  });

  it("scales the trade threshold with portfolio size (1 bp)", () => {
    // On a $1M portfolio, 1 bp is $100, so a $50 delta is noise.
    // (One 100% target so reweight factor is 1.)
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      // Held $999,950 vs target $1,000,000 -> $50 delta, below $100 threshold.
      makeRh({ ticker: "NVDA", shares: 9_999.5, marketValue: 999_950 }),
    ];
    const result = rebalance(groups, rh, 1_000_000, new Set());
    expect(result.trades).toHaveLength(0);
  });

  it("emits a trade when delta exceeds the bps-scaled threshold", () => {
    // Same setup, but $200 delta on a $1M portfolio -> 2 bps, above threshold.
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      makeRh({ ticker: "NVDA", shares: 9_998, marketValue: 999_800 }),
    ];
    const result = rebalance(groups, rh, 1_000_000, new Set());
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ ticker: "NVDA", action: "BUY" });
  });

  it("applies the same threshold to stranded (not-in-target) SELLs", () => {
    // On a $1M portfolio, a $50 stranded holding should not generate a SELL
    // (below the $100 / 1 bp threshold). A $200 one should.
    const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
    const rh = [
      makeRh({ ticker: "NVDA", shares: 10_000, marketValue: 1_000_000 }),
      makeRh({ ticker: "DUST", shares: 1, currentPrice: 50, marketValue: 50 }),
      makeRh({ ticker: "OLD", shares: 1, currentPrice: 200, marketValue: 200 }),
    ];
    const result = rebalance(groups, rh, 1_000_000, new Set());
    const tickers = result.trades.map((t) => t.ticker);
    expect(tickers).not.toContain("DUST");
    expect(tickers).toContain("OLD");
  });

  it("tradeThreshold returns $1 floor for small portfolios", () => {
    expect(tradeThreshold(0)).toBe(1);
    expect(tradeThreshold(5_000)).toBe(1);
    expect(tradeThreshold(10_000)).toBe(1);
  });

  it("tradeThreshold scales at 1 bp above the floor", () => {
    expect(tradeThreshold(100_000)).toBeCloseTo(10, 6);
    expect(tradeThreshold(1_000_000)).toBeCloseTo(100, 6);
    expect(tradeThreshold(10_000_000)).toBeCloseTo(1_000, 6);
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

  describe("basket summaries", () => {
    it("aggregates target weights and values per basket", () => {
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 25, basket: "AI" }),
        makeGroup({
          cleanTicker: "AMD",
          allocation: 25,
          basket: "AI",
          ticker: "AMD US Equity",
        }),
        makeGroup({
          cleanTicker: "XOM",
          allocation: 50,
          basket: "Energy",
          ticker: "XOM US Equity",
        }),
      ];
      const result = rebalance(groups, [], 10_000, new Set());
      const ai = result.basketSummaries.find((b) => b.basket === "AI")!;
      const energy = result.basketSummaries.find(
        (b) => b.basket === "Energy"
      )!;

      expect(ai.positionCount).toBe(2);
      expect(ai.targetWeight).toBeCloseTo(50, 6);
      expect(ai.targetValue).toBeCloseTo(5_000, 6);
      expect(ai.currentValue).toBe(0);
      expect(ai.deltaValue).toBeCloseTo(5_000, 6);

      expect(energy.positionCount).toBe(1);
      expect(energy.targetWeight).toBeCloseTo(50, 6);
      expect(energy.targetValue).toBeCloseTo(5_000, 6);
    });

    it("uses reweighted target weights (not raw sheet allocation)", () => {
      // 40% NVDA US + 60% GLEN LN (excluded by exchange) -> NVDA reweights
      // to 100%. Basket target should reflect the post-reweight target.
      const groups = [
        makeGroup({
          cleanTicker: "NVDA",
          allocation: 40,
          basket: "AI",
          exchange: "XNGS",
        }),
        makeGroup({
          cleanTicker: "GLEN",
          allocation: 60,
          basket: "Commodities",
          exchange: "XLON",
          ticker: "GLEN LN Equity",
        }),
      ];
      const result = rebalance(groups, [], 10_000, new Set());
      const ai = result.basketSummaries.find((b) => b.basket === "AI")!;
      expect(ai.targetWeight).toBeCloseTo(100, 6);
      expect(ai.targetValue).toBeCloseTo(10_000, 6);
      // Excluded basket shouldn't appear in the summary at all — it has no
      // longHoldings surviving the exclusion filter.
      expect(
        result.basketSummaries.find((b) => b.basket === "Commodities")
      ).toBeUndefined();
    });

    it("rolls stranded current holdings into a 'Not in target' bucket", () => {
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 100, basket: "AI" }),
      ];
      const rh = [
        makeRh({ ticker: "NVDA", shares: 50, marketValue: 5_000 }),
        makeRh({
          ticker: "OLD",
          shares: 10,
          currentPrice: 100,
          marketValue: 1_000,
        }),
      ];
      const result = rebalance(groups, rh, 10_000, new Set());
      const stranded = result.basketSummaries.find(
        (b) => b.basket === "Not in target"
      )!;
      expect(stranded).toBeDefined();
      expect(stranded.currentValue).toBe(1_000);
      expect(stranded.currentWeight).toBeCloseTo(10, 6);
      // Not-in-target has no target allocation, so delta is negative (sell).
      expect(stranded.targetValue).toBe(0);
      expect(stranded.deltaValue).toBe(-1_000);
      expect(stranded.positionCount).toBe(0);
    });

    it("sorts baskets by |deltaValue| descending (most-off first)", () => {
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 10, basket: "AI" }),
        makeGroup({
          cleanTicker: "XOM",
          allocation: 90,
          basket: "Energy",
          ticker: "XOM US Equity",
        }),
      ];
      const result = rebalance(groups, [], 100_000, new Set());
      expect(result.basketSummaries[0].basket).toBe("Energy");
      expect(result.basketSummaries[1].basket).toBe("AI");
    });

    it("currentWeight across all baskets equals the invested fraction", () => {
      // Sanity: summing basket.currentWeight across all baskets should
      // equal (total current value / portfolioValue) * 100.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 50, basket: "AI" }),
        makeGroup({
          cleanTicker: "XOM",
          allocation: 50,
          basket: "Energy",
          ticker: "XOM US Equity",
        }),
      ];
      const rh = [
        makeRh({ ticker: "NVDA", shares: 30, marketValue: 3_000 }),
        makeRh({
          ticker: "XOM",
          shares: 20,
          currentPrice: 100,
          marketValue: 2_000,
        }),
        makeRh({
          ticker: "OLD",
          shares: 10,
          currentPrice: 50,
          marketValue: 500,
        }),
      ];
      const result = rebalance(groups, rh, 10_000, new Set());
      const totalCurrentWeight = result.basketSummaries.reduce(
        (s, b) => s + b.currentWeight,
        0
      );
      expect(totalCurrentWeight).toBeCloseTo(55, 4); // ($5,500 / $10k) * 100
    });
  });

  // ---------- exclusion + force-include edge cases ----------
  describe("exclusion edge cases", () => {
    it("manually-excluded ticker held in RH generates a full SELL", () => {
      // User holds NVDA but excludes it. Expected: SELL all NVDA via the
      // stranded-holdings path; AAPL gets reweighted to 100%.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 50 }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 50,
          ticker: "AAPL US Equity",
        }),
      ];
      const rh = [
        makeRh({ ticker: "NVDA", shares: 30, marketValue: 3_000 }),
      ];
      const result = rebalance(groups, rh, 10_000, new Set(["NVDA"]));

      const nvdaTrade = result.trades.find((t) => t.ticker === "NVDA");
      expect(nvdaTrade).toMatchObject({
        action: "SELL",
        targetValue: 0,
        currentValue: 3_000,
        deltaValue: -3_000,
        basket: "Not in target",
      });
      // AAPL reweights from 50% -> 100% since NVDA is gone from the target.
      expect(result.reweightFactor).toBeCloseTo(2, 6);
      const aaplTrade = result.trades.find((t) => t.ticker === "AAPL");
      expect(aaplTrade?.targetWeight).toBeCloseTo(100, 6);
    });

    it("heuristic-excluded ticker held in RH still triggers a SELL", () => {
      // User holds a foreign stock (GLEN, XLON). It's not in the
      // post-exclusion target, but they still hold it — must SELL.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 50, exchange: "XNGS" }),
        makeGroup({
          cleanTicker: "GLEN",
          allocation: 50,
          exchange: "XLON",
          ticker: "GLEN LN Equity",
        }),
      ];
      const rh = [
        makeRh({ ticker: "GLEN", shares: 100, currentPrice: 10, marketValue: 1_000 }),
      ];
      const result = rebalance(groups, rh, 10_000, new Set());

      const glenSell = result.trades.find((t) => t.ticker === "GLEN");
      expect(glenSell).toMatchObject({
        action: "SELL",
        currentValue: 1_000,
        deltaValue: -1_000,
        basket: "Not in target",
      });
    });

    it("force-include of an isLong=false ticker still emits no trade", () => {
      // Short positions are dropped from the long universe regardless of
      // exclusion state. A user force-including a short does nothing useful
      // but must not crash or trade.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 50, isLong: true }),
        makeGroup({
          cleanTicker: "SHORTY",
          allocation: -50,
          isLong: false,
          ticker: "SHORTY US Equity",
        }),
      ];
      const result = rebalance(
        groups,
        [],
        10_000,
        new Set(),
        new Set(["SHORTY"])
      );

      expect(result.trades.map((t) => t.ticker)).toEqual(["NVDA"]);
      // NVDA reweights to 100% — SHORTY is not in the long allocation pool.
      expect(result.reweightFactor).toBeCloseTo(2, 6);
    });

    it("excluded Set entries for tickers not in the sheet are silently ignored", () => {
      // Stale exclusion entries (e.g. left over after the user re-uploads a
      // different sheet) shouldn't break anything — they just don't match.
      const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
      const result = rebalance(
        groups,
        [],
        10_000,
        new Set(["GHOST_TICKER", "STALE", "NVDA"]) // NVDA in the sheet, others not
      );
      expect(result.trades).toHaveLength(0); // NVDA excluded -> no buys
      expect(result.excludedHoldings.map((h) => h.cleanTicker)).toEqual(["NVDA"]);
    });

    it("force-include for an already-available ticker is a no-op (still trades)", () => {
      // NVDA on XNGS would be available anyway; force-include should leave
      // the result identical to no force-include.
      const groups = [makeGroup({ cleanTicker: "NVDA", allocation: 100 })];
      const a = rebalance(groups, [], 10_000, new Set());
      const b = rebalance(groups, [], 10_000, new Set(), new Set(["NVDA"]));
      expect(b.trades).toEqual(a.trades);
      expect(b.reweightFactor).toBe(a.reweightFactor);
      expect(b.excludedHoldings).toEqual(a.excludedHoldings);
    });

    it("scales target down when raw allocations sum to >100%", () => {
      // Citrini sheets sometimes report allocations summing to >100% (e.g.
      // 110% gross). The reweight should scale down so the actual sized
      // portfolio is exactly 100%.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 60 }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 50,
          ticker: "AAPL US Equity",
        }),
      ];
      const result = rebalance(groups, [], 10_000, new Set());
      // reweight factor scales 110 -> 100.
      expect(result.reweightFactor).toBeCloseTo(100 / 110, 6);
      const totalTargetWeight = result.trades.reduce(
        (s, t) => s + t.targetWeight,
        0
      );
      expect(totalTargetWeight).toBeCloseTo(100, 6);
      const totalTargetValue = result.trades.reduce(
        (s, t) => s + t.targetValue,
        0
      );
      expect(totalTargetValue).toBeCloseTo(10_000, 4);
    });

    it("scales target up when raw allocations sum to <100% (e.g. under-allocated sheet)", () => {
      // 80% gross allocation in the sheet -> reweight 80 -> 100.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 30 }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 50,
          ticker: "AAPL US Equity",
        }),
      ];
      const result = rebalance(groups, [], 10_000, new Set());
      expect(result.reweightFactor).toBeCloseTo(100 / 80, 6);
      const totalTargetValue = result.trades.reduce(
        (s, t) => s + t.targetValue,
        0
      );
      expect(totalTargetValue).toBeCloseTo(10_000, 4);
    });

    it("mixed scenario: shorts + heuristic-excluded + manual-excluded + force-included", () => {
      // Comprehensive scenario:
      //   - NVDA (US, long, 20)        -> available, traded
      //   - GLEN (LN, long, 20)        -> heuristic excluded
      //   - SHOP (CT, long, 20)        -> heuristic excluded, force-included
      //   - SHORTY (US, short, -10)    -> dropped (not long)
      //   - AAPL (US, long, 40)        -> manually excluded
      // totalLongAlloc post-exclusion = NVDA(20) + SHOP(20) = 40 -> reweight 2.5
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 20, exchange: "XNGS" }),
        makeGroup({
          cleanTicker: "GLEN",
          allocation: 20,
          ticker: "GLEN LN Equity",
          exchange: "XLON",
        }),
        makeGroup({
          cleanTicker: "SHOP",
          allocation: 20,
          ticker: "SHOP CT Equity",
          exchange: "XTSE",
        }),
        makeGroup({
          cleanTicker: "SHORTY",
          allocation: -10,
          isLong: false,
          ticker: "SHORTY US Equity",
          exchange: "XNYS",
        }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 40,
          ticker: "AAPL US Equity",
        }),
      ];
      const result = rebalance(
        groups,
        [],
        10_000,
        new Set(["AAPL"]),
        new Set(["SHOP"])
      );

      const tradedTickers = result.trades.map((t) => t.ticker).sort();
      expect(tradedTickers).toEqual(["NVDA", "SHOP"]);
      expect(result.reweightFactor).toBeCloseTo(2.5, 6);
      const totalTargetValue = result.trades.reduce(
        (s, t) => s + t.targetValue,
        0
      );
      expect(totalTargetValue).toBeCloseTo(10_000, 4);
      // GLEN + AAPL are in excludedHoldings; SHORTY is dropped silently
      // (it's neither in available nor excluded).
      const excludedTickers = result.excludedHoldings
        .map((h) => h.cleanTicker)
        .sort();
      expect(excludedTickers).toEqual(["AAPL", "GLEN"]);
    });

    it("excluded ticker is removed from basket summaries entirely", () => {
      // If a manual exclusion takes the last position out of a basket, the
      // basket should disappear from basketSummaries — not appear as zero.
      const groups = [
        makeGroup({ cleanTicker: "NVDA", allocation: 50, basket: "AI" }),
        makeGroup({
          cleanTicker: "OLD_BASKET_ONLY",
          allocation: 50,
          basket: "Legacy",
          ticker: "OLD_BASKET_ONLY US Equity",
        }),
      ];
      const result = rebalance(
        groups,
        [],
        10_000,
        new Set(["OLD_BASKET_ONLY"])
      );
      const baskets = result.basketSummaries.map((b) => b.basket);
      expect(baskets).toEqual(["AI"]);
    });

    it("normalizes cleanTicker case when checking exclusion sets", () => {
      // Sheets sometimes use lowercase clean tickers; UI always uppercases.
      // The rebalance() contract is that the Set keys are UPPERCASE — and
      // h.cleanTicker is uppercased before lookup, so it matches.
      const groups = [
        makeGroup({ cleanTicker: "nvda", allocation: 50 }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 50,
          ticker: "AAPL US Equity",
        }),
      ];
      const result = rebalance(groups, [], 10_000, new Set(["NVDA"]));
      expect(result.trades.map((t) => t.ticker)).toEqual(["AAPL"]);
    });

    it("excludes both copies when same cleanTicker is in 2+ baskets and held", () => {
      // NVDA in two baskets, also held in RH. After exclusion: both group
      // entries excluded AND the RH position is sold (stranded).
      const groups = [
        makeGroup({
          cleanTicker: "NVDA",
          allocation: 25,
          basket: "AI",
        }),
        makeGroup({
          cleanTicker: "NVDA",
          allocation: 25,
          basket: "Semis",
          ticker: "NVDA",
        }),
        makeGroup({
          cleanTicker: "AAPL",
          allocation: 50,
          ticker: "AAPL US Equity",
        }),
      ];
      const rh = [
        makeRh({ ticker: "NVDA", shares: 50, marketValue: 5_000 }),
      ];
      const result = rebalance(groups, rh, 10_000, new Set(["NVDA"]));

      // Both NVDA rows excluded.
      expect(
        result.excludedHoldings.filter((h) => h.cleanTicker === "NVDA")
      ).toHaveLength(2);
      // NVDA SELL emitted via stranded path.
      const nvdaSell = result.trades.find(
        (t) => t.ticker === "NVDA" && t.action === "SELL"
      );
      expect(nvdaSell).toBeDefined();
      expect(nvdaSell?.deltaValue).toBe(-5_000);
      // AAPL reweights from 50% -> 100%.
      expect(result.reweightFactor).toBeCloseTo(2, 6);
    });
  });
});
