"use client";

import { Fragment, useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import DeliveryHistoryPanel from "@/components/DeliveryHistoryPanel";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

function deliveryTier(pct) {
  if (pct == null) return null;
  if (pct > 65) return { color: "var(--tier-high)", bg: "var(--tier-high-dim)" };
  if (pct >= 55) return { color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" };
  if (pct >= 45) return { color: "var(--tier-low)", bg: "var(--tier-low-dim)" };
  return null;
}

// Sector delivery % runs lower than the single-stock leaderboards by
// design — it's a volume-weighted average across an entire basket, not a
// cherry-picked high-delivery name — so the shading bands here are tuned
// lower than DeliveryTab's (>80/70/60) to still be meaningful at sector
// scale.
function DeliveryPctBadge({ pct }) {
  const tier = deliveryTier(pct);
  if (!tier) {
    return <span className="font-mono text-sm" style={{ color: "var(--gain)" }}>{pct == null ? "—" : `${fmt(pct)}%`}</span>;
  }
  return (
    <span className="font-mono text-sm px-1.5 py-0.5 rounded" style={{ color: tier.color, background: tier.bg }}>
      {fmt(pct)}%
    </span>
  );
}

// Per-stock breakdown shown inside an expanded sector row. Has its own
// sort state (harmless to keep independent — at most one sector is
// expanded at a time) and reuses the same expand-for-10-day-history
// pattern as Delivery Leaders, plus the watchlist add button.
function ConstituentTable({ rows, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(rows, "deliveryPct", "desc");
  const [expandedSymbol, setExpandedSymbol] = useState(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
            <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
            <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
            <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
            <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
            <SortableTh label="vs Avg Vol" sortKey="volumeRatio" sort={sort} onSort={onSort} />
            <th className="py-2 pl-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const up = (c.changePercent ?? 0) >= 0;
            const isExpanded = expandedSymbol === c.symbol;
            return (
              <Fragment key={c.symbol}>
                <tr
                  className="border-b last:border-b-0 cursor-pointer hover:bg-white/5"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setExpandedSymbol(isExpanded ? null : c.symbol)}
                >
                  <td className="py-2 pl-4 pr-2 font-mono text-xs" style={{ color: "var(--text)" }}>{c.symbol}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>₹{fmt(c.close)}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                    {c.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(c.changePercent)}%`}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>{fmt(c.deliveryPct)}%</td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(c.volume)}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                    {c.volumeRatio ? `${c.volumeRatio.toFixed(1)}×` : "—"}
                  </td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    <WatchlistAddButton
                      symbol={c.symbol}
                      inWatchlist={watchlistSymbols?.includes(c.symbol)}
                      onAdd={onAddToWatchlist}
                    />
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: "var(--surface-2)" }}>
                    <td colSpan={7} className="p-0">
                      <DeliveryHistoryPanel history={c.deliveryHistory} />
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

function SectorTable({ rows, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(rows, "deliveryPct", "desc");
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <SortableTh label="Sector" sortKey="name" sort={sort} onSort={onSort} align="left" className="pl-4" />
            <SortableTh label="Avg Chg %" sortKey="avgChangePercent" sort={sort} onSort={onSort} />
            <SortableTh label="Sector Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} title="Volume-weighted: total delivered ÷ total traded across the sector's stocks" />
            <SortableTh label="vs Avg Vol" sortKey="volumeRatio" sort={sort} onSort={onSort} />
            <SortableTh label="Stocks" sortKey="matchedCount" sort={sort} onSort={onSort} title="Constituents with data today, out of the sector's full list" />
            <th className="py-2 pl-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, i) => {
            const up = (s.avgChangePercent ?? 0) >= 0;
            const isExpanded = expanded === s.key;
            return (
              <Fragment key={s.key}>
                <tr
                  className="border-b last:border-b-0 cursor-pointer hover:bg-white/5"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setExpanded(isExpanded ? null : s.key)}
                >
                  <td className="py-2.5 pl-4 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs w-5" style={{ color: "var(--accent)" }}>{i + 1}</span>
                      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                    {s.avgChangePercent == null ? "—" : `${up ? "+" : ""}${fmt(s.avgChangePercent)}%`}
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <DeliveryPctBadge pct={s.deliveryPct} />
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                    {s.volumeRatio ? `${s.volumeRatio.toFixed(2)}×` : "—"}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {s.matchedCount}/{s.constituentCount}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {isExpanded ? "▲ hide" : "▼ details"}
                    </span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: "var(--surface-2)" }}>
                    <td colSpan={6} className="p-0">
                      <div className="border-b" style={{ borderColor: "var(--border)" }}>
                        <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                          10-day sector delivery %
                        </div>
                        <DeliveryHistoryPanel history={s.deliveryHistory} />
                      </div>
                      <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                        Constituent stocks
                      </div>
                      <ConstituentTable
                        rows={s.constituents}
                        onAddToWatchlist={onAddToWatchlist}
                        watchlistSymbols={watchlistSymbols}
                      />
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

export default function SectorDeliveryTab({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/sector-delivery");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load sector delivery screen");
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
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-lg" style={{ color: "var(--text)" }}>
          Sector Deliverability
        </h2>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          As of {data.asOf}
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
        Click a column header to sort · click a sector row for its 10-day trend and constituent stocks
      </p>

      <SectorTable rows={data.sectors} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Each sector&apos;s delivery % is volume-weighted — total shares delivered across the sector&apos;s
        stocks, divided by total shares traded — not a plain average of individual stock delivery %s, so one
        illiquid name can&apos;t swing the number as much as the sector&apos;s most-traded stock. Sectors are
        the standard NSE sectoral indices (Bank, IT, Auto, Pharma, FMCG, Metal, Realty, Energy, PSU Bank,
        Financial Services); note some stocks belong to more than one — e.g. banks count toward both
        &quot;Bank&quot; and &quot;Financial Services&quot; — since that&apos;s how NSE defines those indices.
        Constituent lists are the same hand-maintained snapshots used on the Top Indices tab.
      </p>
    </div>
  );
}
