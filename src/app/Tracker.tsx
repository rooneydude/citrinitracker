"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";
import { parseGroupHoldings } from "@/lib/parseSpreadsheet";
import { parseRobinhoodCSV } from "@/lib/parseRobinhoodCSV";
import { rebalance, isAvailableOnRobinhood } from "@/lib/rebalance";
import { createClient } from "@/lib/supabase/client";
import {
  GroupHolding,
  RobinhoodHolding,
  RebalanceResult,
  TradeAction,
  BasketSummary,
  PlaidHoldingsResponse,
} from "@/lib/types";

export interface InitialUserState {
  groupHoldings: GroupHolding[];
  groupHoldingsParsedAt: number | null;
  excluded: string[];
  forceIncluded: string[];
  portfolioValue: string;
  rhHoldings: RobinhoodHolding[];
  plaidLastRefreshedAt: number | null;
}

interface TrackerProps {
  userId: string;
  userEmail: string;
  plaidInitiallyConnected: boolean;
  initialState: InitialUserState;
}

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
        {isDone ? "✓" : step}
      </div>
    </div>
  );
}

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

function PlaidConnectButton({
  onSuccess,
}: {
  onSuccess: (data: PlaidHoldingsResponse) => void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          onSuccess(data as PlaidHoldingsResponse);
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

function HoldingRowEdit({
  holding,
  onSave,
  onCancel,
}: {
  holding: RobinhoodHolding;
  onSave: (shares: number, price: number) => void;
  onCancel: () => void;
}) {
  const [sharesInput, setSharesInput] = useState(String(holding.shares));
  const [priceInput, setPriceInput] = useState(
    holding.currentPrice > 0 ? holding.currentPrice.toFixed(2) : ""
  );

  const commit = () => {
    const shares = parseFloat(sharesInput);
    const price = parseFloat(priceInput);
    if (!Number.isFinite(shares) || shares <= 0) return;
    onSave(shares, Number.isFinite(price) && price > 0 ? price : 0);
  };

  return (
    <div className="flex items-center gap-2 bg-card rounded-lg px-3 py-2 text-sm font-mono ring-1 ring-accent/40">
      <span className="text-accent font-bold min-w-[4rem]">
        {holding.ticker}
      </span>
      <input
        autoFocus
        type="number"
        step="any"
        value={sharesInput}
        onChange={(e) => setSharesInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="shares"
        className="flex-1 min-w-0 bg-background border border-card-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
      />
      <input
        type="number"
        step="any"
        value={priceInput}
        onChange={(e) => setPriceInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="price"
        className="flex-1 min-w-0 bg-background border border-card-border rounded px-2 py-1 text-sm font-mono text-foreground focus:outline-none focus:border-accent"
      />
      <button
        onClick={commit}
        className="px-2 py-1 bg-accent text-background font-semibold rounded text-xs hover:bg-accent/80"
      >
        Save
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 text-foreground/50 text-xs hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function HoldingRowDisplay({
  holding,
  onStartEdit,
  onRemove,
}: {
  holding: RobinhoodHolding;
  onStartEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="group flex justify-between items-center bg-card rounded-lg px-3 py-2 text-sm font-mono cursor-pointer hover:bg-card-border/20 transition"
      onClick={onStartEdit}
      title="Click to edit"
    >
      <span className="text-accent font-bold">{holding.ticker}</span>
      <span className="text-foreground/60">
        {holding.shares} shares
        {holding.currentPrice > 0 && ` @ $${holding.currentPrice.toFixed(2)}`}
        {holding.marketValue > 0 && (
          <span className="ml-2 text-foreground/40">
            = {formatDollar(holding.marketValue)}
          </span>
        )}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-red/60 hover:text-red ml-2"
        title="Remove"
      >
        x
      </button>
    </div>
  );
}

function RobinhoodInput({
  portfolioValue,
  setPortfolioValue,
  holdings,
  setHoldings,
  initiallyConnected,
  initialLastRefreshedAt,
}: {
  portfolioValue: string;
  setPortfolioValue: (v: string) => void;
  holdings: RobinhoodHolding[];
  setHoldings: (h: RobinhoodHolding[]) => void;
  initiallyConnected: boolean;
  initialLastRefreshedAt: number | null;
}) {
  const [csvText, setCsvText] = useState("");
  const [manualTicker, setManualTicker] = useState("");
  const [manualShares, setManualShares] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [plaidConnected, setPlaidConnected] = useState(initiallyConnected);
  const [plaidRefreshing, setPlaidRefreshing] = useState(false);
  const [plaidError, setPlaidError] = useState<string | null>(null);
  const [plaidLastRefreshedAt, setPlaidLastRefreshedAt] = useState<number | null>(
    initialLastRefreshedAt
  );

  const applyPlaidData = useCallback(
    (data: PlaidHoldingsResponse) => {
      setHoldings(data.holdings);
      if (data.portfolioValue > 0) {
        setPortfolioValue(data.portfolioValue.toFixed(2));
      }
      setPlaidLastRefreshedAt(Date.now());
    },
    [setHoldings, setPortfolioValue]
  );

  const handlePlaidSuccess = useCallback(
    (data: PlaidHoldingsResponse) => {
      applyPlaidData(data);
      setPlaidConnected(true);
      setPlaidError(null);
    },
    [applyPlaidData]
  );

  const refreshFromPlaid = useCallback(async () => {
    setPlaidRefreshing(true);
    setPlaidError(null);
    try {
      const res = await fetch("/api/plaid/holdings", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setPlaidError(data.error);
        if (data.connected === false) setPlaidConnected(false);
      } else if (data.connected === false) {
        setPlaidConnected(false);
      } else {
        applyPlaidData(data as PlaidHoldingsResponse);
        setPlaidConnected(true);
      }
    } catch {
      setPlaidError("Failed to refresh holdings");
    } finally {
      setPlaidRefreshing(false);
    }
  }, [applyPlaidData]);

  const disconnectPlaid = useCallback(async () => {
    try {
      await fetch("/api/plaid/disconnect", { method: "POST" });
    } catch {
      // Network error — UI still falls back to disconnected.
    }
    setPlaidConnected(false);
    setHoldings([]);
    setPlaidError(null);
    setPlaidLastRefreshedAt(null);
  }, [setHoldings]);

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    if (initiallyConnected) {
      refreshFromPlaid();
    }
  }, [initiallyConnected, refreshFromPlaid]);

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
    if (editingTicker === ticker) setEditingTicker(null);
  };

  const saveEdit = (ticker: string, shares: number, price: number) => {
    setHoldings(
      holdings.map((h) =>
        h.ticker === ticker
          ? {
              ...h,
              shares,
              currentPrice: price,
              marketValue: price > 0 ? shares * price : 0,
            }
          : h
      )
    );
    setEditingTicker(null);
  };

  return (
    <div className="space-y-6">
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
        <div
          className={`rounded-xl border p-3 space-y-2 ${
            plaidError
              ? "border-red/40 bg-red-dim"
              : "border-accent/30 bg-accent-dim"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span
                className={`text-sm font-semibold ${
                  plaidError ? "text-red" : "text-accent"
                }`}
              >
                {plaidRefreshing
                  ? "Refreshing Robinhood holdings…"
                  : plaidError
                    ? "Robinhood data may be stale"
                    : "Robinhood connected via Plaid"}
              </span>
              {plaidLastRefreshedAt ? (
                <span
                  className="text-foreground/40 text-xs mt-0.5"
                  title={new Date(plaidLastRefreshedAt).toLocaleString()}
                >
                  Last updated {formatTimeAgo(plaidLastRefreshedAt)}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshFromPlaid}
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
          <>
            <div className="mt-4 space-y-1">
              {holdings.map((h) =>
                editingTicker === h.ticker ? (
                  <HoldingRowEdit
                    key={h.ticker}
                    holding={h}
                    onSave={(shares, price) => saveEdit(h.ticker, shares, price)}
                    onCancel={() => setEditingTicker(null)}
                  />
                ) : (
                  <HoldingRowDisplay
                    key={h.ticker}
                    holding={h}
                    onStartEdit={() => setEditingTicker(h.ticker)}
                    onRemove={() => removeHolding(h.ticker)}
                  />
                )
              )}
            </div>
            {plaidConnected && (
              <p className="text-foreground/30 text-xs mt-2 italic">
                Click a row to edit share count (e.g. to fix an intraday trade
                Plaid hasn&apos;t picked up yet). Edits are overwritten on the
                next Plaid refresh.
              </p>
            )}
          </>
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

function BasketBreakdown({ summaries }: { summaries: BasketSummary[] }) {
  if (summaries.length === 0) return null;

  const maxWeight = Math.max(
    ...summaries.flatMap((b) => [b.currentWeight, b.targetWeight]),
    1
  );

  return (
    <div className="bg-card rounded-xl border border-card-border overflow-hidden">
      <div className="px-4 py-3 border-b border-card-border">
        <h3 className="text-sm font-bold text-foreground/60 uppercase tracking-wide">
          Basket Breakdown
        </h3>
        <p className="text-foreground/30 text-xs mt-0.5">
          Current vs. reweighted target, sorted by dollar distance.
        </p>
      </div>
      <div className="divide-y divide-card-border/50">
        {summaries.map((b) => {
          const delta = b.deltaValue;
          const isBuy = delta > 0;
          const isFlat = Math.abs(delta) < 0.5;
          const currentPct = (b.currentWeight / maxWeight) * 100;
          const targetPct = (b.targetWeight / maxWeight) * 100;
          return (
            <div
              key={b.basket}
              className="px-4 py-3 grid grid-cols-12 gap-3 items-center text-sm"
            >
              <div className="col-span-12 sm:col-span-3 flex items-center gap-2">
                <span className="font-semibold text-foreground truncate">
                  {b.basket}
                </span>
                {b.positionCount > 0 ? (
                  <span className="text-foreground/30 text-xs font-mono">
                    ({b.positionCount})
                  </span>
                ) : null}
              </div>
              <div className="col-span-12 sm:col-span-6 space-y-1">
                <div
                  className="flex items-center gap-2"
                  title={`Current: ${formatPct(b.currentWeight)} / ${formatDollar(b.currentValue)}`}
                >
                  <span className="text-foreground/40 text-xs w-10 shrink-0">
                    now
                  </span>
                  <div className="flex-1 h-2 bg-card-border/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-foreground/30 rounded"
                      style={{ width: `${currentPct}%` }}
                    />
                  </div>
                  <span className="text-foreground/60 font-mono text-xs w-12 text-right shrink-0">
                    {formatPct(b.currentWeight)}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2"
                  title={`Target: ${formatPct(b.targetWeight)} / ${formatDollar(b.targetValue)}`}
                >
                  <span className="text-foreground/40 text-xs w-10 shrink-0">
                    target
                  </span>
                  <div className="flex-1 h-2 bg-card-border/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-accent/60 rounded"
                      style={{ width: `${targetPct}%` }}
                    />
                  </div>
                  <span className="text-accent font-mono text-xs w-12 text-right shrink-0">
                    {formatPct(b.targetWeight)}
                  </span>
                </div>
              </div>
              <div className="col-span-12 sm:col-span-3 text-right font-mono text-sm">
                {isFlat ? (
                  <span className="text-foreground/30">balanced</span>
                ) : (
                  <span className={isBuy ? "text-accent" : "text-red"}>
                    {isBuy ? "+" : "-"}
                    {formatDollar(Math.abs(delta)).replace("-", "")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradeTable({ result }: { result: RebalanceResult }) {
  const buys = result.trades.filter((t) => t.action === "BUY");
  const allSells = result.trades.filter((t) => t.action === "SELL");
  const liquidations = allSells.filter((t) => t.basket === "Not in target");
  const rebalanceSells = allSells.filter((t) => t.basket !== "Not in target");

  const totalBuy = buys.reduce((s, t) => s + t.deltaValue, 0);
  const totalSell = allSells.reduce((s, t) => s + t.deltaValue, 0);

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
              {rebalanceSells.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={6}
                      className="py-2 px-3 text-red text-xs font-bold uppercase tracking-widest bg-red-dim/30"
                    >
                      Sells &mdash; Rebalance ({rebalanceSells.length})
                    </td>
                  </tr>
                  {rebalanceSells.map(renderRow)}
                </>
              )}
              {liquidations.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={6}
                      className="py-2 px-3 text-red text-xs font-bold uppercase tracking-widest bg-red-dim/30"
                      title="Current holdings that are not in the target portfolio. Sell to fully exit."
                    >
                      Sells &mdash; Liquidate / Not in target ({liquidations.length})
                    </td>
                  </tr>
                  {liquidations.map(renderRow)}
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

export default function Tracker({
  userId,
  userEmail,
  plaidInitiallyConnected,
  initialState,
}: TrackerProps) {
  const supabase = useMemo(() => createClient(), []);

  const [step, setStep] = useState(
    initialState.groupHoldings.length > 0 ? 2 : 1
  );
  const [groupHoldings, setGroupHoldings] = useState<GroupHolding[]>(
    initialState.groupHoldings
  );
  const [parsedAt, setParsedAt] = useState<number | null>(
    initialState.groupHoldingsParsedAt
  );
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(initialState.excluded)
  );
  const [forceIncluded, setForceIncluded] = useState<Set<string>>(
    () => new Set(initialState.forceIncluded)
  );
  const [portfolioValue, setPortfolioValue] = useState(initialState.portfolioValue);
  const [rhHoldings, setRhHoldings] = useState<RobinhoodHolding[]>(
    initialState.rhHoldings
  );

  const handleGroupParsed = useCallback((holdings: GroupHolding[]) => {
    setGroupHoldings(holdings);
    setParsedAt(Date.now());
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

  const toggleExcluded = useCallback((cleanTicker: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(cleanTicker)) next.delete(cleanTicker);
      else next.add(cleanTicker);
      return next;
    });
  }, []);

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
    setPortfolioValue("");
    setRhHoldings([]);
    setStep(1);
  }, []);

  // Single debounced sync of the whole user_state row. Writes the full
  // snapshot each time — the table has one row per user, writes are
  // user-paced, and snapshotting eliminates partial-update bugs when
  // multiple slices change in one tick. Skip the very first run: the
  // initial state was just loaded from the server.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const pv = parseFloat(portfolioValue);
      const portfolioForDb = Number.isFinite(pv) && pv > 0 ? pv : null;
      supabase
        .from("user_state")
        .upsert(
          {
            user_id: userId,
            group_holdings: groupHoldings,
            group_holdings_parsed_at: parsedAt
              ? new Date(parsedAt).toISOString()
              : null,
            excluded: [...excluded],
            force_included: [...forceIncluded],
            portfolio_value: portfolioForDb,
            rh_holdings: rhHoldings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        )
        .then(({ error }) => {
          if (error) {
            console.error("user_state sync failed:", error.message);
          }
        });
    }, 500);
    return () => clearTimeout(timer);
  }, [
    supabase,
    userId,
    groupHoldings,
    parsedAt,
    excluded,
    forceIncluded,
    portfolioValue,
    rhHoldings,
  ]);

  const result: RebalanceResult | null = useMemo(() => {
    const pv = parseFloat(portfolioValue);
    if (groupHoldings.length === 0 || !pv || pv <= 0) return null;
    return rebalance(groupHoldings, rhHoldings, pv, excluded, forceIncluded);
  }, [groupHoldings, rhHoldings, portfolioValue, excluded, forceIncluded]);

  const longCount = groupHoldings.filter((h) => h.isLong).length;
  const baskets = [...new Set(groupHoldings.map((h) => h.basket))];

  return (
    <main className="min-h-screen">
      <header className="border-b border-card-border bg-card/50">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-wrap items-center justify-between gap-4">
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
          <div className="flex items-center gap-3 text-xs">
            <span
              className="text-foreground/40 truncate max-w-[14rem]"
              title={userEmail}
            >
              {userEmail}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-foreground/40 hover:text-red transition"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
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
                initiallyConnected={plaidInitiallyConnected}
                initialLastRefreshedAt={initialState.plaidLastRefreshedAt}
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

        {step >= 3 && result && (
          <section className="bg-card rounded-2xl border border-card-border p-6">
            <h2 className="text-lg font-bold mb-1">Step 3: Trade Actions</h2>
            <p className="text-foreground/40 text-sm mb-4">
              Here&apos;s what you need to buy and sell to match the group
              portfolio. Non-Robinhood stocks have been excluded and weights
              redistributed proportionally.
            </p>
            <div className="space-y-6">
              <TradeActionList trades={result.trades} />
              <BasketBreakdown summaries={result.basketSummaries} />
              <TradeTable result={result} />
            </div>
          </section>
        )}
      </div>

      <footer className="border-t border-card-border mt-auto">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-foreground/20 text-xs">
          Citrini Tracker &mdash; Not financial advice. Always verify trades
          before executing.
        </div>
      </footer>
    </main>
  );
}
