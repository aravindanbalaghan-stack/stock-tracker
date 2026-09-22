"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import { usePersistentState } from "@/lib/usePersistentState";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import { formatDayLabel } from "@/lib/periodLabel";
import { ScreenHeader, Panel, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function Signed({ value, digits = 2 }) {
  if (value == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <span style={{ color: value >= 0 ? "var(--gain)" : "var(--loss)" }}>
      {value >= 0 ? "+" : ""}
      {fmt(value, digits)}%
    </span>
  );
}

function StatBlock({ label, value, tone, sub }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className="font-mono text-lg" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// A genuine walk-forward backtest panel — used for both scenario (a)
// Accumulation onset and scenario (b) Delivery streak. Every occurrence
// (the day the condition first became true) counts in the denominator,
// not just the ones that went on to do well — so a scenario that looks
// unremarkable here is being reported honestly, not filtered to flatter it.
function BacktestPanel({ scenario, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(scenario.events, "date", "desc");

  return (
    <Panel className="mb-4">
      <p className="font-display text-base mb-1" style={{ color: "var(--text)" }}>
        {scenario.label}
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        {scenario.description}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-4 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
        <StatBlock
          label="Occurrences"
          value={scenario.occurrences.toLocaleString("en-IN")}
          sub={`${scenario.resolvedOccurrences.toLocaleString("en-IN")} with a full ${10}-day forward read`}
        />
        <StatBlock
          label="Win rate"
          value={scenario.winRatePct == null ? "—" : `${scenario.winRatePct}%`}
          tone={scenario.winRatePct != null && scenario.winRatePct >= 50 ? "var(--gain)" : "var(--text)"}
          sub="closed higher 10 sessions later"
        />
        <StatBlock
          label="Median forward"
          value={scenario.medianForwardPct == null ? "—" : `${scenario.medianForwardPct > 0 ? "+" : ""}${scenario.medianForwardPct}%`}
          tone={(scenario.medianForwardPct ?? 0) > 0 ? "var(--gain)" : (scenario.medianForwardPct ?? 0) < 0 ? "var(--loss)" : undefined}
        />
        <StatBlock
          label="Average forward"
          value={scenario.avgForwardPct == null ? "—" : `${scenario.avgForwardPct > 0 ? "+" : ""}${scenario.avgForwardPct}%`}
          tone={(scenario.avgForwardPct ?? 0) > 0 ? "var(--gain)" : (scenario.avgForwardPct ?? 0) < 0 ? "var(--loss)" : undefined}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          No occurrences in this window.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                <SortableTh label="Date" sortKey="date" sort={sort} onSort={onSort} align="left" />
                <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                <SortableTh label="10d after" sortKey="forwardPct" sort={sort} onSort={onSort} title="Return from this event's close to the close 10 trading days later" />
                <th className="py-2 pl-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={`${e.symbol}-${e.date}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-2">
                    <SymbolLink symbol={e.symbol} className="text-sm" />
                  </td>
                  <td className="py-2 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {e.date}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                    ₹{fmt(e.close)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {e.deliveryPct == null ? "—" : `${fmt(e.deliveryPct)}%`}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs">
                    {e.forwardDays < 10 && e.forwardPct != null ? (
                      <span title={`Only ${e.forwardDays} of 10 forward sessions available yet`}>
                        <Signed value={e.forwardPct} />*
                      </span>
                    ) : (
                      <Signed value={e.forwardPct} />
                    )}
                  </td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    <WatchlistAddButton
                      symbol={e.symbol}
                      inWatchlist={watchlistSymbols?.includes(e.symbol)}
                      onAdd={onAddToWatchlist}
                      source="Movers"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {scenario.truncated && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
          Showing the 200 most recent of {scenario.occurrences.toLocaleString("en-IN")} occurrences. The stats
          above use all of them.
        </p>
      )}
      <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
        * fewer than 10 forward sessions have passed yet — this return isn&apos;t final.
      </p>
    </Panel>
  );
}

// Scenario (c) — NOT a backtest. See the route's own comment for why: it
// needs "how many times has this appeared in Pocket Pivot", which this
// app only started tracking once appearance logging shipped, so there's
// no history to backtest against yet. This is a live snapshot of today's
// qualifying stocks instead, and it fills in as more trading days pass.
function RepeatersPanel({ data, onAddToWatchlist, watchlistSymbols }) {
  const { sorted, sort, onSort } = useSortableRows(data.results, "performanceSinceCrossingPct", "desc");

  return (
    <Panel className="mb-4">
      <p className="font-display text-base mb-1" style={{ color: "var(--text)" }}>
        Pocket Pivot repeaters
      </p>
      <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
        Today&apos;s Pocket Pivot members that have appeared more than twice in the last 10 trading days,
        with delivery % above 60 — not a backtest like the two panels above (see the note below), a live
        list of stocks meeting all three conditions right now.
      </p>

      {data.note && (
        <p className="text-xs mb-3 px-3 py-2 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          {data.note}
        </p>
      )}

      {sorted.length > 0 && (
        <div className="table-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                <SortableTh
                  label="Appeared"
                  sortKey="appearanceCount"
                  sort={sort}
                  onSort={onSort}
                  title="Times in Pocket Pivot in the last 10 trading days — hover for the dates"
                />
                <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                <SortableTh
                  label="Since crossing"
                  sortKey="performanceSinceCrossingPct"
                  sort={sort}
                  onSort={onSort}
                  title="Return from its 3rd Pocket Pivot appearance in the window (the day it crossed 'more than twice') to today's close"
                />
                <th className="py-2 pl-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-2">
                    <SymbolLink symbol={r.symbol} className="text-sm" />
                  </td>
                  <td
                    className="py-2 px-2 text-right font-mono text-xs"
                    style={{ color: "var(--text-muted)" }}
                    title={`Appeared on: ${r.appearanceDates.join(", ")}`}
                  >
                    {r.appearanceCount}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                    ₹{fmt(r.close)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.deliveryPct == null ? "—" : `${fmt(r.deliveryPct)}%`}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-xs" title={`Since ${r.crossingDate}`}>
                    <Signed value={r.performanceSinceCrossingPct} />
                  </td>
                  <td className="py-2 pl-2 pr-4 text-right">
                    <WatchlistAddButton
                      symbol={r.symbol}
                      inWatchlist={watchlistSymbols?.includes(r.symbol)}
                      onAdd={onAddToWatchlist}
                      source="Movers · Pocket Pivot repeaters"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default function MoversTab({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [windowDays, setWindowDays] = usePersistentState("movers.window", 66);
  const [applied, setApplied] = usePersistentState("movers.applied", 66);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ window: String(applied) });
        const res = await fetch(`/api/movers?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't analyse movers");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied]);

  const controls = (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        Window
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="1"
            min="10"
            max="90"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) || 66)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>d</span>
        </div>
      </label>
      <button
        type="button"
        onClick={() => setApplied(Number(windowDays) || 66)}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium mb-0.5"
        style={{ background: "var(--accent)", color: "var(--surface)" }}
      >
        Apply
      </button>
    </div>
  );

  if (error) {
    return (
      <div>
        <ScreenHeader title="Movers" actions={controls} />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <ScreenHeader title="Movers" actions={controls} />
        <LoadingState>
          Walking back through the evaluation window for every liquid stock and checking each day against
          the accumulation and delivery-streak rules — this reads a few months of exchange data, so the
          first run takes a moment.
        </LoadingState>
      </div>
    );
  }

  const coverage = `${formatDayLabel(data.windowFirstDate)} – ${formatDayLabel(data.asOf)}`;

  return (
    <div>
      <ScreenHeader title="Movers" meta={coverage} actions={controls} />

      {(!data.scenarios.accumulation.occurrences && !data.scenarios.deliveryStreak.occurrences && !data.pocketPivotRepeaters.results.length) ? (
        <EmptyState>Nothing qualified under any of the three setups in this window.</EmptyState>
      ) : null}

      <BacktestPanel scenario={data.scenarios.accumulation} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      <BacktestPanel scenario={data.scenarios.deliveryStreak} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      <RepeatersPanel data={data.pocketPivotRepeaters} onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
    </div>
  );
}
