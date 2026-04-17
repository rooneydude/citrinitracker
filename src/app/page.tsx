"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";
import { parseGroupHoldings } from "@/lib/parseSpreadsheet";
import { parseRobinhoodCSV } from "@/lib/parseRobinhoodCSV";
import { rebalance, isAvailableOnRobinhood } from "@/lib/rebalance";
import {
  GroupHolding,
  RobinhoodHolding,
  RebalanceResult,
  TradeAction,
  PlaidHoldingsResponse,
  PlaidExchangeResponse,
} from "@/lib/types";

const PLAID_TOKEN_KEY = "citrini.plaid.access_token";
const GROUP_HOLDINGS_KEY = "citrini.groupHoldings";
const GROUP_HOLDINGS_TS_KEY = "citrini.groupHoldings.parsedAt";
// v2: keys are cleanTicker.toUpperCase() (was raw Bloomberg `h.ticker` in v1).
// Old v1 data is discarded by key change — drift was invisible to the user.
const EXCLUDED_KEY = "citrini.excluded.v2";
const FORCE_INCLUDED_KEY = "citrini.forceIncluded";

function formatTimeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

function formatDollar(n: number): string {
  const abs = Math.abs(n);
  const formatted =
    abs >= 1000
      ? abs.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : abs.toFixed(2);
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatShares(n: number): string {
  const abs = Math.abs(n);
  return (n < 0 ? "-" : "+") + abs.toFixed(abs < 1 ? 4 : 2);
}

function formatPct(n: number): string {
  return n.toFixed(2) + "%";
}

// Step Indicator
function StepIndicator({
  step,
  currentStep,
}: {
  step: number;
  currentStep: number;
}) {
  const isActive = currentStep === step;
  const isDone = currentStep > step;
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
          isDone
            ? "bg-accent border-accent text-background"
            : isActive
            ? "border-accent text-accent"
            : "border-card-border text-card-border"
        }`}
      >
        {isDone ? "\u2713" : step}
      </div>
    </div>
  );
}

// File Upload
function FileUpload({
  onParsed,
}: {
  onParsed: (holdings: GroupHolding[]) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.match(/\.xlsx?$/i)) {
        setError("Please upload an .xlsx file");
        return;
      }
      try {
        const buffer = await file.arrayBuffer();
        const holdings = parseGroupHoldings(buffer);
        if (holdings.length === 0) {
          setError("No holdings found in spreadsheet");
          return;
        }
        setFileName(file.name);
        onParsed(holdings);
      } catch {
        setError("Failed to parse spreadsheet. Check the format.");
      }
    },
    [onParsed]
  );

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer ${
        isDragging
          ? "border-accent bg-accent-dim"
          : fileName
          ? "border-accent/50 bg-accent-dim"
          : "border-card-border hover:border-foreground/30"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      }}
      onClick={() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".xlsx,.xls";
        input.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (file) handleFile(file);
        };
        input.click();
      }}
    >
      {fileName ? (
        <div>
          <p className="text-accent font-semibold text-lg">{fileName}</p>
          <p className="text-foreground/50 text-sm mt-1">
            Click or drag to replace
          </p>
        </div>
      ) : (
        <div>
          <p className="text-foreground/70 text-lg">
            Drop your group holdings .xlsx here
          </p>
          <p className="text-foreground/40 text-sm mt-2">or click to browse</p>
        </div>
      )}
      {error && <p className="text-red mt-3 text-sm">{error}</p>}
    </div>
  );
}

// Exclusion List
function ExclusionManager({
  holdings,
  excluded,
  forceIncluded,
  onToggleExclude,
  onToggleForceInclude,
}: {
  holdings: GroupHolding[];
  excluded: Set<string>;
  forceIncluded: Set<string>;
  onToggleExclude: (cleanTicker: string) => void;
  onToggleForceInclude: (cleanTicker: string) => void;
}) {
  // Partition in a single pass (instead of filtering twice per render).
  const { autoExcluded, available } = useMemo(() => {
    const auto: GroupHolding[] = [];
    const avail: GroupHolding[] = [];
    for (const h of holdings) {
      if (isAvailableOnRobinhood(h)) avail.push(h);
      else auto.push(h);
    }
    return { autoExcluded: auto, available: avail };
  }, [holdings]);

  return (
    <div className="space-y-4">
      {autoExcluded.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-foreground/60 uppercase tracking-wide mb-2">
            Auto-excluded (not on Robinhood)
            <span className="text-foreground/30 font-normal ml-2">
              (click to force-include)
            </span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {autoExcluded.map((h) => {
              const ct = h.cleanTicker.toUpperCase();
              const isForced = forceIncluded.has(ct);
              return (
                <button
                  key={`${h.basket}:${h.ticker}`}
                  onClick={() => onToggleForceInclude(ct)}
                  className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                    isForced
                      ? "bg-accent-dim text-accent ring-1 ring-accent/40"
                      : "bg-red-dim text-red line-through hover:bg-red/20"
                  }`}
                  title={
                    isForced
                      ? `${h.name} — forced on (heuristic said not on RH)`
                      : `${h.name} - ${h.exchange || "Unknown exchange"} (click to override)`
                  }
                >
                  {h.cleanTicker}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <h4 className="text-sm font-semibold text-foreground/60 uppercase tracking-wide mb-2">
          Robinhood-available stocks
          <span className="text-foreground/30 font-normal ml-2">
            (click to exclude)
          </span>
        </h4>
        <div className="flex flex-wrap gap-2">
          {available.map((h) => {
            const ct = h.cleanTicker.toUpperCase();
            const isExcluded = excluded.has(ct);
            return (
              <button
                key={`${h.basket}:${h.ticker}`}
                onClick={() => onToggleExclude(ct)}
                className={`px-3 py-1 rounded-full text-xs font-mono transition-all ${
                  isExcluded
                    ? "bg-red-dim text-red line-through opacity-60"
                    : "bg-accent-dim text-accent hover:bg-accent/20"
                }`}
                title={h.name}
              >
                {h.cleanTicker}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Plaid Connect Button
function PlaidConnectButton({
  onSuccess,
}: {
  onSuccess: (data: PlaidExchangeResponse) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // NOTE: We intentionally don't use a ref-guard here. In React Strict Mode
  // (dev only) the effect mounts -> cleans up -> mounts again; a ref-guard
  // plus the cancelled pattern ends up silently dropping every response.
  // A second create-link-token request on dev is harmless and idempotent.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.link_token) setLinkToken(data.link_token);
        else setError(data.error || "Could not initialize Plaid");
      })
      .catch(() => {
        if (!cancelled) setError("Could not connect to server");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange-and-fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          onSuccess(data as PlaidExchangeResponse);
        }
      } catch {
        setError("Failed to fetch holdings from Robinhood");
      } finally {
        setLoading(false);
      }
    },
  });

  if (error) {
    return (
      <div className="rounded-xl border border-red/30 bg-red-dim p-4 text-center">
        <p className="text-red text-sm">{error}</p>
        <p className="text-foreground/40 text-xs mt-1">
          Use manual entry below instead
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready || loading}
      className="w-full py-3 px-4 bg-accent text-background font-bold rounded-xl text-sm hover:bg-accent/80 transition disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {loading
        ? "Fetching holdings..."
        : linkToken
        ? "Connect Robinhood via Plaid"
        : "Initializing..."}
    </button>
  );
}

