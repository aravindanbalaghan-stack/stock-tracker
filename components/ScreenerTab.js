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
import { usePersistentState } from "@/lib/usePersistentState";
import { PrevStageCell, StageChangesCell, InvalidationCell, StageJourneyPanel } from "@/components/StageJourney";

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

      {row.wyckoffPhaseHistory?.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 mb-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--text-faint)" }}>Wyckoff phases:</span>
          {row.wyckoffPhaseHistory.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span style={{ color: "var(--text-faint)" }}>→</span>}
              <span
                className="px-1.5 py-0.5 rounded border"
                style={{
                  borderColor: i === row.wyckoffPhaseHistory.length - 1 ? "var(--accent)" : "var(--border)",
                  color: i === row.wyckoffPhaseHistory.length - 1 ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {p.label} <span style={{ color: "var(--text-faint)" }}>{p.since}</span>
              </span>
            </span>
          ))}
        </div>
      )}

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
              {e.invalidation?.rule && (
                <p
                  className="text-xs mt-0.5 leading-snug"
                  style={{ color: e.invalidation.status === "superseded" ? "var(--text-faint)" : "var(--loss)" }}
                >
                  {e.invalidation.status === "superseded" ? "Stop superseded: " : "Invalid on: "}
                  {e.invalidation.rule}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {row.journey && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--text-muted)" }}>
            Stage journey
          </p>
          <StageJourneyPanel
            journey={row.journey}
            anchorNote={
              row.stage2EntryDate && row.journey.episode.breakoutInsideEpisode
                ? `the screen's Days in St.2 restarted at the ${row.stage2EntryDate} breakout after a weekly close under the MA`
                : row.stage2EntryDate
                ? `breakout on ${row.stage2EntryDate}`
                : undefined
            }
            extra={
              row.dailyClosesBelowMa && (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  Daily closes under the 30-week MA since the breakout:{" "}
                  <span style={{ color: row.dailyClosesBelowMa.count ? "var(--tier-mid)" : "var(--text-muted)" }}>
                    {row.dailyClosesBelowMa.count}
                  </span>
                  {row.dailyClosesBelowMa.lastDate ? ` (last on ${row.dailyClosesBelowMa.lastDate})` : ""}
                  {" — intraweek dips that didn't change the weekly stage."}
                </p>
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function BacktestStat({ label, stat }) {
  return (
    <span>
      {label}:{" "}
      <span className="font-mono" style={{ color: stat.probability == null ? "var(--text-faint)" : "var(--accent)" }}>
        {stat.probability == null ? "not enough signals yet" : `${stat.probability}%`}
      </span>
      {stat.sampleSize > 0 && (
        <span style={{ color: "var(--text-faint)" }}> (n={stat.sampleSize}{stat.pending ? `, ${stat.pending} too recent to score` : ""})</span>
      )}
    </span>
  );
}

// Wyckoff tab: the 6-month backtest probability banner. Fetched once per
// mount (not per date/live toggle — the backtest is its own independent,
// cached statistic, not a function of which session the table is showing).
function WyckoffBacktestBanner() {
  const [bt, setBt] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/wyckoff-backtest");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load the backtest");
        if (!cancelled) setBt(json);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) return null; // non-critical — the screen still works without it
  if (!bt) {
    return (
      <div className="mb-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
        Loading the 6-month backtest probability…
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs flex flex-wrap items-center gap-x-6 gap-y-1" style={{ borderColor: "var(--accent)", background: "var(--accent-wash)", color: "var(--text-muted)" }}>
      <span style={{ color: "var(--text)" }}>
        6-month backtest — win = +{bt.targetPct}% reached before -{bt.stopPct}% within {bt.horizonDays} trading days:
      </span>
      <BacktestStat label="Aggressive (Spring)" stat={bt.aggressive} />
      <BacktestStat label="Conservative (LPS)" stat={bt.conservative} />
      <span style={{ color: "var(--text-faint)" }}>· {bt.scanned} stocks scanned</span>
    </div>
  );
}

// Signed % with a coloured pill — used by the IPO base level columns.
function PctPill({ pct, sub }) {
  if (pct == null) {
    return (
      <span className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>
        —
      </span>
    );
  }
  const above = pct >= 0;
  return (
    <>
      <span
        className="font-mono text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
        style={{ color: above ? "var(--gain)" : "var(--loss)", background: above ? "var(--gain-dim)" : "var(--loss-dim)" }}
      >
        {above ? "▲ +" : "▼ "}
        {fmt(pct, 1)}%
      </span>
      {sub && (
        <span className="block text-[10px] mt-0.5 whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
          {sub}
        </span>
      )}
    </>
  );
}

const STATUS_TONE = {
  gain: { color: "var(--gain)", background: "var(--gain-dim)" },
  accent: { color: "var(--accent)", background: "var(--surface-2)" },
  muted: { color: "var(--text-muted)", background: "var(--surface-2)" },
  loss: { color: "var(--loss)", background: "var(--loss-dim)" },
};

function IpoStatusCell({ row }) {
  const tone = STATUS_TONE[row.ipoStatusTone] ?? STATUS_TONE.muted;
  const warn = row.ipoWarnings?.length ? row.ipoWarnings.join("\n") : null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-xs px-1.5 py-0.5 rounded" style={tone}>
        {row.ipoStatus ?? "—"}
      </span>
      {row.issuePrice == null && (
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }} title="IPO price unavailable — status uses the listing-day high only">
          no IPO ₹
        </span>
      )}
      {warn && (
        <span className="text-xs" style={{ color: "var(--tier-mid)" }} title={warn}>
          ⚠
        </span>
      )}
    </span>
  );
}

