"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import WatchlistAddButton from "@/components/WatchlistAddButton";

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

// Shown when a row (or the search result) is expanded — the last 10
// trading days of delivery % and volume for that symbol.
function HistoryPanel({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
        No recent history available.
      </div>
    );
  }
  return (
    <div className="px-4 py-3 overflow-x-auto">
      <div className="flex gap-4 min-w-max">
        {history.map((d) => (
          <div key={d.date} className="flex flex-col items-center min-w-[64px]">
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
              {d.date.slice(5)}
            </span>
            <span className="font-mono text-xs mt-1" style={{ color: "var(--text)" }}>
              {d.deliveryPct == null ? "—" : `${fmt(d.deliveryPct)}%`}
            </span>
            <span className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {fmtVolume(d.volume)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultTable({ rows, showCap, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(rows, "deliveryPct", "desc");
  const [expanded, setExpanded] = useState(null);

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
            <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
            <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
            <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
            <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
            {showCap && <SortableTh label="Market Cap" sortKey="marketCapCr" sort={sort} onSort={onSort} />}
            {showCap && <SortableTh label="30WMA" sortKey="wma30" sort={sort} onSort={onSort} />}
            <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
            <SortableTh label="vs Avg Vol" sortKey="volumeRatio" sort={sort} onSort={onSort} />
            <SortableTh label="Days accum. (20d)" sortKey="daysOfAccumulation" sort={sort} onSort={onSort} />
            <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>In accumulation?</th>
            <th className="py-2 pl-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const up = (r.changePercent ?? 0) >= 0;
            const isExpanded = expanded === r.symbol;
            return (
              <Fragment key={r.symbol}>
                <tr
                  className="border-b last:border-b-0 cursor-pointer hover:bg-white/5"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setExpanded(isExpanded ? null : r.symbol)}
                >
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
                  {showCap && (
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.wma30 == null ? "—" : `₹${fmt(r.wma30)}`}
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
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <WatchlistAddButton
                      symbol={r.symbol}
                      inWatchlist={watchlistSymbols?.includes(r.symbol)}
                      onAdd={onAddToWatchlist}
                    />
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: "var(--surface-2)" }}>
                    <td colSpan={showCap ? 11 : 9} className="p-0">
                      <HistoryPanel history={r.deliveryHistory} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchResult({ result, onClear, onAddToWatchlist, watchlistSymbols }) {
  const [expanded, setExpanded] = useState(false);
  if (!result) return null;
  const up = (result.changePercent ?? 0) >= 0;
  return (
    <div className="mb-6 rounded-lg border overflow-hidden" style={{ borderColor: "var(--accent)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="text-xs uppercase tracking-wider" style={{ color: "var(--accent)" }}>Search result</span>
        <div className="flex items-center gap-3">
          <WatchlistAddButton
            symbol={result.symbol}
            inWatchlist={watchlistSymbols?.includes(result.symbol)}
            onAdd={onAddToWatchlist}
          />
          <button onClick={onClear} className="text-xs" style={{ color: "var(--text-faint)" }}>Clear</button>
        </div>
      </div>
      <div
        className="p-4 flex flex-wrap gap-x-8 gap-y-3 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
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
        {result.category === "stock" && (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>30WMA</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
              {result.wma30 == null ? "—" : `₹${fmt(result.wma30)}`}
            </span>
          </div>
        )}
        <div className="flex items-end">
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {expanded ? "▲ hide 10-day history" : "▼ show 10-day history"}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="border-t" style={{ borderColor: "var(--border)" }}>
          <HistoryPanel history={result.deliveryHistory} />
        </div>
      )}
    </div>
  );
}

// Search box with live suggestions — mirrors AddStock's autocomplete
// pattern (debounced /api/search lookup) instead of requiring an exact
// symbol before anything happens.
function DeliverySearchBox({ onPick, query, setQuery }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pick(symbol) {
    onPick(symbol);
    setResults([]);
    setOpen(false);
  }

  function handleManualSearch(e) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (sym) pick(sym);
  }

  return (
    <div className="relative w-56" ref={boxRef}>
      <form onSubmit={handleManualSearch}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search any stock — e.g. WIPRO"
          className="rounded px-3 py-1.5 text-sm font-mono w-full outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </form>

      {open && query.trim() && (
        <div
          className="absolute z-10 mt-1 w-full rounded-md border shadow-lg overflow-hidden"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
        >
          {loading && (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <button
              type="button"
              onClick={handleManualSearch}
              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              Search “{query.trim().toUpperCase()}” anyway
            </button>
          )}
          {results.map((r) => (
            <button
              type="button"
              key={`${r.symbol}-${r.exchange}`}
              onClick={() => pick(r.symbol)}
              className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5"
            >
              <span className="flex flex-col text-left">
                <span className="font-mono" style={{ color: "var(--text)" }}>{r.symbol}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>{r.name}</span>
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                {r.exchange}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DeliveryTab({ onAddToWatchlist, watchlistSymbols }) {
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

  async function runSearch(symbol) {
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/delivery?symbol=${encodeURIComponent(clean)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Search failed");
      setSearchResult(json.result);
      setQuery(clean);
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

      <div className="mb-4 flex items-center gap-2">
        <DeliverySearchBox onPick={runSearch} query={query} setQuery={setQuery} />
        {searching && <span className="text-xs" style={{ color: "var(--text-faint)" }}>Searching…</span>}
      </div>

      {searchError && (
        <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
          {searchError}
        </div>
      )}
      <SearchResult
        result={searchResult}
        onClear={() => { setSearchResult(null); setSearchError(null); setQuery(""); }}
        onAddToWatchlist={onAddToWatchlist}
        watchlistSymbols={watchlistSymbols}
      />

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
        <span className="ml-auto" style={{ color: "var(--text-faint)" }}>
          Click a column header to sort · click a row for its 10-day history
        </span>
      </div>

      {category === "stocks" ? (
        <ResultTable rows={data.stocks} showCap onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      ) : (
        <ResultTable rows={data.other} showCap={false} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Showing every {category === "stocks" ? "stock" : "ETF/REIT/InvIT"} with delivery % above{" "}
        {data.criteria?.deliveryPctMin ?? 60}%, sorted by delivery % descending by default — click any
        column header to re-sort.
        &quot;In accumulation&quot; is a separate heuristic: delivery % above{" "}
        {data.criteria?.accumulationDeliveryThreshold ?? 50}% on at least{" "}
        {data.criteria?.accumulationMinDays ?? 10} of the last {data.criteria?.accumulationWindow ?? 20} trading
        days, price flat-to-up over that window, and volume above the 30-day average — not a confirmed
        institutional signal. ETF/REIT/InvIT classification is name-pattern based. Market cap and 30WMA are only looked
        up for the top {data.criteria?.marketCapLookupCap ?? 60} rows by delivery % (NSE&apos;s and Yahoo&apos;s lookups
        are rate-limited); beyond that, or if a lookup fails for a specific stock, it shows as &quot;—&quot; rather than
        being dropped.
      </p>
    </div>
  );
}
