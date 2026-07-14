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
import WmaScreenTab from "@/components/WmaScreenTab";
import ResearchTab from "@/components/ResearchTab";
import { loadWatchlist, saveWatchlist, DEFAULT_WATCHLIST } from "@/lib/watchlist";

const REFRESH_MS = 12000;

const TABS = [
  { id: "watchlist", label: "Watchlist" },
  { id: "indices", label: "Top Indices" },
  { id: "midcap", label: "Midcap Movers" },
  { id: "delivery", label: "Delivery Leaders" },
  { id: "wma", label: "30WMA Watch" },
  { id: "research", label: "Research" },
];

export default function Page() {
  const [activeTab, setActiveTab] = useState("watchlist");
  const [symbols, setSymbols] = useState(DEFAULT_WATCHLIST);
  const [quotes, setQuotes] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef(null);

  useEffect(() => {
    setSymbols(loadWatchlist());
  }, []);

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
      setQuotes(data.results || []);
      setLastUpdated(new Date());
      setError(null);
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

  function handleAdd(symbol) {
    const clean = symbol.trim().toUpperCase();
    if (!clean || symbols.includes(clean)) return;
    setSymbols((prev) => [...prev, clean]);
  }

  function handleRemove(symbol) {
    setSymbols((prev) => prev.filter((s) => s !== symbol));
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
        {activeTab === "watchlist" && <AddStock onAdd={handleAdd} existingSymbols={symbols} />}
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
                <WatchlistTable quotes={quotes} onRemove={handleRemove} />
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
        {activeTab === "delivery" && <DeliveryTab />}
        {activeTab === "wma" && <WmaScreenTab />}
        {activeTab === "research" && <ResearchTab />}
      </main>
    </div>
  );
}