// Robinhood Input
function RobinhoodInput({
  portfolioValue,
  setPortfolioValue,
  holdings,
  setHoldings,
}: {
  portfolioValue: string;
  setPortfolioValue: (v: string) => void;
  holdings: RobinhoodHolding[];
  setHoldings: (h: RobinhoodHolding[]) => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [manualTicker, setManualTicker] = useState("");
  const [manualShares, setManualShares] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidRefreshing, setPlaidRefreshing] = useState(false);
  const [plaidError, setPlaidError] = useState<string | null>(null);

  const applyPlaidData = useCallback(
    (data: PlaidHoldingsResponse) => {
      setHoldings(data.holdings);
      if (data.portfolioValue > 0) {
        setPortfolioValue(data.portfolioValue.toFixed(2));
      }
    },
    [setHoldings, setPortfolioValue]
  );

  const handlePlaidSuccess = useCallback(
    (data: PlaidExchangeResponse) => {
      applyPlaidData(data);
      try {
        localStorage.setItem(PLAID_TOKEN_KEY, data.access_token);
      } catch {
        // localStorage can throw in private mode; non-fatal.
      }
      setPlaidConnected(true);
      setPlaidError(null);
    },
    [applyPlaidData]
  );

  const refreshFromPlaid = useCallback(
    async (token: string) => {
      setPlaidRefreshing(true);
      setPlaidError(null);
      try {
        const res = await fetch("/api/plaid/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: token }),
        });
        const data = await res.json();
        if (data.error) {
          setPlaidError(data.error);
          // 400/401-ish errors usually mean the token is dead. Forget it so
          // the user sees the Connect button again.
          if (res.status === 400 || res.status === 401) {
            localStorage.removeItem(PLAID_TOKEN_KEY);
            setPlaidConnected(false);
          }
        } else {
          applyPlaidData(data as PlaidHoldingsResponse);
          setPlaidConnected(true);
        }
      } catch {
        setPlaidError("Failed to refresh holdings");
      } finally {
        setPlaidRefreshing(false);
      }
    },
    [applyPlaidData]
  );

  const disconnectPlaid = useCallback(() => {
    try {
      localStorage.removeItem(PLAID_TOKEN_KEY);
    } catch {
      // ignore
    }
    setPlaidConnected(false);
    setHoldings([]);
    setPlaidError(null);
  }, [setHoldings]);

  // On mount, if we already have an access_token, auto-refresh holdings.
  // Runs once (ref guard) to survive React Strict Mode double-mount.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    let token: string | null = null;
    try {
      token = localStorage.getItem(PLAID_TOKEN_KEY);
    } catch {
      // ignore
    }
    if (token) {
      refreshFromPlaid(token);
    }
  }, [refreshFromPlaid]);

  const handleCSVPaste = () => {
    const parsed = parseRobinhoodCSV(csvText);
    if (parsed.length > 0) {
      setHoldings(parsed);
      const total = parsed.reduce((sum, h) => sum + h.marketValue, 0);
      if (total > 0) setPortfolioValue(total.toFixed(2));
    }
  };

  const addManualHolding = () => {
    const ticker = manualTicker.toUpperCase().trim();
    const shares = parseFloat(manualShares);
    const price = parseFloat(manualPrice);
    if (!ticker || isNaN(shares) || shares <= 0) return;

    const newHolding: RobinhoodHolding = {
      ticker,
      shares,
      currentPrice: isNaN(price) ? 0 : price,
      marketValue: isNaN(price) ? 0 : shares * price,
    };

    const updated = [...holdings.filter((h) => h.ticker !== ticker), newHolding];
    setHoldings(updated);
    setManualTicker("");
    setManualShares("");
    setManualPrice("");
  };

  const removeHolding = (ticker: string) => {
    setHoldings(holdings.filter((h) => h.ticker !== ticker));
  };

  return (
    <div className="space-y-6">
      {/* Plaid auto-connect */}
      {!plaidConnected ? (
        <div>
          <label className="block text-sm font-semibold text-foreground/70 mb-2">
            Auto-Import from Robinhood
          </label>
          <PlaidConnectButton onSuccess={handlePlaidSuccess} />
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-card-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-card px-3 text-foreground/30 text-xs uppercase">
                or enter manually
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-accent/30 bg-accent-dim p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-accent text-sm font-semibold">
              {plaidRefreshing
                ? "Refreshing Robinhood holdings…"
                : "Robinhood connected via Plaid"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const token = localStorage.getItem(PLAID_TOKEN_KEY);
                  if (token) refreshFromPlaid(token);
                }}
                disabled={plaidRefreshing}
                className="text-foreground/60 text-xs font-semibold hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Refresh
              </button>
              <button
                onClick={disconnectPlaid}
                className="text-foreground/40 text-xs hover:text-red"
              >
                Disconnect
              </button>
            </div>
          </div>
          {plaidError ? (
            <p className="text-red text-xs">{plaidError}</p>
          ) : null}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-foreground/70 mb-2">
          Total Portfolio Value ($)
        </label>
        <input
          type="text"
          value={portfolioValue}
          onChange={(e) =>
            setPortfolioValue(e.target.value.replace(/[^0-9.]/g, ""))
          }
          placeholder="e.g. 50000"
          className="w-full bg-background border border-card-border rounded-lg px-4 py-3 text-lg font-mono text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-foreground/70 mb-2">
          Current Holdings
        </label>

        <details className="mb-4">
          <summary className="cursor-pointer text-sm text-accent hover:underline">
            Paste Robinhood CSV export
          </summary>
          <div className="mt-2 space-y-2">
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={5}
              placeholder={
                "Instrument,Quantity,Current Price,Equity\nAAPL,10,180.50,1805.00\nNVDA,25,177.64,4441.00"
              }
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground/20 focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleCSVPaste}
              className="px-4 py-2 bg-accent text-background font-semibold rounded-lg text-sm hover:bg-accent/80 transition"
            >
              Import CSV
            </button>
          </div>
        </details>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              value={manualTicker}
              onChange={(e) => setManualTicker(e.target.value)}
              placeholder="Ticker"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
              onKeyDown={(e) => e.key === "Enter" && addManualHolding()}
            />
          </div>
          <div className="flex-1">
            <input
              value={manualShares}
              onChange={(e) => setManualShares(e.target.value)}
              placeholder="Shares"
              type="number"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
              onKeyDown={(e) => e.key === "Enter" && addManualHolding()}
            />
          </div>
          <div className="flex-1">
            <input
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              placeholder="Price (opt)"
              type="number"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent"
              onKeyDown={(e) => e.key === "Enter" && addManualHolding()}
            />
          </div>
          <button
            onClick={addManualHolding}
            className="px-4 py-2 bg-card border border-card-border text-foreground rounded-lg text-sm hover:border-accent transition"
          >
            Add
          </button>
        </div>

        {holdings.length > 0 && (
          <div className="mt-4 space-y-1">
            {holdings.map((h) => (
              <div
                key={h.ticker}
                className="flex justify-between items-center bg-card rounded-lg px-3 py-2 text-sm font-mono"
              >
                <span className="text-accent font-bold">{h.ticker}</span>
                <span className="text-foreground/60">
                  {h.shares} shares
                  {h.currentPrice > 0 && ` @ $${h.currentPrice.toFixed(2)}`}
                  {h.marketValue > 0 && (
                    <span className="ml-2 text-foreground/40">
                      = {formatDollar(h.marketValue)}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => removeHolding(h.ticker)}
                  className="text-red/60 hover:text-red ml-2"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {holdings.length === 0 && (
          <p className="text-foreground/30 text-sm mt-3 italic">
            No current holdings entered. Leave empty if starting fresh.
          </p>
        )}
      </div>
    </div>
  );
}

// Trade Table
function TradeTable({ result }: { result: RebalanceResult }) {
  const buys = result.trades.filter((t) => t.action === "BUY");
  const sells = result.trades.filter((t) => t.action === "SELL");

  const totalBuy = buys.reduce((s, t) => s + t.deltaValue, 0);
  const totalSell = sells.reduce((s, t) => s + t.deltaValue, 0);

  const renderRow = (t: TradeAction) => (
    <tr
      key={t.ticker}
      className="border-b border-card-border/50 hover:bg-card-border/10 transition"
    >
      <td className="py-2 px-3">
        <span className="font-mono font-bold text-foreground">{t.ticker}</span>
        <span className="text-foreground/30 text-xs ml-2 hidden sm:inline">
          {t.name}
        </span>
      </td>
      <td className="py-2 px-3 text-right">
        <span
          className={`font-bold px-2 py-0.5 rounded text-xs ${
            t.action === "BUY"
              ? "bg-accent-dim text-accent"
              : "bg-red-dim text-red"
          }`}
        >
          {t.action}
        </span>
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm">
        {formatShares(t.deltaShares)} shares
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm">
        <span className={t.action === "BUY" ? "text-accent" : "text-red"}>
          {formatDollar(Math.abs(t.deltaValue))}
        </span>
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm text-foreground/50">
        {formatPct(t.currentWeight)} &rarr; {formatPct(t.targetWeight)}
      </td>
      <td className="py-2 px-3 text-right font-mono text-sm text-foreground/30">
        ${t.lastPrice.toFixed(2)}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl p-4 border border-card-border">
          <p className="text-foreground/50 text-xs uppercase tracking-wide">
            Portfolio
          </p>
          <p className="text-xl font-mono font-bold mt-1">
            {formatDollar(result.portfolioValue)}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-card-border">
          <p className="text-foreground/50 text-xs uppercase tracking-wide">
            Total to Buy
          </p>
          <p className="text-xl font-mono font-bold mt-1 text-accent">
            {formatDollar(totalBuy)}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-card-border">
          <p className="text-foreground/50 text-xs uppercase tracking-wide">
            Total to Sell
          </p>
          <p className="text-xl font-mono font-bold mt-1 text-red">
            {formatDollar(Math.abs(totalSell))}
          </p>
        </div>
        <div className="bg-card rounded-xl p-4 border border-card-border">
          <p className="text-foreground/50 text-xs uppercase tracking-wide">
            Reweight Factor
          </p>
          <p className="text-xl font-mono font-bold mt-1 text-yellow">
            {result.reweightFactor.toFixed(2)}x
          </p>
        </div>
      </div>

      {/* Excluded holdings */}
      {result.excludedHoldings.length > 0 && (
        <div className="bg-card rounded-xl p-4 border border-card-border">
          <p className="text-foreground/50 text-xs uppercase tracking-wide mb-2">
            Excluded &amp; Reweighted Out (
            {result.excludedHoldings.length} positions,{" "}
            {formatPct(
              result.excludedHoldings.reduce(
                (s, h) => s + Math.abs(h.allocation),
                0
              )
            )}{" "}
            of original)
          </p>
          <div className="flex flex-wrap gap-2">
            {result.excludedHoldings.map((h) => (
              <span
                key={h.ticker}
                className="px-2 py-1 bg-red-dim text-red rounded text-xs font-mono"
                title={`${h.name}: ${formatPct(h.allocation)}`}
              >
                {h.cleanTicker} ({formatPct(h.allocation)})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trade list */}
      <div className="bg-card rounded-xl border border-card-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-foreground/40 text-xs uppercase tracking-wide">
                <th className="text-left py-3 px-3">Ticker</th>
                <th className="text-right py-3 px-3">Action</th>
                <th className="text-right py-3 px-3">Shares</th>
                <th className="text-right py-3 px-3">Amount</th>
                <th className="text-right py-3 px-3">Weight</th>
                <th className="text-right py-3 px-3">Price</th>
              </tr>
            </thead>
            <tbody>
              {buys.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={6}
                      className="py-2 px-3 text-accent text-xs font-bold uppercase tracking-widest bg-accent-dim/30"
                    >
                      Buys ({buys.length})
                    </td>
                  </tr>
                  {buys.map(renderRow)}
                </>
              )}
              {sells.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={6}
                      className="py-2 px-3 text-red text-xs font-bold uppercase tracking-widest bg-red-dim/30"
                    >
                      Sells ({sells.length})
                    </td>
                  </tr>
                  {sells.map(renderRow)}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {result.trades.length === 0 && (
        <div className="text-center py-12 text-foreground/30">
          <p className="text-lg">
            No trades needed - you&apos;re already balanced!
          </p>
        </div>
      )}
    </div>
  );
}

// Simplified Trade Action List
function TradeActionList({ trades }: { trades: TradeAction[] }) {
  const [copied, setCopied] = useState(false);

  const lines = trades.map((t, i) => {
    const absShares = Math.abs(t.deltaShares);
    const shareStr = absShares < 1 ? absShares.toFixed(4) : absShares.toFixed(2);
    const dollarStr = formatDollar(Math.abs(t.deltaValue));
    if (t.action === "SELL" && t.targetWeight === 0) {
      return `${i + 1}. SELL ALL ${t.ticker} — ${shareStr} shares (~${dollarStr})`;
    }
    return `${i + 1}. ${t.action} ${shareStr} shares of ${t.ticker} (~${dollarStr})`;
  });

  const text = lines.join("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (trades.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-card-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground/60 uppercase tracking-wide">
          Quick Trade List
        </h3>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 bg-accent-dim text-accent text-xs font-semibold rounded-lg hover:bg-accent/20 transition"
        >
          {copied ? "Copied!" : "Copy to Clipboard"}
        </button>
      </div>
      <pre className="text-sm font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

// Main Page
export default function Home() {
  const [step, setStep] = useState(1);
  const [groupHoldings, setGroupHoldings] = useState<GroupHolding[]>([]);
  const [parsedAt, setParsedAt] = useState<number | null>(null);
  // All exclusion state is keyed by cleanTicker.toUpperCase() so that the
  // same underlying symbol is treated consistently across baskets, Plaid
  // current-holdings lookup, and the rebalance engine.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [forceIncluded, setForceIncluded] = useState<Set<string>>(new Set());
  const [portfolioValue, setPortfolioValue] = useState("");
  const [rhHoldings, setRhHoldings] = useState<RobinhoodHolding[]>([]);

  const handleGroupParsed = useCallback((holdings: GroupHolding[]) => {
    setGroupHoldings(holdings);
    const now = Date.now();
    setParsedAt(now);
    try {
      localStorage.setItem(GROUP_HOLDINGS_TS_KEY, String(now));
    } catch {
      // localStorage can throw in private mode; non-fatal.
    }
    // Prune any persisted exclusion/override entries for tickers that no
    // longer exist in the freshly-uploaded sheet — otherwise cruft from old
    // sheets silently accumulates in localStorage.
    const validTickers = new Set(
      holdings.map((h) => h.cleanTicker.toUpperCase())
    );
    setExcluded((prev) => {
      const next = new Set<string>();
      for (const t of prev) if (validTickers.has(t)) next.add(t);
      return next;
    });
    setForceIncluded((prev) => {
      const next = new Set<string>();
      for (const t of prev) if (validTickers.has(t)) next.add(t);
      return next;
    });
    setStep(2);
  }, []);

  // Toggle manual exclusion. `cleanTicker` already normalized to UPPERCASE
  // by the caller.
  const toggleExcluded = useCallback((cleanTicker: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(cleanTicker)) next.delete(cleanTicker);
      else next.add(cleanTicker);
      return next;
    });
  }, []);

  // Toggle force-include (overrides the auto-exclusion heuristic).
  const toggleForceIncluded = useCallback((cleanTicker: string) => {
    setForceIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(cleanTicker)) next.delete(cleanTicker);
      else next.add(cleanTicker);
      return next;
    });
  }, []);

  const clearGroupHoldings = useCallback(() => {
    setGroupHoldings([]);
    setParsedAt(null);
    setExcluded(new Set());
    setForceIncluded(new Set());
    setStep(1);
    try {
      localStorage.removeItem(GROUP_HOLDINGS_KEY);
      localStorage.removeItem(GROUP_HOLDINGS_TS_KEY);
      localStorage.removeItem(EXCLUDED_KEY);
      localStorage.removeItem(FORCE_INCLUDED_KEY);
    } catch {
      // ignore
    }
  }, []);

  // Restore persisted state on mount. Ref guard for React Strict Mode
  // double-mount (which would also fire this effect twice).
  //
  // The react-hooks/set-state-in-effect rule warns against setState in an
  // effect body because it can cascade renders. Here it's fine: we fire
  // exactly once on mount to hydrate initial state from localStorage, and
  // can't use a lazy useState initializer because localStorage is not
  // available during SSR. This is the same pattern used for Plaid below.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    try {
      const holdingsJson = localStorage.getItem(GROUP_HOLDINGS_KEY);
      if (holdingsJson) {
        const parsed = JSON.parse(holdingsJson) as GroupHolding[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setGroupHoldings(parsed);
          setStep(2);
        }
      }
      const tsRaw = localStorage.getItem(GROUP_HOLDINGS_TS_KEY);
      if (tsRaw) {
        const ts = Number(tsRaw);
        if (Number.isFinite(ts) && ts > 0) setParsedAt(ts);
      }
      const excludedJson = localStorage.getItem(EXCLUDED_KEY);
      if (excludedJson) {
        const arr = JSON.parse(excludedJson) as string[];
        if (Array.isArray(arr)) setExcluded(new Set(arr));
      }
      const forceJson = localStorage.getItem(FORCE_INCLUDED_KEY);
      if (forceJson) {
        const arr = JSON.parse(forceJson) as string[];
        if (Array.isArray(arr)) setForceIncluded(new Set(arr));
      }
    } catch {
      // Corrupt storage — ignore and start fresh.
    }
  }, []);

  // Persist group holdings whenever they change. Clear when emptied.
  useEffect(() => {
    try {
      if (groupHoldings.length > 0) {
        localStorage.setItem(GROUP_HOLDINGS_KEY, JSON.stringify(groupHoldings));
      } else {
        localStorage.removeItem(GROUP_HOLDINGS_KEY);
        localStorage.removeItem(GROUP_HOLDINGS_TS_KEY);
      }
    } catch {
      // quota exceeded or private mode — non-fatal
    }
  }, [groupHoldings]);

  // Persist manual exclusions.
  useEffect(() => {
    try {
      if (excluded.size > 0) {
        localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]));
      } else {
        localStorage.removeItem(EXCLUDED_KEY);
      }
    } catch {
      // non-fatal
    }
  }, [excluded]);

  // Persist force-include overrides.
  useEffect(() => {
    try {
      if (forceIncluded.size > 0) {
        localStorage.setItem(
          FORCE_INCLUDED_KEY,
          JSON.stringify([...forceIncluded])
        );
      } else {
        localStorage.removeItem(FORCE_INCLUDED_KEY);
      }
    } catch {
      // non-fatal
    }
  }, [forceIncluded]);

  const result: RebalanceResult | null = useMemo(() => {
    const pv = parseFloat(portfolioValue);
    if (groupHoldings.length === 0 || !pv || pv <= 0) return null;
    return rebalance(groupHoldings, rhHoldings, pv, excluded, forceIncluded);
  }, [groupHoldings, rhHoldings, portfolioValue, excluded, forceIncluded]);

  const longCount = groupHoldings.filter((h) => h.isLong).length;
  const baskets = [...new Set(groupHoldings.map((h) => h.basket))];

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-card-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Citrini Tracker
            </h1>
            <p className="text-foreground/40 text-sm mt-0.5">
              Portfolio Rebalancer for Robinhood
            </p>
          </div>
          <div className="flex items-center gap-4">
            <StepIndicator step={1} currentStep={step} />
            <div className="w-8 h-px bg-card-border" />
            <StepIndicator step={2} currentStep={step} />
            <div className="w-8 h-px bg-card-border" />
            <StepIndicator step={3} currentStep={step} />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Step 1: Upload */}
        <section className="bg-card rounded-2xl border border-card-border p-6">
          <h2 className="text-lg font-bold mb-1">
            Step 1: Upload Group Holdings
          </h2>
          <p className="text-foreground/40 text-sm mb-4">
            Upload the .xlsx spreadsheet from your investing group
          </p>
          <FileUpload onParsed={handleGroupParsed} />
          {groupHoldings.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-sm text-foreground/50">
              <div className="flex flex-wrap gap-4">
                <span>
                  <strong className="text-foreground">
                    {groupHoldings.length}
                  </strong>{" "}
                  positions parsed
                </span>
                <span>
                  <strong className="text-foreground">{longCount}</strong> long
                </span>
                <span>
                  <strong className="text-foreground">{baskets.length}</strong>{" "}
                  baskets
                </span>
                {parsedAt ? (
                  <span
                    className="text-foreground/30"
                    title={new Date(parsedAt).toLocaleString()}
                  >
                    uploaded {formatTimeAgo(parsedAt)}
                  </span>
                ) : null}
              </div>
              <button
                onClick={clearGroupHoldings}
                className="text-foreground/40 text-xs hover:text-red"
              >
                Clear
              </button>
            </div>
          )}
        </section>

        {/* Step 2: Configure */}
        {step >= 2 && (
          <section className="bg-card rounded-2xl border border-card-border p-6">
            <h2 className="text-lg font-bold mb-1">
              Step 2: Your Robinhood Portfolio
            </h2>
            <p className="text-foreground/40 text-sm mb-4">
              Enter your portfolio value and current holdings. Stocks not on
              Robinhood are auto-excluded and their weight is redistributed.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <RobinhoodInput
                portfolioValue={portfolioValue}
                setPortfolioValue={setPortfolioValue}
                holdings={rhHoldings}
                setHoldings={setRhHoldings}
              />
              <ExclusionManager
                holdings={groupHoldings}
                excluded={excluded}
                forceIncluded={forceIncluded}
                onToggleExclude={toggleExcluded}
                onToggleForceInclude={toggleForceIncluded}
              />
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setStep(3)}
                disabled={!portfolioValue || parseFloat(portfolioValue) <= 0}
                className="px-6 py-3 bg-accent text-background font-bold rounded-xl text-sm hover:bg-accent/80 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Calculate Trades
              </button>
            </div>
          </section>
        )}

        {/* Step 3: Results */}
        {step >= 3 && result && (
          <section className="bg-card rounded-2xl border border-card-border p-6">
            <h2 className="text-lg font-bold mb-1">Step 3: Trade Actions</h2>
            <p className="text-foreground/40 text-sm mb-4">
              Here&apos;s what you need to buy and sell to match the group
              portfolio. Non-Robinhood stocks have been excluded and weights
              redistributed proportionally.
            </p>
            <TradeActionList trades={result.trades} />
            <TradeTable result={result} />
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-card-border mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-foreground/20 text-xs">
          Citrini Tracker &mdash; Not financial advice. Always verify trades
          before executing.
        </div>
      </footer>
    </main>
  );
}
