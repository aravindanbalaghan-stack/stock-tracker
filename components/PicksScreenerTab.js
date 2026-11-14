"use client";

// Screeners → Odds-ranked picks. The Home tab's short / mid / long lists,
// for any of the last ~50 sessions. The latest session is exactly what
// Home shows; a past session is re-ranked from the data as it stood at that
// day's close (lib/picks.js → getPicksScreener), with the move since.

import { useEffect, useState } from "react";
import { ScreenHeader, SubNav, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import SortableTh from "@/components/SortableTh";
import { StageTag } from "@/components/StageJourney";
import { StreakBadge, FirstShownCell } from "@/components/PickStreak";
import { useSortableRows } from "@/lib/useSortableRows";
import { usePersistentState } from "@/lib/usePersistentState";
import { formatDayLabel } from "@/lib/periodLabel";
import { fmt, fmtTurnover } from "@/lib/format";
import TableFrame from "@/components/ui/TableFrame";

function signed(v, d = 1) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${fmt(v, d)}%`;
}
const tone = (v) => (v == null ? "var(--text-faint)" : v >= 0 ? "var(--gain)" : "var(--loss)");
const HORIZON_TABS = [
  { id: "short", label: "Short term" },
  { id: "mid", label: "Mid term" },
  { id: "long", label: "Long term" },
];

function shortDay(d) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default function PicksScreenerTab({ onAddToWatchlist, watchlistSymbols }) {
  const [date, setDate] = usePersistentState("picksScreener.date", "");
  const [horizon, setHorizon] = usePersistentState("picksScreener.horizon", "mid");
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  const data = loaded.key === date ? loaded.data : null;
  const error = loaded.key === date ? loaded.error : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ section: "picks-screener" });
        if (date) qs.set("date", date);
        const res = await fetch(`/api/home?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail || json?.error || "Couldn't build the picks");
        if (!cancelled) setLoaded({ key: date, data: json, error: null });
      } catch (err) {
        if (!cancelled) setLoaded({ key: date, data: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const h = data?.horizons?.[horizon];
  const isPast = data && data.date !== data.latestDate;
  const { sorted, sort, onSort } = useSortableRows(h?.picks, "rank", "asc");

  const days = data?.tradingDays ?? [];
  const idx = data ? days.indexOf(data.date) : -1;
  const go = (d) => setDate(d === days[0] ? "" : d);

  const picker = (
    <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={idx === -1 || idx >= days.length - 1}
        onClick={() => go(days[idx + 1])}
        aria-label="Previous session"
      >
        ←
      </button>
      <label className="flex items-center gap-1.5">
        Date
        <select
          value={data?.date ?? ""}
          onChange={(e) => go(e.target.value)}
          disabled={!days.length}
          className="rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          {days.map((d, i) => (
            <option key={d} value={d}>
              {shortDay(d)}
              {i === 0 ? " (latest)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="px-2 py-1 rounded border disabled:opacity-30"
        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        disabled={idx <= 0}
        onClick={() => go(days[idx - 1])}
        aria-label="Next session"
      >
        →
      </button>
    </div>
  );

  return (
    <div>
      <ScreenHeader
        title="Odds-ranked picks"
        meta={
          data
            ? isPast
              ? `As ranked at the ${formatDayLabel(data.date)} close · moves measured to ${formatDayLabel(data.latestDate)}`
              : `Latest session · ${formatDayLabel(data.date)} — same lists as the Home tab`
            : "Short / mid / long-term lists for any of the last ~50 sessions"
        }
        actions={picker}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SubNav items={HORIZON_TABS} active={horizon} onChange={setHorizon} />
        {h && (
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            Hold {h.hold} · exit: {h.exitRule.toLowerCase()} · {h.eligible} stocks passed the gate
          </span>
        )}
      </div>

      <div className="mb-4">
        <InfoNote label="How past dates work">
          The latest session shows exactly what the Home tab shows. For a past session, every stock&apos;s weekly bars are cut off
          at that day&apos;s close (the in-progress week rebuilt from that week&apos;s NSE sessions) and re-ranked, so you see the
          list as it stood then, plus how each pick has moved since. &ldquo;First shown&rdquo; counts the weeks in a row the stock
          has been in this horizon&apos;s top 10 — the ranking is weekly, so it&apos;s rebuilt by re-ranking each past week. Turnover
          and delivery are for that session.
        </InfoNote>
      </div>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>Ranking the universe{date ? ` as of ${formatDayLabel(date)}` : ""} — the first load takes a little while.</LoadingState>
      ) : !h?.picks?.length ? (
        <EmptyState>No stock passed the {h?.label?.toLowerCase() ?? ""} gate on {formatDayLabel(data.date)}.</EmptyState>
      ) : (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <TableFrame name="picks-screener">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="#" sortKey="rank" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label="First shown" sortKey="weeksShown" sort={sort} onSort={onSort} title="Week the current run in this top 10 began" />
                  <SortableTh label={isPast ? "Close then" : "Close"} sortKey="close" sort={sort} onSort={onSort} />
                  {isPast && <SortableTh label="Since" sortKey="sincePct" sort={sort} onSort={onSort} title="Move from that session's close to the latest close" />}
                  <SortableTh label="Turnover" sortKey="turnoverCr" sort={sort} onSort={onSort} title="Traded value for the session" />
                  <SortableTh label="Score" sortKey="score" sort={sort} onSort={onSort} />
                  <SortableTh label="13w / 52w" sortKey="ret13Pct" sort={sort} onSort={onSort} />
                  <SortableTh label="From high" sortKey="fromHighPct" sort={sort} onSort={onSort} />
                  <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} title="Delivery % for the session (20-session average underneath)" />
                  <SortableTh label="Exit if" sortKey="exitLevel" sort={sort} onSort={onSort} />
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.symbol} className="border-b last:border-b-0 align-top" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2 font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {p.rank}
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <SymbolLink symbol={p.symbol} className="text-sm" />
                        <StreakBadge pick={p} horizonLabel={h.label} />
                      </span>
                      <span className="flex items-center gap-1 mt-1 flex-wrap">
                        <StageTag stage={p.stage} />
                        {p.alsoIn?.map((x) => (
                          <span key={x} className="text-[10px] px-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                            also {x}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      <FirstShownCell pick={p} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      ₹{fmt(p.close)}
                      <span className="block text-[11px]" style={{ color: tone(p.changePercent) }}>
                        {signed(p.changePercent, 2)}
                      </span>
                    </td>
                    {isPast && (
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: tone(p.sincePct) }}>
                        {signed(p.sincePct)}
                        {p.closeNow != null && (
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            ₹{fmt(p.closeNow)}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {fmtTurnover(p.turnoverCr)}
                    </td>
                    <td
                      className="py-2.5 px-2 text-right font-mono text-sm"
                      style={{ color: "var(--text)" }}
                      title={p.reasons
                        ?.slice(0, 3)
                        .map((r) => `${data.factorLabels?.[r.factor] ?? r.factor}: ${r.percentile}th percentile`)
                        .join("\n")}
                    >
                      {p.score}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <span style={{ color: tone(p.ret13Pct) }}>{signed(p.ret13Pct)}</span>
                      <span className="block" style={{ color: tone(p.ret52Pct) }}>
                        {signed(p.ret52Pct)}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {signed(p.fromHighPct)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {p.deliveryPct == null ? "—" : `${fmt(p.deliveryPct, 1)}%`}
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        20d {p.delivery20Pct == null ? "—" : `${fmt(p.delivery20Pct, 1)}%`}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--loss)" }} title={p.exitRule}>
                      {p.exitLevel == null ? "—" : `₹${fmt(p.exitLevel)}`}
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <WatchlistAddButton
                        symbol={p.symbol}
                        inWatchlist={watchlistSymbols?.includes(p.symbol)}
                        onAdd={onAddToWatchlist}
                        source={`Screener · Odds-ranked picks (${h.label})`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </div>
      )}
    </div>
  );
}
