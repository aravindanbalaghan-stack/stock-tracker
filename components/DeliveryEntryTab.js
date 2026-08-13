"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import { formatDayLabel } from "@/lib/periodLabel";
import DatePicker from "@/components/DatePicker";
import SectorAssign from "@/components/SectorAssign";
import { ScreenHeader, Panel, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import { usePersistentState } from "@/lib/usePersistentState";

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

// The base rate is the honest headline: how often this setup reached the
// target at all. Everything else is conditional on it.
function StudyPanel({ study, target, criteria, coverage }) {
  return (
    <Panel className="mb-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Setups studied
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--text)" }}>
            {study.resolvedEvents.toLocaleString("en-IN")}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {coverage}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Reached +{target}%
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--accent)" }}>
            {study.baseRatePct}%
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            {study.hitCount} of {study.resolvedEvents}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Did NOT
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--loss)" }}>
            {Math.round((100 - study.baseRatePct) * 10) / 10}%
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            the majority outcome
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Traits beating base rate
          </span>
          <span className="font-mono text-lg" style={{ color: "var(--text)" }}>
            {study.helpfulTraits.length}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            of {study.traits.length} tested
          </span>
        </div>
      </div>

      {study.traits.length > 0 && (
        <div className="pt-3 border-t" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
            What the +{target}% movers had in common
          </p>
          <div className="flex flex-col gap-1">
            {study.traits.map((t) => (
              <div key={t.trait} className="flex items-center gap-3 text-xs">
                <span className="w-52 shrink-0" style={{ color: "var(--text)" }}>
                  {t.trait}
                </span>
                <div className="flex-1 h-1.5 rounded-full" style={{ background: "var(--surface-3)" }}>
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${Math.min(100, (t.lift / 2) * 100)}%`,
                      background: t.lift >= 1.3 ? "var(--gain)" : t.lift >= 1 ? "var(--accent)" : "var(--loss)",
                    }}
                  />
                </div>
                <span className="font-mono w-16 text-right" style={{ color: "var(--text-muted)" }}>
                  {t.hitRatePct}%
                </span>
                <span
                  className="font-mono w-14 text-right"
                  style={{ color: t.lift >= 1.3 ? "var(--gain)" : "var(--text-faint)" }}
                  title="How much better than the base rate. Near 1.0 means the trait told you nothing."
                >
                  {t.lift}×
                </span>
                <span className="font-mono w-12 text-right text-[10px]" style={{ color: "var(--text-faint)" }}>
                  n={t.sampleSize}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--text-faint)" }}>
        Read the base rate first: <strong>{Math.round((100 - study.baseRatePct) * 10) / 10}% of these setups
        did not reach +{target}%</strong>. The traits below were found by looking at which ones did, over a
        single quarter of one market — so some of them are noise that happened to correlate, and all of
        them partly describe that quarter rather than a durable edge. The lift column is the check: a trait
        near 1.0× carried no information. Nothing here is a prediction or a recommendation to buy; it
        describes what has already happened.
      </p>
    </Panel>
  );
}

// The forward test. A study always describes its own data well; only this
// says whether the pattern carried over to setups it had never seen.
function BacktestPanel({ bt, target }) {
  if (!bt) return null;
  const beat = bt.edgePct != null && bt.edgePct > 0;
  const tooFew = bt.scoredCount < 15;
  return (
    <Panel className="mb-4" style={{ borderColor: beat ? "var(--gain)" : "var(--border)" }}>
      <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
        Walk-forward test · pattern learned only from data before {formatDayLabel(bt.splitDate)}
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Flagged</span>
          <span className="font-mono text-lg" style={{ color: "var(--text)" }}>{bt.scoredCount}</span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>with a measurable outcome</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Reached +{target}%</span>
          <span className="font-mono text-lg" style={{ color: "var(--accent)" }}>
            {bt.hitRatePct == null ? "—" : `${bt.hitRatePct}%`}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{bt.hitCount} of {bt.scoredCount}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Base rate</span>
          <span className="font-mono text-lg" style={{ color: "var(--text-muted)" }}>{bt.baseRatePct}%</span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>picking at random</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Edge</span>
          <span className="font-mono text-lg" style={{ color: beat ? "var(--gain)" : "var(--loss)" }}>
            {bt.edgePct == null ? "—" : `${bt.edgePct >= 0 ? "+" : ""}${bt.edgePct}pp`}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>vs the base rate</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Median outcome</span>
          <span className="font-mono text-lg">
            <Signed value={bt.medianFinalPct} />
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            up {bt.medianMaxUpPct ?? "—"}% / down {bt.medianMaxDownPct ?? "—"}%
          </span>
        </div>
      </div>
      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: "var(--text-faint)" }}>
        {tooFew ? (
          <strong style={{ color: "var(--loss)" }}>
            Only {bt.scoredCount} flagged setups had a measurable outcome — far too few to conclude
            anything. Treat this run as illustrative of the mechanism, not as evidence either way.
          </strong>
        ) : beat ? (
          <>
            The flagged set beat the base rate by {bt.edgePct} percentage points on data the pattern
            hadn&apos;t seen. On a sample this size that is suggestive at best, not established — a single
            split on one quarter of one market can easily produce this much separation by chance. Try
            several split dates before believing it.
          </>
        ) : (
          <>
            The flagged set did <strong>not</strong> beat the base rate here — the pattern gave no
            advantage on unseen data, which is the common outcome for traits selected by looking at past
            winners. That&apos;s worth knowing, and is exactly what this test is for.
          </>
        )}
      </p>
    </Panel>
  );
}

export default function DeliveryEntryTab({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [target, setTarget] = usePersistentState("entry.target", 20);
  const [backtestMode, setBacktestMode] = usePersistentState("entry.backtest", false);
  const [splitDate, setSplitDate] = usePersistentState("entry.splitDate", "");
  const [applied, setApplied] = usePersistentState("entry.applied", { target: 20, backtest: false, date: "" });
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ target: String(applied.target) });
        if (applied.backtest && applied.date) {
          qs.set("backtest", "1");
          qs.set("date", applied.date);
        }
        const res = await fetch(`/api/delivery-entry?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't build entry candidates");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied, reloadTick]);

  // Flatten the realised outcome so the Actual column is sortable.
  const rows = (data?.candidates ?? []).map((c) => ({
    ...c,
    realisedMaxUp: c.realised?.maxUpPct ?? null,
  }));
  const { sorted, sort, onSort } = useSortableRows(rows, "historicalHitRatePct", "desc");

  const controls = (
    <div className="flex items-end gap-2 flex-wrap">
      <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        Target move %
        <input
          type="number"
          step="5"
          min="5"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value) || 20)}
          className="mt-1 w-20 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </label>
      <button
        type="button"
        onClick={() => setBacktestMode((v) => !v)}
        className="px-2.5 py-1.5 rounded-[var(--radius-sm)] border text-xs mb-0.5"
        style={{
          borderColor: backtestMode ? "var(--accent)" : "var(--border)",
          color: backtestMode ? "var(--accent)" : "var(--text-muted)",
        }}
        title="Learn the pattern only from data before a chosen date, then check how the setups it flagged actually turned out"
      >
        {backtestMode ? "Backtest on" : "Backtest"}
      </button>
      {backtestMode && <DatePicker value={splitDate} onChange={setSplitDate} label="Split at" />}
      <button
        type="button"
        onClick={() =>
          setApplied({ target: Number(target) || 20, backtest: backtestMode, date: splitDate })
        }
        disabled={backtestMode && !splitDate}
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium mb-0.5 disabled:opacity-40"
        style={{ background: "var(--accent)", color: "var(--surface)" }}
      >
        {backtestMode ? "Run backtest" : "Rerun study"}
      </button>
    </div>
  );

  if (backtestMode && !splitDate && !data) {
    return (
      <div>
        <ScreenHeader title="Entry candidates" actions={controls} />
        <EmptyState>Pick a split date — the pattern is learned only from data before it.</EmptyState>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <ScreenHeader title="Entry candidates" actions={controls} />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <ScreenHeader title="Entry candidates" actions={controls} />
        <LoadingState>
          Studying every delivery event of the last few months, measuring which ones ran {applied.target}%+, then
          matching today&apos;s setups against them…
        </LoadingState>
      </div>
    );
  }

  const coverage = `${formatDayLabel(data.windowFirstDate)} – ${formatDayLabel(data.asOf)}`;

  return (
    <div>
      <ScreenHeader
        title="Entry candidates"
        meta={`${data.candidates.length} recent setup${data.candidates.length === 1 ? "" : "s"} matching the +${data.target}% pattern · ${coverage}`}
        actions={controls}
      />

      {data.backtest && <BacktestPanel bt={data.backtest} target={data.target} />}

      <StudyPanel study={data.study} target={data.target} criteria={data.criteria} coverage={coverage} />

      {data.candidates.length === 0 ? (
        <EmptyState>
          No recent events share the traits that distinguished past +{data.target}% movers. That&apos;s a
          normal outcome, not a failure — most days produce nothing worth flagging.
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
                  <SortableTh label="Event" sortKey="eventDate" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label="Entry ₹" sortKey="entryPrice" sort={sort} onSort={onSort} title="Close on the event day — the level the setup triggered at" />
                  <SortableTh label="Now ₹" sortKey="currentPrice" sort={sort} onSort={onSort} />
                  <SortableTh label="Since" sortKey="changeSinceEvent" sort={sort} onSort={onSort} />
                  <SortableTh label="Deliv. %" sortKey="eventDeliveryPct" sort={sort} onSort={onSort} />
                  <SortableTh label="Vol ×" sortKey="eventVolumeRatio" sort={sort} onSort={onSort} />
                  <SortableTh
                    label="Hist. hit rate"
                    sortKey="historicalHitRatePct"
                    sort={sort}
                    onSort={onSort}
                    title="Share of PAST setups sharing these traits that reached the target. Not this stock's probability."
                  />
                  <SortableTh label="Median up" sortKey="medianMaxUpPct" sort={sort} onSort={onSort} title="Median best move of comparable past setups" />
                  <SortableTh label="Median down" sortKey="medianMaxDownPct" sort={sort} onSort={onSort} title="Median worst drawdown of comparable past setups" />
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-left" style={{ color: "var(--text-faint)" }}>
                    Sector
                  </th>
                  {data.backtest && (
                    <SortableTh
                      label="Actual"
                      sortKey="realisedMaxUp"
                      sort={sort}
                      onSort={onSort}
                      title="What this setup actually did after the split date"
                    />
                  )}
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-left" style={{ color: "var(--text-faint)" }}>
                    Why it&apos;s here
                  </th>
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={`${r.symbol}-${r.eventDate}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2">
                      <SymbolLink symbol={r.symbol} className="text-sm" />
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.eventDate}
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        {r.daysSinceEvent}d ago
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      ₹{fmt(r.entryPrice)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      ₹{fmt(r.currentPrice)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.changeSinceEvent} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
                      {fmt(r.eventDeliveryPct)}%
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.eventVolumeRatio}×
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      {r.historicalHitRatePct}%
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        n={r.comparableCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.medianMaxUpPct} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.medianMaxDownPct} />
                    </td>
                    <td className="py-2.5 px-2">
                      <SectorAssign
                        symbol={r.symbol}
                        sectors={r.sectors}
                        onAssigned={() => setReloadTick((t) => t + 1)}
                      />
                    </td>
                    {data.backtest && (
                      <td className="py-2.5 px-2 text-right font-mono text-xs">
                        {!r.realised ? (
                          <span style={{ color: "var(--text-faint)" }}>—</span>
                        ) : (
                          <>
                            <span style={{ color: r.realised.hit ? "var(--gain)" : "var(--text-muted)" }}>
                              {r.realised.hit ? "✓ hit" : "miss"}
                            </span>
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                              up {fmt(r.realised.maxUpPct, 1)}% / dn {fmt(r.realised.maxDownPct, 1)}%
                            </span>
                          </>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-2">
                      <div className="flex flex-wrap gap-1">
                        {r.matchedTraits.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <WatchlistAddButton
                        symbol={r.symbol}
                        inWatchlist={watchlistSymbols?.includes(r.symbol)}
                        onAdd={onAddToWatchlist}
                        source={"Entry candidates"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
        <strong style={{ color: "var(--text-muted)" }}>Median up and Median down describe past setups
        sharing the same traits — they are not targets for these stocks.</strong> Note that the median
        drawdown is real: comparable setups typically went against you before doing anything, and roughly{" "}
        {Math.round((100 - data.study.baseRatePct) * 10) / 10}% never reached the target at all. The
        &quot;Entry&quot; price is simply where the setup triggered, not a level I&apos;m suggesting you
        buy. This is a description of historical behaviour over one quarter of data, not investment
        advice — I&apos;m not able to tell you what any of these will do next.
      </p>
    </div>
  );
}
