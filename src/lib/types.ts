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

export interface PlaidHoldingsResponse {
  holdings: RobinhoodHolding[];
  portfolioValue: number;
}

export interface PlaidExchangeResponse extends PlaidHoldingsResponse {
  access_token: string;
}

// Known non-Robinhood exchanges. MIC (ISO 10383) codes.
// Robinhood only supports US-listed securities (NYSE/NASDAQ/ARCA/BATS/AMEX);
// every entry below is a venue RH cannot route to.
export const NON_ROBINHOOD_EXCHANGES = new Set([
  // Asia-Pacific
  "XTKS",  // Tokyo
  "XTAI",  // Taiwan
  "XHKG",  // Hong Kong
  "XSHE",  // Shenzhen
  "XSHG",  // Shanghai
  "XKRX",  // Korea
  "XASX",  // Australia (ASX)
  "XSES",  // Singapore
  "XBOM",  // Bombay
  "XNSE",  // India NSE
  "XKLS",  // Malaysia
  "XBKK",  // Thailand
  "XIDX",  // Indonesia
  "XPHS",  // Philippines
  "XHNX",  // Vietnam (Hanoi)
  "XSTC",  // Vietnam (Ho Chi Minh)
  "XNZE",  // New Zealand
  // Europe
  "XPAR",  // Paris
  "XLON",  // London
  "XFRA",  // Frankfurt
  "XETR",  // Xetra (Germany)
  "XAMS",  // Amsterdam
  "XBRU",  // Brussels
  "XMIL",  // Milan (Borsa Italiana)
  "XMAD",  // Madrid
  "XSTO",  // Stockholm
  "XHEL",  // Helsinki
  "XOSL",  // Oslo
  "XCSE",  // Copenhagen
  "XICE",  // Iceland
  "XSWX",  // Swiss Exchange (SIX)
  "XVTX",  // SIX Swiss blue chips
  "XWAR",  // Warsaw
  "XBUD",  // Budapest
  "XPRA",  // Prague
  "XWBO",  // Vienna
  "XATH",  // Athens
  "XIST",  // Istanbul
  "XLIS",  // Lisbon
  "XDUB",  // Dublin
  "XMOS",  // Moscow
  // Americas (ex-US)
  "XTSE",  // Toronto
  "XTSX",  // TSX Venture
  "XCNQ",  // Canadian Securities Exchange
  "XMEX",  // Mexico
  "XBSP",  // B3 São Paulo
  "XSGO",  // Santiago
  "XBUE",  // Buenos Aires
  "XBOG",  // Colombia
  // Middle East & Africa
  "XTAE",  // Tel Aviv
  "XJSE",  // Johannesburg
  "XDFM",  // Dubai
  "XADS",  // Abu Dhabi
  "XSAU",  // Saudi (Tadawul)
  "XKSE",  // Kuwait
  "XBAH",  // Bahrain
  "XDOH",  // Qatar
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
