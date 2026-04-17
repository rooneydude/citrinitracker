import {
  GroupHolding,
  RobinhoodHolding,
  TradeAction,
  RebalanceResult,
  NON_ROBINHOOD_EXCHANGES,
  ROBINHOOD_EXCHANGES,
} from "./types";

export function isAvailableOnRobinhood(holding: GroupHolding): boolean {
  // Options are not directly replicable
  if (holding.isOption) return false;

  // If we know the exchange, check it
  if (holding.exchange) {
    if (NON_ROBINHOOD_EXCHANGES.has(holding.exchange)) return false;
    if (ROBINHOOD_EXCHANGES.has(holding.exchange)) return true;
  }

  // Ticker heuristics: foreign tickers often have non-US Bloomberg country
  // codes. Matches either end-of-string ("GLEN LN") or followed by whitespace
  // ("GLEN LN Equity") so the full Bloomberg form works too.
  //
  // The list below is the set of 2-letter Bloomberg country codes for venues
  // Robinhood cannot trade. Not exhaustive but covers the common cases.
  // NOTE: `CN` is Bloomberg-for-Canada (not China); Chinese codes are `CH`.
  const foreignSuffixes =
    /\s+(JP|TT|FP|GR|LN|HK|AU|CN|CT|KS|SP|IT|IM|SM|SS|NO|FH|DC|BB|SW|VX|SJ|TB|PM|VN|IJ|MK|NZ|TI|PW|AV|BZ|MM|AR|CI|CB|CH|RU|IN|KK|EY|PL|HB|ID|EG|UH|QD)(\s|$)/i;
  if (foreignSuffixes.test(holding.ticker)) return false;

  // Numeric-only tickers are usually foreign (e.g., "5801 JP" -> "5801")
  if (/^\d+$/.test(holding.cleanTicker)) return false;

  // Default: assume available
  return true;
}

export function rebalance(
  groupHoldings: GroupHolding[],
  robinhoodHoldings: RobinhoodHolding[],
  portfolioValue: number,
  /**
   * Manually-excluded cleanTickers (UPPERCASE). These force a reject even if
   * the Robinhood-availability heuristic says yes.
   */
  excludedCleanTickers: Set<string>,
  /**
   * Force-included cleanTickers (UPPERCASE). These override a heuristic-based
   * auto-exclusion — e.g. a valid US stock the heuristic misclassified.
   * Manual exclusion still wins over force-include.
   */
  forceIncludedCleanTickers: Set<string> = new Set()
): RebalanceResult {
  // Separate available vs excluded holdings.
  //
  // Precedence (highest → lowest):
  //   1. manual exclusion  → always excluded
  //   2. force-include     → always included
  //   3. heuristic         → default
  const available: GroupHolding[] = [];
  const excluded: GroupHolding[] = [];

  for (const h of groupHoldings) {
    const ct = h.cleanTicker.toUpperCase();
    if (excludedCleanTickers.has(ct)) {
      excluded.push(h);
    } else if (forceIncludedCleanTickers.has(ct)) {
      available.push(h);
    } else if (!isAvailableOnRobinhood(h)) {
      excluded.push(h);
    } else {
      available.push(h);
    }
  }

  // Robinhood doesn't support shorting stocks directly, so we only include
  // long positions and reweight those to fill 100%.
  const longHoldings = available.filter((h) => h.isLong);
  const totalLongAlloc = longHoldings.reduce((sum, h) => sum + h.allocation, 0);

  // Reweight factor: scale up available longs to fill 100%
  const reweightFactor = totalLongAlloc > 0 ? 100 / totalLongAlloc : 1;

  // Build current holdings map
  const currentMap = new Map<string, RobinhoodHolding>();
  for (const rh of robinhoodHoldings) {
    currentMap.set(rh.ticker.toUpperCase(), rh);
  }

  // Calculate trades
  const trades: TradeAction[] = [];

  for (const holding of longHoldings) {
    const targetWeight = holding.allocation * reweightFactor;
    const targetValue = (targetWeight / 100) * portfolioValue;

    // Find matching current holding
    const current = currentMap.get(holding.cleanTicker.toUpperCase());
    const currentValue = current ? current.marketValue : 0;
    const currentWeight = portfolioValue > 0 ? (currentValue / portfolioValue) * 100 : 0;

    const deltaValue = targetValue - currentValue;
    const price = current?.currentPrice || holding.lastPrice;
    const deltaShares = price > 0 ? deltaValue / price : 0;

    // Only include if there's a meaningful trade (> $1)
    if (Math.abs(deltaValue) > 1) {
      trades.push({
        ticker: holding.cleanTicker,
        name: holding.name,
        action: deltaValue > 0 ? "BUY" : "SELL",
        targetWeight,
        currentWeight,
        targetValue,
        currentValue,
        deltaValue,
        deltaShares,
        lastPrice: price,
        basket: holding.basket,
      });
    }
  }

  // Also flag any current holdings NOT in the target (need to sell)
  for (const [ticker, rh] of currentMap) {
    const inTarget = longHoldings.some(
      (h) => h.cleanTicker.toUpperCase() === ticker
    );
    if (!inTarget && rh.marketValue > 1) {
      trades.push({
        ticker: rh.ticker,
        name: rh.ticker,
        action: "SELL",
        targetWeight: 0,
        currentWeight: (rh.marketValue / portfolioValue) * 100,
        targetValue: 0,
        currentValue: rh.marketValue,
        deltaValue: -rh.marketValue,
        deltaShares: -rh.shares,
        lastPrice: rh.currentPrice,
        basket: "Not in target",
      });
    }
  }

  // Sort by absolute delta value descending
  trades.sort((a, b) => Math.abs(b.deltaValue) - Math.abs(a.deltaValue));

  return {
    trades,
    excludedHoldings: excluded,
    totalTargetWeight: totalLongAlloc,
    reweightFactor,
    portfolioValue,
  };
}
