"use client";

import { useEffect, useState } from "react";
import { ScreenHeader, SectionTitle, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { StageTag, InvalidationCell } from "@/components/StageJourney";
import { useSortableRows } from "@/lib/useSortableRows";
import { formatDayLabel } from "@/lib/periodLabel";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtVolume(n) {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}
function Pct({ v, digits = 2 }) {
  if (v == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <span style={{ color: v >= 0 ? "var(--gain)" : "var(--loss)" }}>
      {v >= 0 ? "+" : ""}
      {fmt(v, digits)}%
    </span>
  );
}

function useSection(section) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/home?section=${section}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load this section");
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section]);
  return { data, error };
}

const td = "py-2.5 px-2";

// ---------------------------------------------------------------------
// Section 1 — volume + delivery surge
// ---------------------------------------------------------------------

function SurgeSection({ onAddToWatchlist, watchlistSymbols }) {
  const { data, error } = useSection("surge");
  const [sessionIdx, setSessionIdx] = useState(0);
  const session = data?.sessions?.[sessionIdx];
  const { sorted, sort, onSort } = useSortableRows(session?.rows, "volumeRatio", "desc");
  const c = data?.criteria;

  return (
    <section>
      <SectionTitle meta={session ? `${session.rows.length} stock${session.rows.length === 1 ? "" : "s"}` : undefined}>
        Volume &amp; delivery surge
      </SectionTitle>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>Reading the latest NSE sessions…</LoadingState>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {data.sessions.map((s, i) => (
              <button
                key={s.date}
                type="button"
                onClick={() => setSessionIdx(i)}
                className="px-2 py-1 rounded-[var(--radius-sm)] border text-xs"
                style={{
                  borderColor: i === sessionIdx ? "var(--accent)" : "var(--border)",
                  color: i === sessionIdx ? "var(--accent)" : "var(--text-muted)",
                  background: i === sessionIdx ? "var(--accent-wash)" : "transparent",
                }}
              >
                {i === 0 ? "Latest · " : ""}
                {formatDayLabel(s.date)}
                <span className="ml-1.5 font-mono" style={{ color: "var(--text-faint)" }}>
                  {s.rows.length}
                </span>
              </button>
            ))}
          </div>
          <div className="mb-3">
            <InfoNote label="What this looks for">
              One session where a stock traded more than {c.volumeMultipleMin}× its own {c.avgDays}-day average volume,
              more than {c.deliveryPctMin}% of those shares were taken for delivery, and at least ₹{c.turnoverCrMin} Cr
              changed hands. Heavy volume that buyers actually kept, in a size that matters. Stocks with fewer than{" "}
              {c.minPriorDays} prior sessions are left out — there&apos;s no real average to beat. “Repeat” marks a
              stock that cleared the bar on more than one of the sessions above.
            </InfoNote>
          </div>

          {!session?.rows.length ? (
            <EmptyState>No stock met all three conditions on {session ? formatDayLabel(session.date) : "this session"}.</EmptyState>
          ) : (
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="table-scroll">
                <table className="w-full border-collapse table-sticky">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                      <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                      <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                      <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
                      <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                      <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
                      <SortableTh label="× 30d avg" sortKey="volumeRatio" sort={sort} onSort={onSort} title="The session's volume against the 30 sessions before it" />
                      <SortableTh label="Turnover" sortKey="turnoverCr" sort={sort} onSort={onSort} />
                      <th className="py-2 pl-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                        <td className={`${td} pl-4`}>
                          <span className="inline-flex items-center gap-2">
                            <SymbolLink symbol={r.symbol} className="text-sm" />
                            {r.repeats > 1 && (
                              <span
                                className="text-[10px] px-1 rounded border"
                                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                                title={`Cleared this bar on ${r.repeats} of the last ${data.sessions.length} sessions`}
                              >
                                repeat ×{r.repeats}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--text)" }}>₹{fmt(r.close)}</td>
                        <td className={`${td} text-right font-mono text-sm`}><Pct v={r.changePercent} /></td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--tier-high)" }}>{fmt(r.deliveryPct)}%</td>
                        <td className={`${td} text-right font-mono text-xs`} style={{ color: "var(--text-muted)" }}>
                          {fmtVolume(r.volume)}
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>avg {fmtVolume(r.avgVolume30)}</span>
                        </td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--accent)" }}>{fmt(r.volumeRatio)}×</td>
                        <td className={`${td} text-right font-mono text-xs`} style={{ color: "var(--text-muted)" }}>₹{fmt(r.turnoverCr, 1)} Cr</td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <WatchlistAddButton
                            symbol={r.symbol}
                            inWatchlist={watchlistSymbols?.includes(r.symbol)}
                            onAdd={onAddToWatchlist}
                            source="Home · Volume & delivery surge"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// Section 2 — entering Stage 2 after an accumulation base
// ---------------------------------------------------------------------

const GRADE_COLOR = { Strong: "var(--gain)", Moderate: "var(--tier-mid)", Weak: "var(--text-faint)" };

function Check({ ok, children, title }) {
  // ok: true / false / null (not judged)
  const color = ok === true ? "var(--gain)" : ok === false ? "var(--loss)" : "var(--text-faint)";
  return (
    <span className="whitespace-nowrap" title={title}>
      <span style={{ color }} aria-hidden>
        {ok === true ? "✓" : ok === false ? "✗" : "·"}
      </span>{" "}
      {children}
    </span>
  );
}

function Stage2Section({ onAddToWatchlist, watchlistSymbols }) {
  const { data, error } = useSection("stage2");
  const [showAll, setShowAll] = useState(false);
  const rows = data?.rows?.filter((r) => showAll || r.grade === "Strong");
  const { sorted, sort, onSort } = useSortableRows(rows, "gradeRank", "desc");
  const c = data?.criteria;
  const strongCount = data?.rows?.filter((r) => r.grade === "Strong").length ?? 0;

  return (
    <section>
      <SectionTitle meta={data ? `${strongCount} strong · ${data.rows.length} entering from a Stage 1/3 base` : undefined}>
        Entering Stage 2 with accumulation in the base
      </SectionTitle>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>
          Scanning ~500 stocks for fresh Stage 2 breakouts and measuring the base behind each — the first run of the
          day takes up to a minute.
        </LoadingState>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap mb-2">
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Also show moderate and weak accumulation
            </label>
          </div>
          <div className="mb-3">
            <InfoNote label="What this looks for">
              Stocks whose Stage 2 breakout was within the last ~25 sessions (the Stage 2 screen&apos;s “Entering”),
              whose weekly stage before Stage 2 was Stage 1 or Stage 3 — a real base, not a bounce straight off a
              Stage 4 decline ({data.skipped.cameFromStage4} of those were left out). Accumulation in the base is
              graded Strong when: up-day volume is at least {c.upDownVolumeMin}× down-day volume; on-balance volume
              finished the base higher than it started; and, where bhavcopy covers at least{" "}
              {c.deliveryMinCoverageDays} base sessions, the base&apos;s volume-weighted delivery was at least{" "}
              {c.deliveryPctMin}%. Delivery data reaches back to {data.bhavcopyFrom}, so for a long base it describes
              the later part — the “n days” under each figure says how much was covered. {data.universeSource}{" "}
              {data.plausible} passed the weekly pre-filter
              {data.capped ? `; the ${data.checked} most liquid were checked in full` : ""}.
            </InfoNote>
          </div>

          {!sorted.length ? (
            <EmptyState>
              {data.rows.length
                ? `${data.rows.length} stock${data.rows.length === 1 ? " is" : "s are"} entering Stage 2 from a base, but none graded Strong — tick the box above to see them.`
                : `No stock entered Stage 2 from a Stage 1 or 3 base in the last ~25 sessions, as of ${data.asOf}.`}
            </EmptyState>
          ) : (
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="table-scroll">
                <table className="w-full border-collapse table-sticky">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                      <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                      <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                      <SortableTh label="Breakout" sortKey="sessionsSinceBreakout" sort={sort} onSort={onSort} title="Stage 2 breakout close, date, and sessions since" />
                      <SortableTh label="Base" sortKey="prevStage" sort={sort} onSort={onSort} align="left" title="The weekly stage before Stage 2, and the base's price range" />
                      <SortableTh label="Accumulation" sortKey="gradeRank" sort={sort} onSort={onSort} align="left" />
                      <SortableTh label="Up/Down vol" sortKey="upDownVolume" sort={sort} onSort={onSort} title="Volume on up days ÷ volume on down days, across the base" />
                      <SortableTh label="OBV net" sortKey="obvNetPct" sort={sort} onSort={onSort} title="On-balance volume's net change over the base, as % of all base volume" />
                      <SortableTh label="Base deliv. %" sortKey="avgDeliveryPct" sort={sort} onSort={onSort} title="Volume-weighted delivery % inside the base (bhavcopy-covered part)" />
                      <SortableTh label="RS vs NIFTY" sortKey="rsVsBenchmark" sort={sort} onSort={onSort} title="26-week relative strength" />
                      <SortableTh label="Invalid at" sortKey="invalidationPrice" sort={sort} onSort={onSort} title="Weekly close that would end Stage 2" />
                      <th className="py-2 pl-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.symbol} className="border-b last:border-b-0 align-top" style={{ borderColor: "var(--border)" }}>
                        <td className={`${td} pl-4`}>
                          <SymbolLink symbol={r.symbol} className="text-sm" />
                          {r.wyckoffPhase && (
                            <span className="block text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>
                              {r.wyckoffPhase}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--text)" }}>
                          ₹{fmt(r.close)}
                          <span className="block text-[11px]"><Pct v={r.changePercent} /></span>
                        </td>
                        <td className={`${td} text-right`}>
                          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.breakoutPrice)}</span>
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {r.breakoutDate} · {r.sessionsSinceBreakout === 0 ? "today" : `${r.sessionsSinceBreakout}d ago`}
                          </span>
                          {r.breakoutVolumeRatio != null && (
                            <span className="block text-[10px]" style={{ color: "var(--accent)" }}>{r.breakoutVolumeRatio}× vol</span>
                          )}
                        </td>
                        <td className={`${td} text-left`}>
                          <StageTag stage={r.prevStage} />
                          <span className="block text-[10px] mt-0.5 whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
                            ₹{fmt(r.baseSupport)}–₹{fmt(r.baseResistance)} · {r.baseWeeks}w
                          </span>
                        </td>
                        <td className={`${td} text-left`}>
                          <span className="text-xs font-medium" style={{ color: GRADE_COLOR[r.grade] }}>{r.grade}</span>
                          <span className="flex flex-col text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                            <Check ok={r.checks.upDownVolume}>U/D vol</Check>
                            <Check ok={r.checks.obv}>OBV rising</Check>
                            <Check ok={r.checks.delivery} title={r.checks.delivery == null ? "Too few base sessions covered by bhavcopy to judge" : undefined}>
                              delivery{r.checks.delivery == null ? " (n/a)" : ""}
                            </Check>
                          </span>
                        </td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--text)" }}>
                          {r.upDownVolume == null ? "—" : `${fmt(r.upDownVolume)}×`}
                        </td>
                        <td className={`${td} text-right font-mono text-sm`}><Pct v={r.obvNetPct} digits={1} /></td>
                        <td className={`${td} text-right font-mono text-sm`} style={{ color: "var(--text)" }}>
                          {r.avgDeliveryPct == null ? "—" : `${fmt(r.avgDeliveryPct, 1)}%`}
                          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                            {r.deliveryCoverageDays} of {r.baseSessions} days
                          </span>
                          {r.highDeliveryUpDays > 0 && (
                            <span className="block text-[10px]" style={{ color: "var(--text-faint)" }} title="Up-closing days with delivery ≥ 60%">
                              {r.highDeliveryUpDays} high-deliv. up days
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right font-mono text-sm`}><Pct v={r.rsVsBenchmark} /></td>
                        <td className={`${td} text-right`}><InvalidationCell invalidation={r.invalidation} /></td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          <WatchlistAddButton
                            symbol={r.symbol}
                            inWatchlist={watchlistSymbols?.includes(r.symbol)}
                            onAdd={onAddToWatchlist}
                            source="Home · Entering Stage 2 with accumulation"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function HomeTab({ onAddToWatchlist, watchlistSymbols }) {
  return (
    <div>
      <ScreenHeader title="Home" meta="Today's standout volume, and fresh Stage 2 breakouts built on accumulation" />
      <div className="flex flex-col gap-8">
        <SurgeSection onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
        <Stage2Section onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      </div>
    </div>
  );
}
