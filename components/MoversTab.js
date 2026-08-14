"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import { usePersistentState } from "@/lib/usePersistentState";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import DatePicker from "@/components/DatePicker";
import SectorAssign from "@/components/SectorAssign";
import { formatDayLabel } from "@/lib/periodLabel";
import { ScreenHeader, Panel, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function vol(n) {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
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

// A pattern's worth is its lift, not its raw count. A setup appearing on
// 80% of the movers is worthless if it appears on 80% of everything.
function PatternPanel({ patterns, totals, criteria, coverage }) {
  return (
    <Panel className="mb-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Stock-days examined
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--text)" }}>
            {totals.observations.toLocaleString("en-IN")}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {coverage}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Moved +{criteria.threshold}%
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--gain)" }}>
            {totals.moves.toLocaleString("en-IN")}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Base rate
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--accent)" }}>
            {totals.baseRatePct}%
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            any stock, any day
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Lookback per setup
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--text)" }}>
            {criteria.lookback}d
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            ≈ 3 weeks before each move
          </span>
        </div>
      </div>

      <p className="text-[10px] uppercase tracking-wider mb-2 pt-3 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
        What preceded the moves — and how often that setup actually delivered
      </p>

      {patterns.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          No pattern appeared often enough in this window to report on.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider pb-1" style={{ color: "var(--text-faint)" }}>
            <span className="w-48 shrink-0">Pattern</span>
            <span className="flex-1" />
            <span className="w-16 text-right">Hit rate</span>
            <span className="w-14 text-right">Lift</span>
            <span className="w-24 text-right">Occurrences</span>
            <span className="w-24 text-right">Held up 5d</span>
          </div>
          {patterns.map((p) => {
            const useful = p.lift != null && p.lift >= 1.2;
            const noise = p.lift != null && p.lift >= 0.9 && p.lift < 1.2;
            return (
              <div key={p.tag} className="flex items-center gap-3 text-xs">
                <span className="w-48 shrink-0" style={{ color: "var(--text)" }}>
                  {p.tag}
                </span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: "var(--surface-3)" }}>
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${Math.min(100, ((p.lift ?? 0) / 2) * 100)}%`,
                      background: useful ? "var(--gain)" : noise ? "var(--accent)" : "var(--loss)",
                    }}
                  />
                </div>
                <span className="font-mono w-16 text-right" style={{ color: "var(--text-muted)" }}>
                  {p.hitRatePct}%
                </span>
                <span
                  className="font-mono w-14 text-right"
                  style={{ color: useful ? "var(--gain)" : noise ? "var(--text-faint)" : "var(--loss)" }}
                  title="Hit rate ÷ base rate. 1.0 means the pattern told you nothing."
                >
                  {p.lift == null ? "—" : `${p.lift}×`}
                </span>
                <span
                  className="font-mono w-24 text-right text-[11px]"
                  style={{ color: "var(--text-faint)" }}
                  title={`Appeared ${p.occurrences.toLocaleString("en-IN")} times; ${p.moves} were followed by a move`}
                >
                  {p.moves}/{p.occurrences.toLocaleString("en-IN")}
                </span>
                <span
                  className="font-mono w-24 text-right text-[11px]"
                  style={{ color: (p.medianForwardPct ?? 0) > 0 ? "var(--gain)" : "var(--text-faint)" }}
                  title={`Median move over the ${5} sessions after the jump, across ${p.forwardSample} cases`}
                >
                  {p.medianForwardPct == null ? "—" : `${p.medianForwardPct > 0 ? "+" : ""}${p.medianForwardPct}%`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--text-faint)" }}>
        <strong style={{ color: "var(--text-muted)" }}>Read the lift column, not the hit rate.</strong> Each
        pattern is measured against every stock-day in the window, not just the ones that moved — so
        &quot;occurrences&quot; is how often the setup appeared at all, and the hit rate is how often a move
        actually followed. A pattern common among movers but equally common everywhere scores 1.0× and is
        telling you nothing, however plausible it sounds. &quot;Held up 5d&quot; is the median move in the
        week after the jump: a pattern that produces one-day spikes which immediately give back is
        different from one that starts something. This describes a single window of one market — it is not
        a prediction, and patterns found by looking at past winners routinely fail to repeat.
      </p>
    </Panel>
  );
}

export default function MoversTab({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [threshold, setThreshold] = usePersistentState("movers.threshold", 4);
  const [windowDays, setWindowDays] = usePersistentState("movers.window", 22);
  const [asOfDate, setAsOfDate] = usePersistentState("movers.date", "");
  const [applied, setApplied] = usePersistentState("movers.applied", { threshold: 4, windowDays: 22 });
  const [patternFilter, setPatternFilter] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({
          threshold: String(applied.threshold),
          window: String(applied.windowDays),
        });
        if (asOfDate) qs.set("date", asOfDate);
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
  }, [applied, asOfDate]);

  const visible = patternFilter ? (data?.movers ?? []).filter((m) => m.tags.includes(patternFilter)) : data?.movers;
  const { sorted, sort, onSort } = useSortableRows(visible, "date", "desc");

  const controls = (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        Move ≥
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="0.5"
            min="1"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value) || 4)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>%</span>
        </div>
      </label>
      <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        Window
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="1"
            min="5"
            max="44"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) || 22)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>d</span>
        </div>
      </label>
      <button
        type="button"
        onClick={() => setApplied({ threshold: Number(threshold) || 4, windowDays: Number(windowDays) || 22 })}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium mb-0.5"
        style={{ background: "var(--accent)", color: "var(--surface)" }}
      >
        Apply
      </button>
      <DatePicker value={asOfDate} onChange={setAsOfDate} />
    </div>
  );

  if (error) {
    return (
      <div>
        <ScreenHeader title="Movers & pre-move patterns" actions={controls} />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <ScreenHeader title="Movers & pre-move patterns" actions={controls} />
        <LoadingState>
          Examining every stock-day in the window and reconstructing what the three weeks before each move
          looked like — this reads a couple of months of exchange data, so the first run takes a moment.
        </LoadingState>
      </div>
    );
  }

  const coverage = `${formatDayLabel(data.windowFirstDate)} – ${formatDayLabel(data.asOf)}`;

  return (
    <div>
      <ScreenHeader
        title="Movers & pre-move patterns"
        meta={`${data.moverCount.toLocaleString("en-IN")} moves of +${data.criteria.threshold}% or more · ${coverage}${
          data.dateAdjusted ? ` · ${data.requestedDate} wasn't a trading day` : ""
        }`}
        actions={controls}
      />

      <PatternPanel
        patterns={data.patterns}
        totals={data.totals}
        criteria={data.criteria}
        coverage={coverage}
      />

      {patternFilter && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Showing movers with pattern:
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded border"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            {patternFilter}
          </span>
          <button
            type="button"
            onClick={() => setPatternFilter(null)}
            className="text-[11px] px-1.5 py-0.5 rounded border"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Clear
          </button>
        </div>
      )}

      {!sorted || sorted.length === 0 ? (
        <EmptyState>
          No stock moved +{data.criteria.threshold}% in this window{patternFilter ? " with that pattern" : ""}.
        </EmptyState>
      ) : (
        <div
          className="rounded-[var(--radius)] border overflow-hidden"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="table-scroll">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Date" sortKey="date" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label="Moved" sortKey="movePct" sort={sort} onSort={onSort} />
                  <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                  <SortableTh label="Vol ×" sortKey="volumeRatio" sort={sort} onSort={onSort} title="Volume on the move day vs its own 21-day average" />
                  <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                  <SortableTh label="5d after" sortKey="forwardPct" sort={sort} onSort={onSort} title="How the stock moved in the five sessions after the jump" />
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-left" style={{ color: "var(--text-faint)" }}>
                    Sector
                  </th>
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-left" style={{ color: "var(--text-faint)" }}>
                    Pattern before the move
                  </th>
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={`${m.symbol}-${m.date}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2">
                      <SymbolLink symbol={m.symbol} className="text-sm" />
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {m.date}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--gain)" }}>
                      +{fmt(m.movePct)}%
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      ₹{fmt(m.close)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {m.volumeRatio == null ? "—" : `${fmt(m.volumeRatio)}×`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {m.deliveryPct == null ? "—" : `${fmt(m.deliveryPct)}%`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={m.forwardPct} />
                    </td>
                    <td className="py-2.5 px-2">
                      <SectorAssign symbol={m.symbol} sectors={m.sectors} />
                    </td>
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1">
                        {m.tags.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setPatternFilter(t)}
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap hover:opacity-80"
                            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                            title={`Show every mover with "${t}"`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <WatchlistAddButton
                        symbol={m.symbol}
                        inWatchlist={watchlistSymbols?.includes(m.symbol)}
                        onAdd={onAddToWatchlist}
                        source="Movers"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.truncated && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
          Showing the {data.movers.length} most recent of {data.moverCount.toLocaleString("en-IN")} moves.
          The pattern statistics above use all of them.
        </p>
      )}
    </div>
  );
}
