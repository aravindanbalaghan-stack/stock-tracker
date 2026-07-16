"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtCap(cr) {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)}L Cr`;
  return `₹${fmt(cr, 0)} Cr`;
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

function deliveryTier(pct) {
  if (pct == null) return null;
  if (pct > 80) return { color: "var(--tier-high)", bg: "var(--tier-high-dim)" };
  if (pct >= 70) return { color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" };
  if (pct >= 60) return { color: "var(--tier-low)", bg: "var(--tier-low-dim)" };
  return null;
}

function DeliveryPctBadge({ pct }) {
  const tier = deliveryTier(pct);
  if (!tier) {
    return <span className="font-mono text-sm" style={{ color: "var(--gain)" }}>{fmt(pct)}%</span>;
  }
  return (
    <span
      className="font-mono text-sm px-1.5 py-0.5 rounded"
      style={{ color: tier.color, background: tier.bg }}
    >
      {fmt(pct)}%
    </span>
  );
}

function ResultTable({ rows, showCap }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
        No stocks currently clear the filters in this category.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Symbol</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Close</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Chg %</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Deliv. %</th>
            {showCap && (
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Market Cap</th>
            )}
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Volume</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>vs Avg Vol</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Days accum. (20d)</th>
            <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>In accumulation?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const up = (r.changePercent ?? 0) >= 0;
            return (
              <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2.5 pl-4 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-5" style={{ color: "var(--accent)" }}>{i + 1}</span>
                    <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{r.symbol}</span>
                  </div>
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.close)}</td>
                <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                  {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                </td>
                <td className="py-2.5 px-2 text-right">
                  <DeliveryPctBadge pct={r.deliveryPct} />
                </td>
                {showCap && (
                  <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {fmtCap(r.marketCapCr)}
                  </td>
                )}
                <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                  {fmtVolume(r.volume)}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                  {r.volumeRatio ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                </td>
                <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                  {r.daysOfAccumulation}/{r.accumulationWindowDays}
                </td>
                <td className="py-2.5 pl-2 pr-4">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded border"
                    style={{
                      borderColor: r.inAccumulation ? "var(--gain)" : "var(--border)",
                      color: r.inAccumulation ? "var(--gain)" : "var(--text-faint)",
                    }}
                  >
                    {r.inAccumulation ? "Yes" : "No"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchResult({ result, onClear }) {
  if (!result) return null;
  const up = (result.changePercent ?? 0) >= 0;
  return (
    <div className="mb-6 rounded-lg border overflow-hidden" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--accent)" }}>Search result</span>
        <button onClick={onClear} className="text-xs" style={{ color: "var(--text-faint)" }}>Clear</button>
      </div>
      <div className="p-4 flex flex-wrap gap-x-8 gap-y-3">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Symbol</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{result.symbol}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Close</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(result.close)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Chg %</span>
          <span className="font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
            {result.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(result.changePercent)}%`}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Delivery %</span>
          <span><DeliveryPctBadge pct={result.deliveryPct} /></span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Volume</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmtVolume(result.volume)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>vs Avg Volume</span>
          <span className="font-mono text-sm" style={{ color: "var(--accent)" }}>
            {result.volumeRatio ? `${result.volumeRatio.toFixed(2)}×` : "—"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Days accum. (20d)</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
            {result.daysOfAccumulation}/{result.accumulationWindowDays}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>In accumulation?</span>
          <span className="text-sm" style={{ color: result.inAccumulation ? "var(--gain)" : "var(--text-faint)" }}>
            {result.inAccumulation ? "Yes" : "No"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Category</span>
          <span className="text-sm" style={{ color: "var(--text)" }}>
            {result.category === "other" ? "ETF / REIT / InvIT" : "Stock"}
          </span>
        </div>
        {result.category === "stock" && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Market cap</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmtCap(result.marketCapCr)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DeliveryTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [category, setCategory] = useState("stocks"); // "stocks" | "other"

  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/delivery");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load delivery screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function handleSearch(e) {
    e.preventDefault();
    const symbol = query.trim().toUpperCase();
    if (!symbol) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/delivery?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Search failed");
      setSearchResult(json.result);
    } catch (err) {
      setSearchError(err.message);
      setSearchResult(null);
    } finally {
      setSearching(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Pulling NSE data — this can take a moment the first time…
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-lg" style={{ color: "var(--text)" }}>
          Delivery leaders
        </h2>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          As of {data.asOf}
        </span>
      </div>

      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          placeholder="Search any stock — e.g. WIPRO"
          className="rounded px-3 py-1.5 text-sm font-mono w-56 outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        <button
          type="submit"
          disabled={searching}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: "var(--accent)", color: "var(--bg)" }}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {searchError && (
        <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
          {searchError}
        </div>
      )}
      <SearchResult result={searchResult} onClear={() => { setSearchResult(null); setSearchError(null); setQuery(""); }} />

      <div className="flex gap-1 mb-3 border-b" style={{ borderColor: "var(--border)" }}>
        {[
          { id: "stocks", label: "Stocks" },
          { id: "other", label: "Other (ETFs, REITs, InvITs)" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setCategory(t.id)}
            className="px-3 py-2 text-sm border-b-2"
            style={{
              borderColor: category === t.id ? "var(--accent)" : "transparent",
              color: category === t.id ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--tier-high)" }} />
          &gt; 80% delivery
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--tier-mid)" }} />
          70–80% delivery
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--tier-low)" }} />
          60–70% delivery
        </span>
      </div>

      {category === "stocks" ? (
        <ResultTable rows={data.stocks} showCap />
      ) : (
        <ResultTable rows={data.other} showCap={false} />
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Showing every {category === "stocks" ? "stock" : "ETF/REIT/InvIT"} with delivery % above{" "}
        {data.criteria?.deliveryPctMin ?? 60}%, sorted by delivery % descending.
        &quot;In accumulation&quot; is a separate heuristic: delivery % above{" "}
        {data.criteria?.accumulationDeliveryThreshold ?? 50}% on at least{" "}
        {data.criteria?.accumulationMinDays ?? 10} of the last {data.criteria?.accumulationWindow ?? 20} trading
        days, price flat-to-up over that window, and volume above the 30-day average — not a confirmed
        institutional signal. ETF/REIT/InvIT classification is name-pattern based. Market cap is only looked up
        for the top {data.criteria?.marketCapLookupCap ?? 60} rows by delivery % (NSE&apos;s lookup is rate-limited);
        beyond that, or if NSE&apos;s lookup fails for a specific stock, it shows as &quot;—&quot; rather than being dropped.
      </p>
    </div>
  );
}
