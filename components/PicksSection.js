"use client";

import { useEffect, useState } from "react";
import { SectionTitle, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import InfoNote from "@/components/InfoNote";
import { StageTag } from "@/components/StageJourney";
import { usePersistentState } from "@/lib/usePersistentState";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function signed(v, d = 1) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${fmt(v, d)}%`;
}
const tone = (v) => (v == null ? "var(--text-faint)" : v >= 0 ? "var(--gain)" : "var(--loss)");

const VERDICT = {
  edge: { label: "Edge held in backtest", color: "var(--gain)", bg: "var(--gain-dim)" },
  weak: { label: "Weak edge — beat on average, not consistently", color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" },
  none: { label: "No edge found in backtest", color: "var(--loss)", bg: "var(--loss-dim)" },
  "too-few": { label: "Too little history to judge", color: "var(--text-muted)", bg: "var(--surface-2)" },
};

const HORIZON_ORDER = ["short", "mid", "long"];

// Per-period excess return (picks − universe) as a row of thin bars —
// green above the line where the picks won, red below where they lost.
// Shows at a glance whether the edge is steady or one lucky stretch.
function ExcessBars({ series }) {
  if (!series?.length) return null;
  const vals = series.map((s) => s.pick - s.universe);
  const max = Math.max(...vals.map(Math.abs), 1);
  const w = 4;
  const gap = 2;
  const h = 44;
  const width = vals.length * (w + gap);
  return (
    <svg
      viewBox={`0 0 ${width} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      role="img"
      aria-label="Excess return of the picks over the universe, each backtest period"
    >
      <line x1="0" x2={width} y1={h / 2} y2={h / 2} stroke="var(--border-strong)" strokeWidth="0.5" />
      {vals.map((v, i) => {
        const bh = (Math.abs(v) / max) * (h / 2 - 2);
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={v >= 0 ? h / 2 - bh : h / 2}
            width={w}
            height={Math.max(bh, 0.5)}
            fill={v >= 0 ? "var(--gain)" : "var(--loss)"}
          >
            <title>{`${series[i].date}: picks ${signed(series[i].pick)} vs universe ${signed(series[i].universe)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-base" style={{ color: color ?? "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Evidence({ h, method }) {
  const bt = h.backtest;
  if (!bt?.periods) {
    return (
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        Not enough history to backtest this horizon yet.
      </p>
    );
  }
  const v = VERDICT[bt.verdict];
  return (
    <div className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ color: v.color, background: v.bg }}>
          {v.label}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {bt.periods} entry dates, {bt.from} → {bt.to} · top {method.topN}, held {h.hold}, {method.costPct}% costs deducted
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
        <Stat label="Picks, avg per hold" value={signed(bt.avgPickReturnPct)} color={tone(bt.avgPickReturnPct)} />
        <Stat label="Average stock" value={signed(bt.avgUniverseReturnPct)} sub={`NIFTY ${signed(bt.avgNiftyReturnPct)}`} />
        <Stat label="Edge over average" value={signed(bt.avgExcessPct)} color={tone(bt.avgExcessPct)} />
        <Stat label="Beat the average" value={`${bt.beatUniversePct}%`} sub="of entry dates" />
        <Stat label="Worst hold" value={signed(bt.worstPeriodPct)} color="var(--loss)" sub={`${bt.hitRatePct}% of picks ended up`} />
      </div>
      <ExcessBars series={bt.series} />
      {h.live && (
        <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
          Live record since {h.live.since}: {h.live.sets} daily pick lists, averaging{" "}
          <span style={{ color: tone(h.live.avgReturnPct) }}>{signed(h.live.avgReturnPct)}</span> to date vs NIFTY{" "}
          {signed(h.live.avgNiftyPct)} over the same spans; ahead of NIFTY {h.live.beatNiftyPct}% of the time. Early
          days count for little — this record becomes meaningful after a full {h.hold} hold.
        </p>
      )}
      {bt.verdict === "none" && (
        <p className="text-xs mt-2" style={{ color: "var(--loss)" }}>
          On this data the {h.label.toLowerCase()} picks did not beat simply owning the average stock. Treat the list as
          ideas to research, not a signal.
        </p>
      )}
    </div>
  );
}

export default function PicksSection({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [horizon, setHorizon] = usePersistentState("home.picksHorizon", "mid");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/home?section=picks");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.detail || json?.error || "Couldn't build the picks");
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const h = data?.horizons?.[horizon] ?? data?.horizons?.mid;
  const labels = data?.factorLabels ?? {};

  return (
    <section>
      <SectionTitle meta={data ? `as of ${data.asOf} · ${data.ranked} stocks ranked` : undefined}>
        Odds-ranked picks
      </SectionTitle>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>
          Ranking ~500 stocks on five years of weekly history and backtesting every horizon — the first load of the day
          can take up to a minute.
        </LoadingState>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-3" role="tablist" aria-label="Investment horizon">
            {HORIZON_ORDER.map((id) => {
              const x = data.horizons[id];
              const active = id === horizon;
              const v = x.backtest?.verdict;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setHorizon(id)}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] border text-left"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border)",
                    background: active ? "var(--accent-wash)" : "transparent",
                  }}
                >
                  <span className="block text-sm" style={{ color: active ? "var(--accent)" : "var(--text)" }}>
                    {x.label}
                  </span>
                  <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                    hold {x.hold}
                    {v ? (
                      <span style={{ color: VERDICT[v].color }}>
                        {" "}
                        · {v === "edge" ? "edge held" : v === "weak" ? "weak edge" : v === "none" ? "no edge" : "—"}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            {h.idea}
          </p>

          <div className="mb-3">
            <Evidence h={h} method={data.method} />
          </div>

          <div className="mb-3">
            <InfoNote label="How the ranking works — and its limits">
              Every stock in the universe ({data.universeSource}) is ranked against all the others on each factor, and the
              factors are blended with fixed weights:{" "}
              {Object.entries(h.weights)
                .map(([k, w]) => `${labels[k] ?? k} ${Math.round(w * 100)}%`)
                .join(", ")}
              . The weights come from published research, set before backtesting rather than tuned to it. Only stocks
              trading at least ₹{data.method.minTurnoverCr} Cr a day and above ₹{data.method.minPrice} are considered. The
              backtest re-runs exactly this ranking every {data.method.rebalanceWeeks} weeks over the past five years,
              using only data available on each date, and compares the top {data.method.topN} with the average stock over
              the following {h.hold}. Two known flaws: it uses today&apos;s universe, so companies that collapsed and
              left the index are missing, which flatters all the returns; and there are no fundamentals (earnings, debt,
              valuation) in this app, so this ranks price behaviour, not business quality. Past patterns can stop
              working. Size positions so a wrong pick is survivable, and respect the exit level.
            </InfoNote>
          </div>

          {!h.picks.length ? (
            <EmptyState>No stock passes this horizon&apos;s filters today.</EmptyState>
          ) : (
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="table-scroll">
                <table className="w-full border-collapse table-sticky">
                  <thead>
                    <tr className="text-left border-b text-[11px]" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      <th className="py-2 pl-4 pr-2 font-medium">#</th>
                      <th className="py-2 px-2 font-medium">Symbol</th>
                      <th className="py-2 px-2 font-medium text-right">Close</th>
                      <th className="py-2 px-2 font-medium text-right" title="Blended percentile score, 0–100">Score</th>
                      <th className="py-2 px-2 font-medium">Why it ranks</th>
                      <th className="py-2 px-2 font-medium text-right">13w / 52w</th>
                      <th className="py-2 px-2 font-medium text-right" title="Distance below the 52-week high">From high</th>
                      <th className="py-2 px-2 font-medium text-right" title="Annualised volatility of weekly returns">Volatility</th>
                      <th className="py-2 px-2 font-medium text-right" title="Volume-weighted delivery % over the last 20 sessions — shown for context, not scored">Deliv. 20d</th>
                      <th className="py-2 px-2 font-medium text-right">Exit if</th>
                      <th className="py-2 pl-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.picks.map((p) => {
                      const exitPct = p.exitLevel != null ? ((p.exitLevel - p.close) / p.close) * 100 : null;
                      return (
                        <tr key={p.symbol} className="border-b last:border-b-0 align-top" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2.5 pl-4 pr-2 font-mono text-xs" style={{ color: "var(--accent)" }}>
                            {p.rank}
                          </td>
                          <td className="py-2.5 px-2">
                            <SymbolLink symbol={p.symbol} className="text-sm" />
                            <span className="flex items-center gap-1 mt-1 flex-wrap">
                              <StageTag stage={p.stage} />
                              {p.alsoIn.map((x) => (
                                <span
                                  key={x}
                                  className="text-[10px] px-1 rounded border"
                                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                                  title={`Also ranked in the ${data.horizons[x].label.toLowerCase()} list`}
                                >
                                  also {x}
                                </span>
                              ))}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                            ₹{fmt(p.close)}
                            <span className="block text-[11px]" style={{ color: tone(p.changePercent) }}>
                              {signed(p.changePercent, 2)}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
                              {p.score}
                            </span>
                            <span className="block h-1 mt-1 rounded" style={{ background: "var(--surface-3)" }}>
                              <span className="block h-1 rounded" style={{ width: `${p.score}%`, background: "var(--accent)" }} />
                            </span>
                          </td>
                          <td className="py-2.5 px-2 max-w-[300px]">
                            <ul className="flex flex-col gap-0.5">
                              {p.reasons.slice(0, 3).map((r) => (
                                <li key={r.factor} className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                                  {labels[r.factor] ?? r.factor}
                                  <span className="ml-1" style={{ color: r.percentile >= 80 ? "var(--gain)" : "var(--text-faint)" }}>
                                    top {Math.max(1, 100 - r.percentile)}%
                                  </span>
                                </li>
                              ))}
                            </ul>
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
                            {p.vol52Pct == null ? "—" : `${fmt(p.vol52Pct, 0)}%`}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                            {p.delivery20Pct == null ? "—" : `${fmt(p.delivery20Pct, 1)}%`}
                          </td>
                          <td className="py-2.5 px-2 text-right" title={p.exitRule}>
                            <span className="font-mono text-xs" style={{ color: "var(--text)" }}>
                              {p.exitLevel == null ? "—" : `< ₹${fmt(p.exitLevel)}`}
                            </span>
                            {exitPct != null && (
                              <span className="block text-[10px]" style={{ color: "var(--loss)" }}>
                                {fmt(exitPct, 1)}% · weekly close
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pl-2 pr-4 text-right">
                            <WatchlistAddButton
                              symbol={p.symbol}
                              inWatchlist={watchlistSymbols?.includes(p.symbol)}
                              onAdd={onAddToWatchlist}
                              source={`Home · Odds-ranked picks (${h.label})`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[11px] mt-2" style={{ color: "var(--text-faint)" }}>
            Ranked from historical price patterns — probabilities, not predictions, and not investment advice. Check a
            company&apos;s business before buying, and decide your exit before you enter.
          </p>
        </>
      )}
    </section>
  );
}
