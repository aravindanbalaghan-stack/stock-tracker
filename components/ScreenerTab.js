"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { SCREENS, CONFLUENCE_SCREEN, CONFLUENCE_DEF } from "@/lib/screens";
import NumericFilters from "@/components/NumericFilters";
import { EMPTY_NUMERIC_FILTERS, applyNumericFilters, hasActiveNumericFilters } from "@/lib/rowFilters";
import { ScreenHeader, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import { DebutHeaderCells, DebutCells } from "@/components/DebutCells";
import SymbolLink from "@/components/SymbolLink";
import { formatDayLabel } from "@/lib/periodLabel";

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// The API keeps a month of trading days behind the chosen date, so the
// picker is bounded to roughly a calendar month back.
function earliestSelectable() {
  const d = new Date();
  d.setDate(d.getDate() - 31);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

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

function fmtCap(cr) {
  if (cr == null) return "—";
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)}L Cr`;
  return `₹${fmt(cr, 0)} Cr`;
}

// Same delivery-% shading as the Delivery screens, so the colour means the
// same thing everywhere in the app.
function deliveryTier(pct) {
  if (pct == null) return null;
  if (pct > 80) return { color: "var(--tier-high)", bg: "var(--tier-high-dim)" };
  if (pct >= 70) return { color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" };
  if (pct >= 60) return { color: "var(--tier-low)", bg: "var(--tier-low-dim)" };
  return null;
}

function DeliveryPctCell({ pct }) {
  const tier = deliveryTier(pct);
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  if (!tier) {
    return (
      <span className="font-mono text-sm" style={{ color: "var(--text-muted)" }}>
        {fmt(pct)}%
      </span>
    );
  }
  return (
    <span className="font-mono text-sm px-1.5 py-0.5 rounded" style={{ color: tier.color, background: tier.bg }}>
      {fmt(pct)}%
    </span>
  );
}

// Whether the stock finished the session above or below where it opened —
// direction stated in words (that's the question being asked) with the
// size of the move alongside it.
function VsOpenCell({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const above = pct >= 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs font-medium" style={{ color: above ? "var(--gain)" : "var(--loss)" }}>
        {above ? "▲ Above" : "▼ Below"}
      </span>
      <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
        {above ? "+" : ""}
        {fmt(pct)}%
      </span>
    </span>
  );
}

// Shown when a Stage 2 row is expanded. Each entry is labelled with whose
// method it comes from, because Weinstein and Wyckoff would have bought at
// different points in the same move.
function StageEntriesPanel({ row }) {
  if (!row.entries?.length) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
        No entry points could be reconstructed for this stock.
      </div>
    );
  }
  const stanceColor = {
    Aggressive: "var(--loss)",
    Standard: "var(--accent)",
    Conservative: "var(--gain)",
    "Add-on": "var(--tier-low)",
  };
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>
          Base: <span className="font-mono" style={{ color: "var(--text)" }}>₹{fmt(row.baseSupport)} – ₹{fmt(row.baseResistance)}</span>{" "}
          over {row.baseWeeks} weeks
        </span>
        <span>
          30-week MA slope:{" "}
          <span className="font-mono" style={{ color: row.ma30SlopePct >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {row.ma30SlopePct >= 0 ? "+" : ""}
            {fmt(row.ma30SlopePct)}%
          </span>{" "}
          over 4 weeks
        </span>
        {row.breakoutVolumeRatio != null && (
          <span>
            Breakout volume:{" "}
            <span className="font-mono" style={{ color: "var(--accent)" }}>{row.breakoutVolumeRatio}×</span> the prior
            50-day average
          </span>
        )}
        {row.rsVsBenchmark != null && (
          <span>
            26-week RS vs NIFTY:{" "}
            <span className="font-mono" style={{ color: row.rsVsBenchmark >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {row.rsVsBenchmark >= 0 ? "+" : ""}
              {fmt(row.rsVsBenchmark)}%
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {row.entries.map((e, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border shrink-0 mt-0.5 whitespace-nowrap"
              style={{ borderColor: stanceColor[e.stance] ?? "var(--border)", color: stanceColor[e.stance] ?? "var(--text-muted)" }}
            >
              {e.stance}
            </span>
            <div className="min-w-0">
              <p className="text-sm" style={{ color: "var(--text)" }}>
                <span className="font-mono">₹{fmt(e.price)}</span>
                <span className="text-xs ml-2" style={{ color: "var(--text-faint)" }}>{e.date}</span>
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{e.method}</p>
              <p className="text-xs mt-0.5 leading-snug" style={{ color: "var(--text-faint)" }}>{e.rationale}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScreenerTab({ screen, onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // Empty string means "latest session" — the default, and not the same as
  // picking today's date, since today may not be a trading day yet.
  const [asOfDate, setAsOfDate] = useState("");
  // Live mode re-runs the screen against the current session instead of the
  // last published EOD file. Only meaningful for a "latest" run, so picking
  // a past date turns it off.
  const [liveMode, setLiveMode] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  // True only while a BACKGROUND refresh is in flight — the live re-run
  // keeps the current table on screen rather than dropping back to the
  // loading state, which is what the Watchlist does too.
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Price/volume bounds are applied client-side: the API already returned
  // the matching rows, so narrowing them shouldn't cost another full scan.
  const [numeric, setNumeric] = useState({ ...EMPTY_NUMERIC_FILTERS });

  // Identity of the query itself, separate from the refresh counter. When
  // this changes the user asked for genuinely different data, so clearing
  // the table is right. When only refreshTick changes it's the same query
  // re-run, and blanking the screen every 90 seconds would be wrong.
  const queryKey = `${screen}|${asOfDate}|${liveMode ? "live" : "eod"}`;
  const lastQueryKeyRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const isNewQuery = lastQueryKeyRef.current !== queryKey;
    lastQueryKeyRef.current = queryKey;

    if (isNewQuery) {
      setData(null);
      setError(null);
    } else {
      setRefreshing(true);
    }

    (async () => {
      try {
        const qs = new URLSearchParams({ screen });
        if (asOfDate) qs.set("date", asOfDate);
        if (liveMode && !asOfDate) qs.set("live", "1");
        const res = await fetch(`/api/screeners?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't run this screen");
        if (!cancelled) {
          setData(json);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (err) {
        if (cancelled) return;
        // A failed background refresh must not destroy a good table — keep
        // what's on screen and surface the problem inline instead.
        if (isNewQuery) setError(err.message);
        else setError(`Last refresh failed: ${err.message}`);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryKey, refreshTick, screen, asOfDate, liveMode]);

  const showListedOn = screen === "ipo-base";
  const showMarketCap = screen === "pocket-pivot";
  const isStage2 = screen === "stage-2";
  const isConfluence = screen === CONFLUENCE_SCREEN;
  const isReclaim = screen === "ma-reclaim";

  const filteredRows = applyNumericFilters(data?.rows, numeric, { priceKey: "close", volumeKey: "volume" });
  const { sorted, sort, onSort } = useSortableRows(filteredRows, "volumeRatio", "desc");
  const def = isConfluence ? CONFLUENCE_DEF : SCREENS[screen];

  // While live, re-run periodically. 90s rather than something faster
  // because a full screen re-run is a heavy request, not a quote poll.
  useEffect(() => {
    if (!liveMode || asOfDate) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), 90 * 1000);
    return () => clearInterval(id);
  }, [liveMode, asOfDate]);

  const liveToggle = (
    <button
      type="button"
      onClick={() => setLiveMode((v) => !v)}
      disabled={!!asOfDate}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] border text-xs disabled:opacity-40"
      style={{
        borderColor: liveMode && !asOfDate ? "var(--gain)" : "var(--border)",
        color: liveMode && !asOfDate ? "var(--gain)" : "var(--text-muted)",
        background: liveMode && !asOfDate ? "var(--gain-dim)" : "transparent",
      }}
      title={
        asOfDate
          ? "Live applies to the current session only — clear the date to use it"
          : "Re-run this screen against the live session instead of the last published end-of-day file"
      }
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{
          background: liveMode && !asOfDate ? "var(--gain)" : "var(--text-faint)",
          opacity: refreshing ? 0.35 : 1,
        }}
      />
      {refreshing ? "Refreshing…" : "Live"}
    </button>
  );

  const datePicker = (
    <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-faint)" }}>
      As of
      <input
        type="date"
        value={asOfDate}
        min={earliestSelectable()}
        max={todayIST()}
        onChange={(e) => setAsOfDate(e.target.value)}
        className="rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
      />
      {asOfDate && (
        <button
          type="button"
          onClick={() => setAsOfDate("")}
          className="px-1.5 py-0.5 rounded border text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          title="Back to the latest session"
        >
          Latest
        </button>
      )}
    </label>
  );

  // Only take over the screen when there's nothing to show. With data
  // already rendered, a refresh failure is reported inline below the header.
  if (error && !data) {
    return (
      <div>
        <ScreenHeader title={def.label} actions={<div className="flex items-center gap-2 flex-wrap">{liveToggle}{datePicker}</div>} />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ScreenHeader title={def.label} actions={<div className="flex items-center gap-2 flex-wrap">{liveToggle}{datePicker}</div>} />
        <LoadingState>
          {isConfluence
            ? "Running all six screens over the same session and finding the overlap — this takes longer than a single screen."
            : `Scanning every NSE stock for ${def?.label ?? "this screen"} — the first run of the day pulls a month of exchange data, so it takes a moment.`}
        </LoadingState>
      </div>
    );
  }

  return (
    <div>
      <ScreenHeader
        title={def.label}
        meta={`${
          hasActiveNumericFilters(numeric)
            ? `${filteredRows.length} of ${data.resultCount} matches shown`
            : `${data.resultCount} match${data.resultCount === 1 ? "" : "es"}`
        } from ${data.universeSize.toLocaleString("en-IN")} stocks · trading session of ${formatDayLabel(data.asOf)}${
          data.dateAdjusted ? ` (${data.requestedDate} wasn't a trading day)` : ""
        }`}
        actions={<div className="flex items-center gap-2 flex-wrap">{liveToggle}{datePicker}</div>}
      />

      <div className="mb-3">
        <NumericFilters filters={numeric} onChange={setNumeric} />
      </div>

      {liveMode && !asOfDate && (
        <div
          className="mb-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs"
          style={{
            borderColor: data.live?.active ? "var(--gain)" : "var(--border)",
            background: data.live?.active ? "var(--gain-dim)" : "var(--surface-2)",
            color: "var(--text-muted)",
          }}
        >
          {data.live?.active ? (
            <>
              <span style={{ color: "var(--gain)" }}>● Live</span> — running against the current session
              via {data.live.source === "nse" ? "NSE's own feed" : "Yahoo (NSE was unreachable)"},{" "}
              {data.live.symbolCount?.toLocaleString("en-IN")} stocks
              {data.live.feedTimestamp ? ` · NSE timestamp ${data.live.feedTimestamp}` : ""}
              {" · "}
              {data.live.marketOpen
                ? `session ${data.live.sessionProgressPct}% elapsed`
                : "market closed — this is the final state of the last session"}
              . Re-runs every 90s
              {lastUpdated ? `, last updated ${lastUpdated.toLocaleTimeString("en-IN")}` : ""}.
              <div className="mt-1" style={{ color: "var(--text-faint)" }}>
                Delivery % is carried over from the previous session — there is no intraday delivery feed
                at any price, so it is never estimated here. Volume is only what has traded so far, so
                volume-based screens fill in as the day progresses rather than firing early.
              </div>
            </>
          ) : data.live?.reason === "historical" ? (
            <>Live doesn&apos;t apply to a past date — showing the end-of-day data for {data.asOf}.</>
          ) : (
            <>
              Live feed unavailable right now, so this is the last published end-of-day data ({data.asOf}).
              NSE blocks hosted servers frequently; the Yahoo fallback also didn&apos;t return. This tends
              to work from a local machine during market hours.
            </>
          )}
        </div>
      )}

      {error && data && (
        <div
          className="mb-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs"
          style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text-muted)" }}
        >
          {error} — showing the last good results
          {lastUpdated ? ` from ${lastUpdated.toLocaleTimeString("en-IN")}` : ""}.
        </div>
      )}

      <div className="mb-3">
        <InfoNote label={`What ${def.label} looks for`}>
          {def.description}{" "}
          {def.conditions.map((c, i) => (
            <span key={i}>
              {i === 0 ? "" : " · "}
              {c}
            </span>
          ))}
          {data.truncated && (
            <>
              {" "}
              <strong style={{ color: "var(--text-muted)" }}>
                {data.matchedBeforeEnrichment} stocks passed the first-stage filters, above the{" "}
                {data.shortlistCap} cap on how many get checked against the longer-horizon indicators —
                the most liquid ones were kept.
              </strong>
            </>
          )}
          {isConfluence && data.perScreen && (
            <>
              {" "}
              <strong style={{ color: "var(--text-muted)" }}>
                Matches per screen this session:{" "}
                {Object.values(data.perScreen)
                  .map((s) => `${s.label} ${s.failed ? "—" : s.count}`)
                  .join(", ")}
                .
              </strong>
            </>
          )}
          {isReclaim && (
            <>
              {" "}
              <strong style={{ color: "var(--text-muted)" }}>
                A “*” marks a weekly reclaim whose week hasn&apos;t closed yet — the signal is provisional
                until Friday and can still be lost.
              </strong>
            </>
          )}
          {data.notes?.length > 0 && ` ${data.notes.join(" ")}`}
        </InfoNote>
      </div>

      {data.rows.length > 0 && filteredRows.length === 0 ? (
        <EmptyState>
          {data.rows.length} stock{data.rows.length === 1 ? "" : "s"} cleared this screen, but none fall
          within the price and volume bounds set above.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState>
          {isConfluence
            ? `No stocks appeared in two or more screens on ${data.asOf}.`
            : `No stocks cleared this screen on ${data.asOf}.`}
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
                  <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                  <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
                  <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                  <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
                  <SortableTh
                    label="vs Avg Vol"
                    sortKey="volumeRatio"
                    sort={sort}
                    onSort={onSort}
                    title="Today's volume against the trailing 30-day average"
                  />
                  <SortableTh label="30WMA" sortKey="wma30" sort={sort} onSort={onSort} />
                  <DebutHeaderCells sort={sort} onSort={onSort} />
                  {isConfluence && (
                    <SortableTh
                      label="Screens"
                      sortKey="matchCount"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="How many of the six screens this stock matched, and which ones"
                    />
                  )}
                  {isReclaim && (
                    <SortableTh
                      label="Type"
                      sortKey="reclaimType"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Which condition put this stock on the list — the daily reclaim, the weekly one, or both"
                    />
                  )}
                  {isReclaim && (
                    <SortableTh
                      label="Above MA"
                      sortKey="reclaimAbovePct"
                      sort={sort}
                      onSort={onSort}
                      title="How far above the 30-week MA it closed — a wider margin is a more decisive reclaim than a close sitting on the line"
                    />
                  )}
                  {isStage2 && <SortableTh label="Phase" sortKey="stagePhase" sort={sort} onSort={onSort} align="left" />}
                  {isStage2 && (
                    <SortableTh
                      label="Days in St.2"
                      sortKey="daysSinceEntry"
                      sort={sort}
                      onSort={onSort}
                      title="Trading days since the Stage 2 breakout"
                    />
                  )}
                  {isStage2 && (
                    <SortableTh
                      label="Entry ₹"
                      sortKey="stage2EntryPrice"
                      sort={sort}
                      onSort={onSort}
                      title="The Stage 2 breakout close — Weinstein's primary buy. Expand the row for every entry both methods give."
                    />
                  )}
                  {isStage2 && (
                    <SortableTh label="RS vs NIFTY" sortKey="rsVsBenchmark" sort={sort} onSort={onSort} title="26-week relative strength against the NIFTY" />
                  )}
                  {showListedOn && <SortableTh label="Listed" sortKey="listedOn" sort={sort} onSort={onSort} />}
                  {showMarketCap && <SortableTh label="Market Cap" sortKey="marketCapCr" sort={sort} onSort={onSort} />}
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const up = (r.changePercent ?? 0) >= 0;
                  const isOpen = expanded === r.symbol;
                  return (
                    <Fragment key={r.symbol}>
                    <tr
                      className={`border-b last:border-b-0 ${isStage2 ? "cursor-pointer hover:bg-white/5" : ""}`}
                      style={{ borderColor: "var(--border)" }}
                      onClick={isStage2 ? () => setExpanded(isOpen ? null : r.symbol) : undefined}
                      title={isStage2 ? "Click for every entry point both methods give" : undefined}
                    >
                      <td className="py-2.5 pl-4 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs w-5" style={{ color: "var(--accent)" }}>
                            {i + 1}
                          </span>
                          <SymbolLink symbol={r.symbol} className="text-sm" />
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                        ₹{fmt(r.close)}
                      </td>
                      <td
                        className="py-2.5 px-2 text-right font-mono text-sm"
                        style={{ color: up ? "var(--gain)" : "var(--loss)" }}
                      >
                        {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                      </td>
                      <td
                        className="py-2.5 px-2 text-right"
                        title={
                          r.deliveryIsPreviousSession
                            ? "Previous session's delivery % — delivery data is only published end-of-day"
                            : undefined
                        }
                      >
                        <DeliveryPctCell pct={r.deliveryPct} />
                        {r.deliveryIsPreviousSession && (
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            prev
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {fmtVolume(r.volume)}
                        {r.isLive && r.projectedVolume != null && (
                          <span
                            className="block text-[10px]"
                            style={{ color: "var(--text-faint)" }}
                            title="Projected full-day volume at the current pace. Shown for context only — the screen's filters use actual volume so far."
                          >
                            ~{fmtVolume(r.projectedVolume)} proj
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                        {r.volumeRatio ? `${r.volumeRatio.toFixed(2)}×` : "—"}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.wma30 == null ? "—" : `₹${fmt(r.wma30)}`}
                      </td>
                      <DebutCells row={r} />
                      {isConfluence && (
                        <td className="py-2.5 px-2 text-left">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className="font-mono text-xs px-1.5 py-0.5 rounded"
                              style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
                            >
                              {r.matchCount}
                            </span>
                            {r.matchedScreenLabels?.map((label) => (
                              <span
                                key={label}
                                className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                              >
                                {label}
                              </span>
                            ))}
                          </div>
                        </td>
                      )}
                      {isReclaim && (
                        <td className="py-2.5 px-2 text-left">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                            style={{
                              borderColor:
                                r.reclaimType === "both"
                                  ? "var(--accent)"
                                  : r.reclaimType === "weekly"
                                  ? "var(--tier-low)"
                                  : "var(--border)",
                              color:
                                r.reclaimType === "both"
                                  ? "var(--accent)"
                                  : r.reclaimType === "weekly"
                                  ? "var(--tier-low)"
                                  : "var(--text-muted)",
                            }}
                            title={
                              r.reclaimType === "both"
                                ? "Closed back above the 30-week MA on the day AND recovered it within the week"
                                : r.reclaimType === "weekly"
                                ? `Week dipped to ₹${fmt(r.weekly?.weekLow)} (${fmt(r.weekly?.dipPct, 1)}% below the MA) then closed back above it${r.weekly?.weekInProgress ? " — week still in progress, so this can still be lost" : ""}`
                                : `Closed ₹${fmt(r.daily?.prevClose)} below the MA yesterday, back above it today`
                            }
                          >
                            {r.reclaimLabel}
                            {r.reclaimType !== "daily" && r.weekly?.weekInProgress ? " *" : ""}
                          </span>
                        </td>
                      )}
                      {isReclaim && (
                        <td
                          className="py-2.5 px-2 text-right font-mono text-xs"
                          style={{ color: "var(--gain)" }}
                        >
                          {r.reclaimAbovePct == null ? "—" : `+${fmt(r.reclaimAbovePct, 1)}%`}
                        </td>
                      )}
                      {isStage2 && (
                        <td className="py-2.5 px-2 text-left">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                            style={{
                              borderColor: r.stagePhase === "Entering" ? "var(--accent)" : "var(--border)",
                              color: r.stagePhase === "Entering" ? "var(--accent)" : "var(--text-muted)",
                            }}
                          >
                            {r.stagePhase}
                          </span>
                        </td>
                      )}
                      {isStage2 && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                          {r.daysSinceEntry ?? "—"}
                        </td>
                      )}
                      {isStage2 && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.stage2EntryPrice == null ? "—" : `₹${fmt(r.stage2EntryPrice)}`}
                        </td>
                      )}
                      {isStage2 && (
                        <td
                          className="py-2.5 px-2 text-right font-mono text-xs"
                          style={{ color: r.rsVsBenchmark == null ? "var(--text-faint)" : r.rsVsBenchmark >= 0 ? "var(--gain)" : "var(--loss)" }}
                        >
                          {r.rsVsBenchmark == null ? "—" : `${r.rsVsBenchmark >= 0 ? "+" : ""}${fmt(r.rsVsBenchmark)}%`}
                        </td>
                      )}
                      {showListedOn && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.listedOn ?? "—"}
                        </td>
                      )}
                      {showMarketCap && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {fmtCap(r.marketCapCr)}
                        </td>
                      )}
                      <td className="py-2.5 pl-2 pr-4 text-right">
                        <WatchlistAddButton
                          symbol={r.symbol}
                          inWatchlist={watchlistSymbols?.includes(r.symbol)}
                          onAdd={onAddToWatchlist}
                        />
                      </td>
                    </tr>
                    {isStage2 && isOpen && (
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={14} className="p-0">
                          <StageEntriesPanel row={r} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