function PocketGradeCell({ row }) {
  if (!row.ppGrade) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const isA = row.ppGrade === "A";
  const tip = row.ppWarnings?.length ? row.ppWarnings.join("\n") : "No context warnings";
  return (
    <span
      className="text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
      style={isA ? STATUS_TONE.gain : { color: "var(--tier-mid)", background: "var(--surface-2)" }}
      title={tip}
    >
      {row.ppGrade}
      {!isA && row.ppWarnings?.length ? ` · ${row.ppWarnings.length} warning${row.ppWarnings.length === 1 ? "" : "s"}` : ""}
    </span>
  );
}

function ShakeoutStatusCell({ row }) {
  const g = row.skGrade;
  const style =
    g === "A"
      ? { color: "var(--gain)", background: "var(--gain-dim)" }
      : g === "Watch"
      ? { color: "var(--tier-mid)", background: "var(--surface-2)" }
      : { color: "var(--text-muted)", background: "var(--surface-2)" };
  return (
    <span className="text-xs px-1.5 py-0.5 rounded whitespace-nowrap" style={style} title={row.reason}>
      {g === "Watch" ? "Watch — not reclaimed" : `${g} · Reclaimed`}
    </span>
  );
}

function ShakeoutEvidencePanel({ row }) {
  return (
    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
      <p className="mb-2">{row.reason}</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {row.skChecks?.map((c) => (
          <li key={c.key} className="flex gap-2">
            <span style={{ color: c.pass ? "var(--gain)" : "var(--text-faint)" }}>{c.pass ? "✓" : "✗"}</span>
            <span>
              <span style={{ color: "var(--text)" }}>{c.label}</span> — {c.detail}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2" style={{ color: "var(--text-faint)" }}>
        Invalidation: a daily close below the ₹{fmt(row.skStop)} shakeout low.
        {row.skStatus !== "Reclaimed" && " Until it closes back above the level, this can't be told apart from a breakdown."}
      </p>
    </div>
  );
}

export default function ScreenerTab({ screen, onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  // Empty string means "latest session" — the default, and not the same as
  // picking today's date, since today may not be a trading day yet.
  const [asOfDate, setAsOfDate] = usePersistentState("screener.date", "");
  // Live mode re-runs the screen against the current session instead of the
  // last published EOD file. Only meaningful for a "latest" run, so picking
  // a past date turns it off.
  const [liveMode, setLiveMode] = usePersistentState("screener.live", false);
  const [refreshTick, setRefreshTick] = useState(0);
  // True only while a BACKGROUND refresh is in flight — the live re-run
  // keeps the current table on screen rather than dropping back to the
  // loading state, which is what the Watchlist does too.
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Price/volume bounds are applied client-side: the API already returned
  // the matching rows, so narrowing them shouldn't cost another full scan.
  const [numeric, setNumeric] = usePersistentState("screener.numeric", EMPTY_NUMERIC_FILTERS);
  // Dedicated filters for the two new tabs — kept separate per screen so
  // switching tabs doesn't leak one screen's filter selection into the
  // other's differently-shaped values ("Aggressive" vs "2").
  const [wyckoffPhaseFilter, setWyckoffPhaseFilter] = usePersistentState("screener.wyckoffPhaseFilter", "all");
  const [weinsteinStageFilter, setWeinsteinStageFilter] = usePersistentState("screener.weinsteinStageFilter", "all");
  // Personal learning: whether condition 3 (a bullish pattern) is required.
  const [plPatternFilter, setPlPatternFilter] = usePersistentState("screener.plPatternFilter", "required");
  const [ppFilter, setPpFilter] = usePersistentState("screener.ppFilter", "all");
  const [ipoFilter, setIpoFilter] = usePersistentState("screener.ipoFilter", "all");
  const [skFilter, setSkFilter] = usePersistentState("screener.skFilter", "all");

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
  const showAppearances = screen === "pocket-pivot";
  const isStage2 = screen === "stage-2";
  const isConfluence = screen === CONFLUENCE_SCREEN;
  const isReclaim = screen === "ma-reclaim";
  const isWyckoff = screen === "wyckoff";
  const isWeinstein = screen === "weinstein";
  const isTriple = screen === "triple-confirmation";
  const isPersonal = screen === "personal-learning";
  const isPocket = screen === "pocket-pivot";
  const isIpo = screen === "ipo-base";
  const isShakeout = screen === "shakeout";
  // All three of the new tabs show their own "Reason added" / "Entry"
  // columns instead of the generic 30WMA + debut columns, per the
  // requested column set.
  const hideGenericCols = isWyckoff || isWeinstein || isTriple;
  // Screens whose rows carry a stage journey — previous stage, changes
  // inside the stage, and the invalidation level.
  const showJourney = isStage2 || isWyckoff || isWeinstein;
  const expandable = isStage2 || isWyckoff || isTriple || isWeinstein || isShakeout;

  const filteredRows = applyNumericFilters(data?.rows, numeric, { priceKey: "close", volumeKey: "volume" });
  const phaseFilteredRows =
    isWyckoff && wyckoffPhaseFilter !== "all"
      ? filteredRows?.filter((r) => r.wyckoffStance === wyckoffPhaseFilter)
      : isWeinstein && weinsteinStageFilter !== "all"
      ? filteredRows?.filter((r) => String(r.weinsteinStage) === weinsteinStageFilter)
      : isPersonal && plPatternFilter === "required"
      ? filteredRows?.filter((r) => r.hasPattern)
      : isPersonal && plPatternFilter === "completed"
      ? filteredRows?.filter((r) => r.patterns?.some((p) => !p.provisional))
      : isPersonal && plPatternFilter === "fresh-rs"
      ? filteredRows?.filter((r) => r.hasPattern && r.freshRsCross)
      : isPocket && ppFilter === "A"
      ? filteredRows?.filter((r) => r.ppGrade === "A")
      : isPocket && ppFilter !== "all"
      ? filteredRows?.filter((r) => r.ppType === ppFilter)
      : isIpo && ipoFilter === "actionable"
      ? filteredRows?.filter((r) => r.ipoStatusRank <= 4)
      : isIpo && ipoFilter === "above-high"
      ? filteredRows?.filter((r) => r.aboveListingDayHigh)
      : isIpo && ipoFilter === "above-ipo"
      ? filteredRows?.filter((r) => r.aboveIssuePrice === true)
      : isShakeout && skFilter === "reclaimed"
      ? filteredRows?.filter((r) => r.skStatus === "Reclaimed")
      : isShakeout && skFilter === "A"
      ? filteredRows?.filter((r) => r.skGrade === "A")
      : isShakeout && skFilter === "delivery"
      ? filteredRows?.filter((r) => r.skChecks?.some((c) => c.key === "delivery" && c.pass))
      : isShakeout && skFilter === "watch"
      ? filteredRows?.filter((r) => r.skGrade === "Watch")
      : filteredRows;
  // Pocket Pivot leads with the volume signature's strength; IPO base with
  // its Status priority (1 = crossing the listing-day high).
  const { sorted, sort, onSort } = useSortableRows(
    phaseFilteredRows,
    isPocket ? "volVsDownVol" : isIpo ? "ipoStatusRank" : isShakeout ? "skSort" : "volumeRatio",
    isIpo ? "asc" : "desc"
  );
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

  const hasPhaseFilter =
    (isWyckoff && wyckoffPhaseFilter !== "all") ||
    (isWeinstein && weinsteinStageFilter !== "all") ||
    (isPersonal && plPatternFilter !== "any") ||
    (isPocket && ppFilter !== "all") ||
    (isIpo && ipoFilter !== "all") ||
    (isShakeout && skFilter !== "all");

  return (
    <div>
      <ScreenHeader
        title={def.label}
        meta={`${
          hasActiveNumericFilters(numeric) || hasPhaseFilter
            ? `${phaseFilteredRows.length} of ${data.resultCount} matches shown`
            : `${data.resultCount} match${data.resultCount === 1 ? "" : "es"}`
        } from ${data.universeSize.toLocaleString("en-IN")} stocks · trading session of ${formatDayLabel(data.asOf)}${
          data.dateAdjusted ? ` (${data.requestedDate} wasn't a trading day)` : ""
        }`}
        actions={<div className="flex items-center gap-2 flex-wrap">{liveToggle}{datePicker}</div>}
      />

      {isWyckoff && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-faint)" }}>
            Phase
          </label>
          <select
            value={wyckoffPhaseFilter}
            onChange={(e) => setWyckoffPhaseFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="all">All</option>
            <option value="Aggressive">Aggressive — Phase C (Spring)</option>
            <option value="Conservative">Conservative — Phase D (LPS)</option>
          </select>
        </div>
      )}

      {isPersonal && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <label className="text-xs" style={{ color: "var(--text-faint)" }} htmlFor="pl-pattern">
            Pattern
          </label>
          <select
            id="pl-pattern"
            value={plPatternFilter}
            onChange={(e) => setPlPatternFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="required">Bullish pattern required (all 4 conditions)</option>
            <option value="completed">Pattern on a completed weekly candle only</option>
            <option value="fresh-rs">Pattern + RS crossed 0 in the last 8 weeks</option>
            <option value="any">Ignore pattern (conditions 1, 2 and 4)</option>
          </select>
          <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
            {data.withPatternCount ?? 0} of {data.resultCount} with a pattern
          </span>
        </div>
      )}

      {isPocket && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-faint)" }} htmlFor="pp-filter">
            Show
          </label>
          <select
            id="pp-filter"
            value={ppFilter}
            onChange={(e) => setPpFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="all">All pocket pivots</option>
            <option value="A">Grade A only (no warnings)</option>
            <option value="10-DMA continuation">10-DMA continuation</option>
            <option value="50-DMA bounce">50-DMA bounce</option>
            <option value="Inside base">Inside base</option>
          </select>
        </div>
      )}

      {isShakeout && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-faint)" }} htmlFor="sk-filter">
            Show
          </label>
          <select
            id="sk-filter"
            value={skFilter}
            onChange={(e) => setSkFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="all">All — reclaimed and watch</option>
            <option value="reclaimed">Reclaimed only</option>
            <option value="A">Grade A only (5+ of 7 evidence)</option>
            <option value="delivery">Delivery shift confirmed</option>
            <option value="watch">Undercut — watch for reclaim</option>
          </select>
        </div>
      )}

      {isIpo && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-faint)" }} htmlFor="ipo-filter">
            Show
          </label>
          <select
            id="ipo-filter"
            value={ipoFilter}
            onChange={(e) => setIpoFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="all">All matches</option>
            <option value="actionable">Crossing or approaching only</option>
            <option value="above-high">Above listing-day high</option>
            <option value="above-ipo">Above IPO price</option>
          </select>
        </div>
      )}

      {isWeinstein && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-faint)" }}>
            Stage
          </label>
          <select
            value={weinsteinStageFilter}
            onChange={(e) => setWeinsteinStageFilter(e.target.value)}
            className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="all">All</option>
            <option value="1">Stage 1 — Basing</option>
            <option value="2">Stage 2 — Advancing</option>
            <option value="3">Stage 3 — Topping</option>
            <option value="4">Stage 4 — Declining</option>
          </select>
        </div>
      )}

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

      {isWyckoff && <WyckoffBacktestBanner />}

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

      {data.rows.length > 0 && phaseFilteredRows.length === 0 ? (
        <EmptyState>
          {data.rows.length} stock{data.rows.length === 1 ? "" : "s"} cleared this screen, but none fall within
          the {hasPhaseFilter ? (isPersonal ? "pattern filter or " : isPocket || isIpo || isShakeout ? "Show filter or " : "phase/stage or ") : ""}price and volume bounds set above.
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <EmptyState>
          {isConfluence
            ? `No stocks appeared in two or more screens on ${data.asOf}.`
            : isWyckoff
            ? `No stock has a recent Wyckoff Aggressive or Conservative entry as of ${data.asOf}.`
            : isWeinstein
            ? `No stock entered a new Weinstein stage in the last few weeks, as of ${data.asOf}.`
            : isTriple
            ? `No stock had trend, volume, and relative strength all confirming at once as of ${data.asOf}.`
            : isPersonal
            ? `No stock had weekly RSI above 50, a close above the 30-week MA and RS above 0 together, as of ${data.asOf}.`
            : isShakeout
            ? `No stock in an uptrend had a fresh shakeout below its base low or 50 DMA that it has since reclaimed, as of ${data.asOf}.`
            : isIpo
            ? `No recent listing was crossing or within 5% of its IPO price or listing-day high as of ${data.asOf}.`
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
                  {!hideGenericCols && <SortableTh label="30WMA" sortKey="wma30" sort={sort} onSort={onSort} />}
                  {!hideGenericCols && !isPersonal && <DebutHeaderCells sort={sort} onSort={onSort} />}
                  {isPersonal && (
                    <SortableTh
                      label="RSI (w)"
                      sortKey="rsiWeekly"
                      sort={sort}
                      onSort={onSort}
                      title="Weekly RSI(14), Wilder's smoothing"
                    />
                  )}
                  {isPersonal && (
                    <SortableTh
                      label="RS vs N500"
                      sortKey="rsWeekly"
                      sort={sort}
                      onSort={onSort}
                      title="Relative Strength vs the NIFTY 500 over 52 weeks: (stock ÷ stock 52w ago) ÷ (NIFTY 500 ÷ NIFTY 500 52w ago) − 1. Above 0 = outperforming the broad market"
                    />
                  )}
                  {isPersonal && (
                    <SortableTh
                      label="Pattern"
                      sortKey="patternCount"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Bullish weekly candlestick patterns on this week's or last week's candle"
                    />
                  )}
                  {isWyckoff && (
                    <SortableTh
                      label="Phase"
                      sortKey="wyckoffStance"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Aggressive = Wyckoff Phase C (Spring); Conservative = Phase D (Last Point of Support)"
                    />
                  )}
                  {isWyckoff && (
                    <SortableTh
                      label="Reason added"
                      sortKey="wyckoffStance"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Which Wyckoff entry fired, and why"
                    />
                  )}
                  {isWyckoff && (
                    <SortableTh
                      label="Entry"
                      sortKey="wyckoffEntryPrice"
                      sort={sort}
                      onSort={onSort}
                      title="The price of the qualifying Spring or LPS entry"
                    />
                  )}
                  {isWeinstein && (
                    <SortableTh
                      label="Stage"
                      sortKey="weinsteinStage"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Which of the four Weinstein stages this stock is in"
                    />
                  )}
                  {isWeinstein && (
                    <SortableTh
                      label="Reason added"
                      sortKey="weinsteinStage"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Which of the four stages, and when it was entered"
                    />
                  )}
                  {isWeinstein && (
                    <SortableTh
                      label="Entry"
                      sortKey="entryPrice"
                      sort={sort}
                      onSort={onSort}
                      title="Weekly close at the moment the stage changed"
                    />
                  )}
                  {isTriple && (
                    <SortableTh
                      label="Reason added"
                      sortKey="rsVsBenchmark"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Which of the three confirmations lined up, and by how much"
                    />
                  )}
                  {isTriple && (
                    <SortableTh
                      label="Entry"
                      sortKey="stage2EntryPrice"
                      sort={sort}
                      onSort={onSort}
                      title="The Stage-2 breakout price"
                    />
                  )}
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
                  {showJourney && (
                    <SortableTh
                      label="Prev. stage"
                      sortKey="prevStage"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="The stage the stock was in before entering its current one"
                    />
                  )}
                  {showJourney && (
                    <SortableTh
                      label="Stage changes"
                      sortKey="stageChangeCount"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Weeks since entering the current stage when it dipped into a different stage and came back. Hover for the dates."
                    />
                  )}
                  {showJourney && (
                    <SortableTh
                      label="Invalid at"
                      sortKey="invalidationPrice"
                      sort={sort}
                      onSort={onSort}
                      title="The weekly close that would end the current stage. Hover for which stage it would become."
                    />
                  )}
                  {showListedOn && <SortableTh label="Listed" sortKey="listedOn" sort={sort} onSort={onSort} />}
                  {isIpo && (
                    <SortableTh
                      label="IPO ₹"
                      sortKey="issuePrice"
                      sort={sort}
                      onSort={onSort}
                      title="Issue price paid by IPO subscribers, from NSE's Past Issues data (top of the band where NSE gives no final price)"
                    />
                  )}
                  {isIpo && (
                    <SortableTh label="vs IPO" sortKey="vsIssuePct" sort={sort} onSort={onSort} title="Close against the IPO price" />
                  )}
                  {isIpo && (
                    <SortableTh
                      label="Day-1 High ₹"
                      sortKey="listingDayHigh"
                      sort={sort}
                      onSort={onSort}
                      title="High of the first trading session (split/bonus-adjusted)"
                    />
                  )}
                  {isIpo && (
                    <SortableTh
                      label="vs Day-1 High"
                      sortKey="vsListingHighPct"
                      sort={sort}
                      onSort={onSort}
                      title="Close against the listing-day high"
                    />
                  )}
                  {isIpo && (
                    <SortableTh
                      label="Status"
                      sortKey="ipoStatusRank"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="Crossing = closed above the level within the last 5 sessions. Approaching = within 5% below. Holding above = above for more than 5 sessions."
                    />
                  )}
                  {isPocket && (
                    <SortableTh
                      label="Grade"
                      sortKey="ppGrade"
                      sort={sort}
                      onSort={onSort}
                      align="left"
                      title="A = no context warnings. B = at least one warning — hover the grade for which."
                    />
                  )}
                  {isPocket && (
                    <SortableTh label="Type" sortKey="ppType" sort={sort} onSort={onSort} align="left" title="Which moving average the move came up off" />
                  )}
                  {isPocket && (
                    <SortableTh
                      label="Vol ÷ Down-vol"
                      sortKey="volVsDownVol"
                      sort={sort}
                      onSort={onSort}
                      title="Today's volume divided by the highest down-day volume of the prior 10 sessions — the pocket pivot's volume signature"
                    />
                  )}
                  {isPocket && (
                    <SortableTh label="vs 10 DMA" sortKey="distFrom10dmaPct" sort={sort} onSort={onSort} title="Close against the 10-day SMA. Above 5% is extended and excluded." />
                  )}
                  {isPocket && (
                    <SortableTh label="Stop / Risk" sortKey="riskPct" sort={sort} onSort={onSort} title="Stop at the pivot day's low, and the % from the close down to it" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Status" sortKey="skSort" sort={sort} onSort={onSort} align="left" title="Grade from the evidence score — A = 5+ of 7, B = 3–4, C = under 3. Watch = broke the level but hasn't reclaimed it yet." />
                  )}
                  {isShakeout && (
                    <SortableTh label="Level" sortKey="skLevel" sort={sort} onSort={onSort} title="The support that was undercut — the base low, or the 50 DMA (current value)" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Shakeout" sortKey="skShakeoutDate" sort={sort} onSort={onSort} title="Day the level broke, and how far below it the shakeout low went" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Reclaimed" sortKey="skReclaimDate" sort={sort} onSort={onSort} title="First close back above the level, and how many sessions it took" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Evidence" sortKey="skStrength" sort={sort} onSort={onSort} title="How many of the 7 evidence checks pass — click the row for each one" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Deliv. shift" sortKey="skReclaimDelivery" sort={sort} onSort={onSort} title="Delivery % on the shakeout day → on the reclaim day. Rising delivery on the reclaim suggests shares moving to holders who take delivery." />
                  )}
                  {isShakeout && (
                    <SortableTh label="To pivot" sortKey="skToPivotPct" sort={sort} onSort={onSort} title="How far the base high (the breakout level for the next move) is above the close" />
                  )}
                  {isShakeout && (
                    <SortableTh label="Stop / Risk" sortKey="skRiskPct" sort={sort} onSort={onSort} title="Stop at the shakeout low — a close below it means the shakeout failed" />
                  )}
                  {showMarketCap && <SortableTh label="Market Cap" sortKey="marketCapCr" sort={sort} onSort={onSort} />}
                  {showAppearances && (
                    <SortableTh
                      label="Appeared (30d)"
                      sortKey="appearanceCount30d"
                      sort={sort}
                      onSort={onSort}
                      title="How many trading days in the last 30 this stock has shown up in Pocket Pivot — hover a row's count for the exact dates. Only counts days since this tracking started; older history isn't available."
                    />
                  )}
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
                      className={`border-b last:border-b-0 ${expandable ? "cursor-pointer hover:bg-white/5" : ""}`}
                      style={{ borderColor: "var(--border)" }}
                      onClick={expandable ? () => setExpanded(isOpen ? null : r.symbol) : undefined}
                      title={
                        isShakeout
                          ? "Click for the evidence behind this shakeout"
                          : isWeinstein
                          ? "Click for the full stage journey"
                          : expandable
                          ? "Click for every entry point both methods give, and the stage journey"
                          : undefined
                      }
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
                      {!hideGenericCols && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.wma30 == null ? "—" : `₹${fmt(r.wma30)}`}
                          {isPersonal && r.pctAboveWma != null && (
                            <span className="block text-[10px]" style={{ color: "var(--gain)" }}>
                              +{fmt(r.pctAboveWma, 1)}% above
                            </span>
                          )}
                        </td>
                      )}
                      {!hideGenericCols && !isPersonal && <DebutCells row={r} />}
                      {isPersonal && (
                        <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: r.rsiWeekly >= 70 ? "var(--tier-mid)" : "var(--text)" }} title={r.rsiWeekly >= 70 ? "Above 70 — overbought territory" : undefined}>
                          {fmt(r.rsiWeekly, 1)}
                        </td>
                      )}
                      {isPersonal && (
                        <td className="py-2.5 px-2 text-right">
                          <span className="font-mono text-sm" style={{ color: "var(--gain)" }}>
                            +{fmt(r.rsWeekly, 3)}
                          </span>
                          {r.freshRsCross && (
                            <span
                              className="block text-[10px] mt-0.5 whitespace-nowrap"
                              style={{ color: "var(--accent)" }}
                              title="RS was at or below 0 before this crossing"
                            >
                              crossed 0 {r.rsCrossedWeeksAgo === 0 ? "this week" : `${r.rsCrossedWeeksAgo}w ago`}
                            </span>
                          )}
                        </td>
                      )}
                      {isPersonal && (
                        <td className="py-2.5 px-2 text-left max-w-[260px]">
                          {r.patterns?.length ? (
                            <ul className="flex flex-col gap-0.5">
                              {r.patterns.map((p) => (
                                <li key={p.name} className="text-[11px] leading-snug">
                                  <span style={{ color: "var(--text)" }}>{p.name}</span>
                                  <span className="ml-1" style={{ color: p.provisional ? "var(--tier-mid)" : "var(--text-faint)" }}>
                                    · {p.when.toLowerCase()}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                              None this week or last
                            </span>
                          )}
                        </td>
                      )}
                      {isWyckoff && (
                        <td className="py-2.5 px-2 text-left">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                            style={{
                              borderColor: r.wyckoffStance === "Aggressive" ? "var(--loss)" : "var(--gain)",
                              color: r.wyckoffStance === "Aggressive" ? "var(--loss)" : "var(--gain)",
                            }}
                          >
                            {r.wyckoffStance}
                          </span>
                          <span className="block text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {r.wyckoffPhase}
                          </span>
                          {r.wyckoffPhaseSince && (
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                              since {r.wyckoffPhaseSince}
                              {r.wyckoffPhaseSessions != null
                                ? r.wyckoffPhaseSessions === 0
                                  ? " · today"
                                  : ` · ${r.wyckoffPhaseSessions} session${r.wyckoffPhaseSessions === 1 ? "" : "s"} ago`
                                : ""}
                            </span>
                          )}
                        </td>
                      )}
                      {isWyckoff && (
                        <td className="py-2.5 px-2 text-left max-w-[340px]">
                          <p className="text-xs leading-snug" style={{ color: "var(--text-muted)" }}>
                            {r.wyckoffMethod}
                          </p>
                          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: "var(--text-faint)" }}>
                            {r.wyckoffRationale}
                          </p>
                        </td>
                      )}
                      {isWyckoff && (
                        <td className="py-2.5 px-2 text-right">
                          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
                            ₹{fmt(r.wyckoffEntryPrice)}
                          </span>
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {r.wyckoffEntryDate}
                          </span>
                          {r.wyckoffSignalDate && r.wyckoffSignalDate !== r.wyckoffEntryDate && (
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                              low made {r.wyckoffSignalDate}
                            </span>
                          )}
                        </td>
                      )}
                      {isWeinstein && (
                        <td className="py-2.5 px-2 text-left">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                            style={{
                              borderColor:
                                r.weinsteinTone === "bullish"
                                  ? "var(--gain)"
                                  : r.weinsteinTone === "bearish"
                                  ? "var(--loss)"
                                  : "var(--border)",
                              color:
                                r.weinsteinTone === "bullish"
                                  ? "var(--gain)"
                                  : r.weinsteinTone === "bearish"
                                  ? "var(--loss)"
                                  : "var(--text-muted)",
                            }}
                          >
                            {r.weinsteinStageLabel}
                          </span>
                        </td>
                      )}
                      {isWeinstein && (
                        <td className="py-2.5 px-2 text-left max-w-[340px]">
                          <p className="text-[11px] leading-snug" style={{ color: "var(--text-faint)" }}>
                            {r.reason}
                          </p>
                        </td>
                      )}
                      {isWeinstein && (
                        <td className="py-2.5 px-2 text-right">
                          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
                            ₹{fmt(r.entryPrice)}
                          </span>
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }} title={r.entryWeekOf ? `Week of ${r.entryWeekOf}` : undefined}>
                            {r.entryDate}
                          </span>
                        </td>
                      )}
                      {isTriple && (
                        <td className="py-2.5 px-2 text-left max-w-[340px]">
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                              style={{ borderColor: "var(--gain)", color: "var(--gain)" }}
                            >
                              Trend
                            </span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                              style={{ borderColor: "var(--gain)", color: "var(--gain)" }}
                            >
                              Volume {r.breakoutVolumeRatio}×
                            </span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                              style={{ borderColor: "var(--gain)", color: "var(--gain)" }}
                            >
                              RS {r.rsVsBenchmark >= 0 ? "+" : ""}
                              {r.rsVsBenchmark}%
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug" style={{ color: "var(--text-faint)" }}>
                            {r.tripleReason}
                          </p>
                        </td>
                      )}
                      {isTriple && (
                        <td className="py-2.5 px-2 text-right">
                          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
                            ₹{fmt(r.stage2EntryPrice)}
                          </span>
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {r.stage2EntryDate}
                          </span>
                        </td>
                      )}
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
                      {showJourney && (
                        <td className="py-2.5 px-2 text-left">
                          <PrevStageCell journey={r.journey} />
                        </td>
                      )}
                      {showJourney && (
                        <td className="py-2.5 px-2 text-left">
                          <StageChangesCell journey={r.journey} />
                        </td>
                      )}
                      {showJourney && (
                        <td className="py-2.5 px-2 text-right">
                          <InvalidationCell invalidation={r.journey?.invalidation} />
                          {isWyckoff && r.wyckoffInvalidation?.price != null && (
                            <span
                              className="block text-[10px] mt-0.5 whitespace-nowrap"
                              style={{ color: "var(--text-faint)" }}
                              title={r.wyckoffInvalidation.rule}
                            >
                              setup fails &lt; ₹{fmt(r.wyckoffInvalidation.price)}
                            </span>
                          )}
                        </td>
                      )}
                      {showListedOn && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.listedOn ?? "—"}
                        </td>
                      )}
                      {isIpo && (
                        <td
                          className="py-2.5 px-2 text-right font-mono text-xs"
                          style={{ color: "var(--text-muted)" }}
                          title={r.issuePriceSource === "override" ? "Set by hand in lib/ipoIssuePrices.js" : undefined}
                        >
                          {r.issuePrice == null ? "—" : `₹${fmt(r.issuePrice)}`}
                        </td>
                      )}
                      {isIpo && (
                        <td className="py-2.5 px-2 text-right">
                          <PctPill pct={r.vsIssuePct} sub={r.crossedIssueOn ? `crossed ${r.crossedIssueOn}` : null} />
                        </td>
                      )}
                      {isIpo && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.listingDayHigh == null ? "—" : `₹${fmt(r.listingDayHigh)}`}
                        </td>
                      )}
                      {isIpo && (
                        <td className="py-2.5 px-2 text-right">
                          <PctPill pct={r.vsListingHighPct} sub={r.crossedListingHighOn ? `crossed ${r.crossedListingHighOn}` : null} />
                        </td>
                      )}
                      {isIpo && (
                        <td className="py-2.5 px-2 text-left">
                          <IpoStatusCell row={r} />
                        </td>
                      )}
                      {isPocket && (
                        <td className="py-2.5 px-2 text-left">
                          <PocketGradeCell row={r} />
                        </td>
                      )}
                      {isPocket && (
                        <td className="py-2.5 px-2 text-left text-xs whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                          {r.ppType ?? "—"}
                        </td>
                      )}
                      {isPocket && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                          {r.volVsDownVol == null ? "—" : `${r.volVsDownVol.toFixed(2)}×`}
                        </td>
                      )}
                      {isPocket && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.distFrom10dmaPct == null ? "—" : `${r.distFrom10dmaPct >= 0 ? "+" : ""}${fmt(r.distFrom10dmaPct, 1)}%`}
                        </td>
                      )}
                      {isPocket && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.stopLevel == null ? "—" : `₹${fmt(r.stopLevel)}`}
                          {r.riskPct != null && (
                            <span className="block text-[10px]" style={{ color: "var(--loss)" }}>
                              −{fmt(r.riskPct, 1)}%
                            </span>
                          )}
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-left">
                          <ShakeoutStatusCell row={r} />
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          ₹{fmt(r.skLevel)}
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {r.skLevelType}
                          </span>
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.skShakeoutDate ?? "—"}
                          <span className="block text-[10px]" style={{ color: "var(--loss)" }}>
                            −{fmt(r.skUndercutPct, 1)}% under
                          </span>
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.skReclaimDate ?? "—"}
                          {r.skSessionsToReclaim != null && (
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                              {r.skSessionsToReclaim === 0 ? "same session" : `${r.skSessionsToReclaim} session${r.skSessionsToReclaim === 1 ? "" : "s"}`}
                            </span>
                          )}
                        </td>
                      )}
                      {isShakeout && (
                        <td
                          className="py-2.5 px-2 text-right font-mono text-xs"
                          style={{ color: "var(--accent)" }}
                          title={r.skChecks?.map((c) => `${c.pass ? "✓" : "✗"} ${c.label} — ${c.detail}`).join("\n")}
                        >
                          {r.skStrength}/{r.skStrengthOf}
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.skShakeDelivery == null && r.skReclaimDelivery == null
                            ? "—"
                            : `${r.skShakeDelivery == null ? "—" : `${fmt(r.skShakeDelivery, 0)}%`} → ${r.skReclaimDelivery == null ? "—" : `${fmt(r.skReclaimDelivery, 0)}%`}`}
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.skToPivotPct == null ? "—" : r.skToPivotPct > 0 ? `${fmt(r.skToPivotPct, 1)}%` : "above"}
                          {r.skPivot != null && (
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                              ₹{fmt(r.skPivot)}
                            </span>
                          )}
                        </td>
                      )}
                      {isShakeout && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {r.skStop == null ? "—" : `₹${fmt(r.skStop)}`}
                          {r.skRiskPct != null && (
                            <span className="block text-[10px]" style={{ color: "var(--loss)" }}>
                              −{fmt(r.skRiskPct, 1)}%
                            </span>
                          )}
                        </td>
                      )}
                      {showMarketCap && (
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {fmtCap(r.marketCapCr)}
                        </td>
                      )}
                      {showAppearances && (
                        <td
                          className="py-2.5 px-2 text-right font-mono text-xs"
                          style={{ color: "var(--text-muted)" }}
                          title={
                            r.appearanceDates30d?.length
                              ? `Appeared on: ${r.appearanceDates30d.join(", ")}`
                              : "No recorded appearances yet in this window"
                          }
                        >
                          {r.appearanceCount30d == null ? "—" : r.appearanceCount30d}
                        </td>
                      )}
                      <td className="py-2.5 pl-2 pr-4 text-right">
                        <WatchlistAddButton
                          symbol={r.symbol}
                          inWatchlist={watchlistSymbols?.includes(r.symbol)}
                          onAdd={onAddToWatchlist}
                        source={`Screener · ${def.label}`}
                        />
                      </td>
                    </tr>
                    {(isStage2 || isWyckoff || isTriple) && isOpen && (
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={30} className="p-0">
                          <StageEntriesPanel row={r} />
                        </td>
                      </tr>
                    )}
                    {isShakeout && isOpen && (
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={30} className="px-4 py-3">
                          <ShakeoutEvidencePanel row={r} />
                        </td>
                      </tr>
                    )}
                    {isWeinstein && isOpen && (
                      <tr style={{ background: "var(--surface-2)" }}>
                        <td colSpan={30} className="px-4 py-3">
                          <StageJourneyPanel journey={r.journey} />
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
