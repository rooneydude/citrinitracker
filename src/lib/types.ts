export interface GroupHolding {
  ticker: string;        // e.g. "NVDA US" or just "NVDA"
  cleanTicker: string;   // e.g. "NVDA" (stripped of exchange suffix)
  name: string;
  allocation: number;    // Citrindex Allocation percentage
  basket: string;        // Which basket it belongs to
  lastPrice: number;
  isLong: boolean;       // true if allocation > 0
  exchange: string;      // MIC Primary Exchange
  isin: string;
  isOption: boolean;     // detected from name pattern
}

export interface RobinhoodHolding {
  ticker: string;
  shares: number;
  currentPrice: number;
  marketValue: number;
}

export interface TradeAction {
  ticker: string;
  name: string;
  action: "BUY" | "SELL";
  targetWeight: number;     // reweighted target %
  currentWeight: number;    // current % of portfolio
  targetValue: number;      // target dollar value
  currentValue: number;     // current dollar value
  deltaValue: number;       // how much $ to buy/sell
  deltaShares: number;      // how many shares to buy/sell
  lastPrice: number;
  basket: string;
}

export interface RebalanceResult {
  trades: TradeAction[];
  excludedHoldings: GroupHolding[];
  totalTargetWeight: number;
  reweightFactor: number;
  portfolioValue: number;
}

// Known non-Robinhood exchanges
export const NON_ROBINHOOD_EXCHANGES = new Set([
  "XTKS",  // Tokyo
  "XTAI",  // Taiwan
  "XPAR",  // Paris
  "XLON",  // London
  "XHKG",  // Hong Kong
  "XASX",  // Australia
  "XFRA",  // Frankfurt
  "XETR",  // Xetra (Germany)
  "XAMS",  // Amsterdam
  "XBRU",  // Brussels
  "XMIL",  // Milan
  "XMAD",  // Madrid
  "XSTO",  // Stockholm
  "XHEL",  // Helsinki
  "XOSL",  // Oslo
  "XKRX",  // Korea
  "XSES",  // Singapore
  "XBOM",  // Bombay
  "XNSE",  // India NSE
  "XSHE",  // Shenzhen
  "XSHG",  // Shanghai
]);

// Robinhood-compatible US exchanges
export const ROBINHOOD_EXCHANGES = new Set([
  "XNGS",  // NASDAQ Global Select
  "XNYS",  // NYSE
  "XNCM",  // NASDAQ Capital Market
  "XNMS",  // NASDAQ Global Market
  "ARCX",  // NYSE Arca
  "BATS",  // CBOE BZX
  "XASE",  // NYSE American
]);
