"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TickerTape from "@/components/TickerTape";
import AddStock from "@/components/AddStock";
import WatchlistTable from "@/components/WatchlistTable";
import AlertsPanel from "@/components/AlertsPanel";
import TabBar from "@/components/TabBar";
import GlobalSearch from "@/components/GlobalSearch";
import StockDetailDrawer from "@/components/StockDetailDrawer";
import MarketScreen from "@/components/screens/MarketScreen";
import DeliveryScreen from "@/components/screens/DeliveryScreen";
import ScreenersScreen from "@/components/screens/ScreenersScreen";
import NiftyBankTab from "@/components/NiftyBankTab";
import { ScreenHeader, ErrorState, LoadingState } from "@/components/ui/Chrome";
import { loadWatchlist, saveWatchlist, loadWatchlistMeta, saveWatchlistMeta } from "@/lib/watchlist";
import { readIdentityCookie } from "@/lib/identity";

const REFRESH_MS = 12000;

// Five tabs, down from nine. Closely-related screens now live together
// behind sub-navigation (see components/screens/) rather than competing
// for space in one long row: Market = indices + midcap movers, Delivery =
// by-stock + by-sector, Screeners = breakouts + 30WMA. The old Research
// tab is gone — its useful parts are now the stock detail drawer, opened
// from the header search or any watchlist row.
const TABS = [
  { id: "watchlist", label: "Watchlist" },
  { id: "market", label: "Market" },
  { id: "delivery", label: "Delivery" },
  { id: "screeners", label: "Screeners" },
  { id: "niftybank", label: "Bank Nifty" },
];

export default function Page() {
  const [activeTab, setActiveTab] = useState("watchlist");
  // Lazy initializer instead of DEFAULT_WATCHLIST + a mount effect — reads
  // localStorage during the initial render (loadWatchlist() already guards
  // for the server/no-window case), so there's no longer an extra render
  // right after mount just to swap in the saved list.
  const [symbols, setSymbols] = useState(() => loadWatchlist());
  // Per-symbol metadata: price when added + personal notes. Same lazy-init
  // approach, same reasoning.
  const [meta, setMeta] = useState(() => loadWatchlistMeta());
  const [quotes, setQuotes] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState(() => readIdentityCookie());
  const [detailSymbol, setDetailSymbol] = useState(null);
  const pollRef = useRef(null);

  const fetchQuotes = useCallback(async (syms) => {
    if (!syms || syms.length === 0) {
      setQuotes([]);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/quote?symbols=${encodeURIComponent(syms.join(","))}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to fetch quotes");
      const results = data.results || [];
      setQuotes(results);
      setLastUpdated(new Date());
      setError(null);

      // Backfill "added price" for any symbol that doesn't have one yet
      // (freshly added, or added before this feature existed). Doing this
      // off the regular quote poll — rather than a one-off fetch at
      // add-time — means a single flaky request can't permanently leave a
      // symbol without an added price; it just fills in on the next
      // successful poll, usually within a few seconds.
      setMeta((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const q of results) {
          const entry = next[q.symbol];
          if (entry && entry.addedPrice == null && q.price != null) {
            next[q.symbol] = { ...entry, addedPrice: q.price };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    } catch (err) {
      setError(err.message || "Could not reach the market data service");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    saveWatchlist(symbols);
    setLoading(true);
    fetchQuotes(symbols);

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchQuotes(symbols), REFRESH_MS);
    return () => clearInterval(pollRef.current);
  }, [symbols, fetchQuotes]);

  useEffect(() => {
    saveWatchlistMeta(meta);
  }, [meta]);

  function handleAdd(symbol) {
    const clean = symbol.trim().toUpperCase();
    if (!clean || symbols.includes(clean)) return;
    setSymbols((prev) => [...prev, clean]);
    setMeta((prev) => ({ ...prev, [clean]: { addedPrice: null, notes: "" } }));
  }

  function handleRemove(symbol) {
    setSymbols((prev) => prev.filter((s) => s !== symbol));
    setMeta((prev) => {
      if (!(symbol in prev)) return prev;
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }

  function handleNotesChange(symbol, notes) {
    setMeta((prev) => ({
      ...prev,
      [symbol]: { addedPrice: prev[symbol]?.addedPrice ?? null, notes },
    }));
  }

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      setIdentity(null);
      window.location.href = "/login";
    }
  }

  const marketOpenGuess = (() => {
    const now = new Date();
    const istHour = (now.getUTCHours() + 5) % 24;
    const istMin = now.getUTCMinutes() + 30;
    const minutesSinceMidnight = istHour * 60 + istMin;
    return minutesSinceMidnight >= 555 && minutesSinceMidnight <= 930;
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <TickerTape quotes={quotes} />

      <header className="px-4 md:px-8 pt-6 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--text)" }}>
            Panel
          </h1>
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: marketOpenGuess ? "var(--gain)" : "var(--text-faint)" }}
            />
            <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              NSE {marketOpenGuess ? "open" : "closed"}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <GlobalSearch onSelect={setDetailSymbol} />
          {identity && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="hidden md:inline">{identity}</span>
              <button onClick={handleLogout} style={{ color: "var(--text-faint)" }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <main className="flex-1 px-4 md:px-8 py-6">
        {activeTab === "watchlist" && (
          <>
            <ScreenHeader
              title="Watchlist"
              meta={
                lastUpdated
                  ? `${symbols.length} stock${symbols.length === 1 ? "" : "s"} · updated ${lastUpdated.toLocaleTimeString("en-IN")}`
                  : `${symbols.length} stock${symbols.length === 1 ? "" : "s"}`
              }
              actions={<AddStock onAdd={handleAdd} existingSymbols={symbols} />}
            />

            {error && <div className="mb-4"><ErrorState>{error} — retrying automatically.</ErrorState></div>}

            {loading && quotes.length === 0 ? (
              <LoadingState>Loading live prices…</LoadingState>
            ) : (
              <>
                <AlertsPanel availableSymbols={symbols} />
                <WatchlistTable
                  quotes={quotes}
                  meta={meta}
                  onRemove={handleRemove}
                  onNotesChange={handleNotesChange}
                  onOpenDetail={setDetailSymbol}
                />
              </>
            )}

            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              Prices via Yahoo Finance, delayed per exchange feed terms — not for trading decisions.
            </p>
          </>
        )}

        {activeTab === "market" && <MarketScreen />}
        {activeTab === "delivery" && (
          <DeliveryScreen onAddToWatchlist={handleAdd} watchlistSymbols={symbols} />
        )}
        {activeTab === "screeners" && (
          <ScreenersScreen
            onAddToWatchlist={handleAdd}
            watchlistSymbols={symbols}
            onOpenDetail={setDetailSymbol}
          />
        )}
        {activeTab === "niftybank" && <NiftyBankTab />}
      </main>

      <StockDetailDrawer
        symbol={detailSymbol}
        onClose={() => setDetailSymbol(null)}
        onAddToWatchlist={handleAdd}
        inWatchlist={detailSymbol ? symbols.includes(detailSymbol) : false}
      />
    </div>
  );
}
