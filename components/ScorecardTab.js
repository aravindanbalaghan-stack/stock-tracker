"use client";

import { useEffect, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, SubNav, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import InfoNote from "@/components/InfoNote";
import { HorizonCards, SignalsTable, SMALL_SAMPLE } from "@/components/TrackRecord";
import { usePersistentState } from "@/lib/usePersistentState";
import { fmt, fmtSignedPct, toneOf } from "@/lib/format";

const MODES = [
  { id: "1", label: "First appearance" },
  { id: "0", label: "Every day shown" },
];
const PERIODS = [
  { id: "30", label: "30 sessions" },
  { id: "90", label: "90 sessions" },
  { id: "all", label: "All" },
];

function useScorecard(fresh, period) {
  const key = `${fresh}|${period}`;
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(`/api/signal-scorecard?fresh=${fresh}&period=${period}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load the scorecard");
        if (live) setState({ key, data: j, error: null });
      })
      .catch((e) => live && setState({ key, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [fresh, period, key]);
  return state.key === key ? state : { key, data: null, error: null };
}

export default function ScorecardTab() {
  const [fresh, setFresh] = usePersistentState("scorecard.fresh", "1");
  const [period, setPeriod] = usePersistentState("scorecard.period", "all");
  const [open, setOpen] = useState(null);
  const { data, error } = useScorecard(fresh, period);
  const screens = data?.screens ?? [];
  const current = screens.find((s) => s.id === open) ?? null;

  const pct = (v) => (v == null ? "—" : `${fmt(v, 0)}%`);
  const sig = (v) => (
    <span className="font-mono text-xs" style={{ color: toneOf(v) }}>
      {fmtSignedPct(v, 2)}
    </span>
  );

  return (
    <div>
      <ScreenHeader
        title="Signal scorecard"
        meta={data?.asOf ? `How each screen's picks did afterwards · graded to ${data.asOf}` : "How each screen's picks did afterwards"}
        actions={
          <>
            <SubNav items={MODES} active={fresh} onChange={setFresh} />
            <SubNav items={PERIODS} active={period} onChange={setPeriod} />
          </>
        }
      >
        <InfoNote label="How this is graded">
          Each pick is treated as bought at that day&apos;s close and held 5, 10 or 20 sessions, using split-adjusted NSE
          closes, with no stop-loss and no costs. &ldquo;vs market&rdquo; subtracts what an equal-weight basket of the 500 most
          traded stocks did over the same days, so a positive number means the screen beat simply owning the market.
          &ldquo;First appearance&rdquo; counts a stock once when it enters a screen; &ldquo;Every day shown&rdquo; counts it on every
          day it stays. Picks are logged each time a screen runs for the latest session (the nightly job runs them all);
          older history was recovered from the per-stock log the app already kept. Under {SMALL_SAMPLE} graded picks, treat the
          numbers as anecdotes. Past results don&apos;t guarantee future ones.
        </InfoNote>
      </ScreenHeader>

      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState>Grading every screener pick against what happened next…</LoadingState>}
      {data?.note && (
        <div className="mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--accent-dim)", background: "var(--accent-wash)", color: "var(--text)" }}>
          {data.note}
        </div>
      )}
      {data && !screens.length && (
        <EmptyState>
          No screener picks logged yet. Every screen logs its picks when it runs for the latest session — the nightly job runs
          all of them — so this fills in over the coming days, and grades appear once picks are 5 sessions old.
        </EmptyState>
      )}

      {screens.length > 0 && (
        <div className="space-y-4">
          <Panel flush>
            <TableFrame name="scorecard">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    <th className="py-2 px-3">Screen</th>
                    <th className="py-2 px-2 text-right">Picks</th>
                    <th className="py-2 px-2 text-right">5d up</th>
                    <th className="py-2 px-2 text-right">10d up</th>
                    <th className="py-2 px-2 text-right">10d avg</th>
                    <th className="py-2 px-2 text-right">10d vs mkt</th>
                    <th className="py-2 px-2 text-right">20d avg</th>
                    <th className="py-2 px-2 text-right">20d vs mkt</th>
                    <th className="py-2 px-2 text-right">Open</th>
                    <th className="py-2 px-3">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {screens.map((s) => {
                    const small = (s.stats[10]?.n ?? 0) < SMALL_SAMPLE;
                    return (
                      <tr
                        key={s.id}
                        className="border-t cursor-pointer"
                        style={{ borderColor: "var(--border)", background: open === s.id ? "var(--surface-3)" : undefined }}
                        onClick={() => setOpen(open === s.id ? null : s.id)}
                      >
                        <td className="py-2 px-3">
                          <span className="font-medium" style={{ color: "var(--text)" }}>{s.label}</span>
                          {!s.main && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>archive</span>
                          )}
                          {small && (
                            <span className="ml-2 text-[10px]" style={{ color: "var(--tier-mid)" }} title={`Fewer than ${SMALL_SAMPLE} graded picks`}>
                              small sample
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{s.totalSignals}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{pct(s.stats[5]?.winRate)}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs">{pct(s.stats[10]?.winRate)}</td>
                        <td className="py-2 px-2 text-right">{sig(s.stats[10]?.avg)}</td>
                        <td className="py-2 px-2 text-right">{sig(s.stats[10]?.avgExcess)}</td>
                        <td className="py-2 px-2 text-right">{sig(s.stats[20]?.avg)}</td>
                        <td className="py-2 px-2 text-right">{sig(s.stats[20]?.avgExcess)}</td>
                        <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{s.open}</td>
                        <td className="py-2 px-3 font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                          {s.firstDate} → {s.lastDate}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableFrame>
          </Panel>
          {!current && (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Click a screen to see its full record and every pick.
            </p>
          )}
          {current && (
            <div className="space-y-3">
              <SectionTitle meta={`${current.totalSignals} picks · ${current.open} still open`}>{current.label}</SectionTitle>
              <HorizonCards stats={current.stats} />
              <Panel flush>
                <SignalsTable name={`scorecard-${current.id}`} signals={current.signals} />
              </Panel>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
