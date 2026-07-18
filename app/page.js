"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TickerTape from "@/components/TickerTape";
import AddStock from "@/components/AddStock";
import WatchlistTable from "@/components/WatchlistTable";
import AlertsPanel from "@/components/AlertsPanel";
import TabBar from "@/components/TabBar";
import IndicesTab from "@/components/IndicesTab";
import MidcapVolumeTab from "@/components/MidcapVolumeTab";
import DeliveryTab from "@/components/DeliveryTab";
import BreakoutsTab from "@/components/BreakoutsTab";
import WmaScreenTab from "@/components/WmaScreenTab";
import ResearchTab from "@/components/ResearchTab";
import { loadWatchlist, saveWatchlist, loadWatchlistMeta, saveWatchlistMeta } from "@/lib/watchlist";
import { readIdentityCookie } from "@/lib/identity";

const REFRESH_MS = 12000;

const TABS = [
  { id: "watchlist", label: "Watchlist" },
  { id: "indices", label: "Top Indices" },
  { id: "midcap", label: "Midcap Movers" },
  { id: "delivery", label: "Delivery Leaders" },
  { id: "breakouts", label: "Breakouts" },
  { id: "wma", label: "30WMA Watch" },
  { id: "research", label: "Research" },
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

      <header className="px-4 md:px-8 pt-8 pb-4 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full" style={{ background: marketOpenGuess ? "var(--gain)" : "var(--text-faint)" }} />
            <span className="text-xs uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
              {marketOpenGuess ? "Market open" : "Market closed"} · NSE
            </span>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-semibold" style={{ color: "var(--text)" }}>
            Panel
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {identity && (
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>Signed in as <span style={{ color: "var(--text)" }}>{identity}</span></span>
              <button onClick={handleLogout} style={{ color: "var(--text-faint)" }}>Sign out</button>
            </div>
          )}
          {activeTab === "watchlist" && <AddStock onAdd={handleAdd} existingSymbols={symbols} />}
        </div>
      </header>

      <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <main className="flex-1 px-4 md:px-8 py-6">
        {activeTab === "watchlist" && (
          <>
            {error && (
              <div
                className="mb-4 rounded-md border px-4 py-3 text-sm"
                style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}
              >
                {error} — retrying automatically.
              </div>
            )}
            {loading && quotes.length === 0 ? (
              <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                Loading live prices…
              </div>
            ) : (
              <>
                <AlertsPanel availableSymbols={symbols} />
                <WatchlistTable quotes={quotes} meta={meta} onRemove={handleRemove} onNotesChange={handleNotesChange} />
              </>
            )}
            <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
              {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-IN")}` : ""} · Data via
              Yahoo Finance, delayed by exchange feed terms — not for trading decisions.
            </p>
          </>
        )}

        {activeTab === "indices" && <IndicesTab />}
        {activeTab === "midcap" && <MidcapVolumeTab />}
        {activeTab === "delivery" && (
          <DeliveryTab onAddToWatchlist={handleAdd} watchlistSymbols={symbols} />
        )}
        {activeTab === "breakouts" && (
          <BreakoutsTab onAddToWatchlist={handleAdd} watchlistSymbols={symbols} />
        )}
        {activeTab === "wma" && <WmaScreenTab />}
        {activeTab === "research" && <ResearchTab />}
      </main>
    </div>
  );
}
