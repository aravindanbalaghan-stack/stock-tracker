"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ScreenHeader, SectionTitle, Panel, SubNav, ErrorState, LoadingState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import LineChart from "@/components/charts/LineChart";
import InfoNote from "@/components/InfoNote";
import SymbolLink from "@/components/SymbolLink";
import { usePersistentState } from "@/lib/usePersistentState";
import { fmt, fmtTurnover, fmtSignedPct, toneOf } from "@/lib/format";

const UNIVERSES = [
  { id: "top500", label: "Top 500" },
  { id: "liquid", label: "All liquid stocks" },
];

const TONE = {
  "risk-on": { label: "Risk-on", color: "var(--gain)", bg: "var(--gain-dim)" },
  mixed: { label: "Mixed", color: "var(--tier-mid)", bg: "var(--tier-mid-dim)" },
  "risk-off": { label: "Risk-off", color: "var(--loss)", bg: "var(--loss-dim)" },
};

function useBreadth(universe) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(`/api/breadth?universe=${universe}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load breadth");
        if (live) setState({ key: universe, data: j, error: null });
      })
      .catch((e) => live && setState({ key: universe, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [universe]);
  return state.key === universe ? state : { key: universe, data: null, error: null };
}

function Tile({ label, value, delta, deltaSuffix = " pts", hint, tone }) {
  return (
    <div className="rounded-[var(--radius)] border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }} title={hint}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </div>
      <div className="font-mono text-xl font-semibold mt-1" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </div>
      {delta != null && (
        <div className="text-[11px] mt-0.5 font-mono" style={{ color: toneOf(delta) }}>
          {delta >= 0 ? "+" : ""}
          {fmt(delta, 1)}
          {deltaSuffix} <span style={{ color: "var(--text-faint)" }}>vs 2 wks ago</span>
        </div>
      )}
    </div>
  );
}

function Bar({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const color = pct >= 60 ? "var(--gain)" : pct < 40 ? "var(--loss)" : "var(--tier-mid)";
  return (
    <span className="inline-flex items-center gap-2 justify-end w-full">
      <span className="font-mono text-xs" style={{ color }}>
        {fmt(pct, 0)}%
      </span>
      <span className="h-1.5 w-20 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </span>
    </span>
  );
}

function ChartCard({ title, children, legend }) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
        <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {title}
        </h4>
        {legend && (
          <div className="flex gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 rounded" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </Panel>
  );
}

function StockList({ title, rows, empty }) {
  return (
    <Panel flush>
      <div className="px-4 pt-3 pb-2">
        <SectionTitle meta={`${rows.length}${rows.length >= 40 ? "+" : ""}`}>{title}</SectionTitle>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm" style={{ color: "var(--text-muted)" }}>
          {empty}
        </p>
      ) : (
        <TableFrame name={`breadth-${title.toLowerCase().replace(/\W+/g, "-")}`} style={{ maxHeight: "22rem" }}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                <th className="py-2 px-4">Symbol</th>
                <th className="py-2 px-2 text-right">Close</th>
                <th className="py-2 px-2 text-right">Chg</th>
                <th className="py-2 px-4 text-right">Turnover/day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5 px-4">
                    <SymbolLink symbol={r.symbol} className="text-sm" />
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(r.close)}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.changePct) }}>
                    {fmtSignedPct(r.changePct, 1)}
                  </td>
                  <td className="py-1.5 px-4 text-right font-mono text-xs">{fmtTurnover(r.turnoverCr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </Panel>
  );
}

export default function BreadthTab() {
  const [universe, setUniverse] = usePersistentState("breadth.universe", "top500");
  const { data, error } = useBreadth(universe);

  const charts = useMemo(() => {
    if (!data?.daily?.length) return null;
    const d = data.daily;
    const pick = (k) => d.map((x) => ({ date: x.date, value: x[k] }));
    return {
      above: [
        { name: "200-day", color: "--accent", data: pick("above200") },
        { name: "50-day", color: "--tier-low", data: pick("above50") },
        { name: "20-day", color: "--text-faint", data: pick("above20"), width: 1 },
      ],
      ad: [{ name: "A/D line", color: "--tier-low", data: pick("adLine") }],
      hl: [
        { name: "Highs", color: "--gain", data: pick("newHighs") },
        { name: "Lows", color: "--loss", data: pick("newLows") },
      ],
      mcc: [{ kind: "histogram", data: pick("mcclellan") }],
      stages: data.stageWeeks?.length
        ? [
            { name: "Stage 2", color: "--gain", data: data.stageWeeks.map((w) => ({ date: w.week, value: w.stage2 })) },
            { name: "Stage 4", color: "--loss", data: data.stageWeeks.map((w) => ({ date: w.week, value: w.stage4 })) },
            { name: "Stage 1", color: "--tier-low", data: data.stageWeeks.map((w) => ({ date: w.week, value: w.stage1 })), width: 1 },
            { name: "Stage 3", color: "--accent", data: data.stageWeeks.map((w) => ({ date: w.week, value: w.stage3 })), width: 1 },
          ]
        : null,
    };
  }, [data]);

  const ref50 = useMemo(() => [{ value: 50, label: "" }], []);
  const ref0 = useMemo(() => [{ value: 0, label: "" }], []);
  const latest = data?.daily?.[data.daily.length - 1];
  const before = data?.daily?.[data.daily.length - 11];
  const delta = (k) => (latest?.[k] != null && before?.[k] != null ? latest[k] - before[k] : null);
  const tone = data?.verdict ? TONE[data.verdict.tone] : null;

  return (
    <div>
      <ScreenHeader
        title="Market breadth"
        meta={data ? `How many stocks are taking part · ${data.universeSize ?? "—"} stocks · as of ${data.asOf ?? "—"}` : "How many stocks are taking part"}
        actions={<SubNav items={UNIVERSES} active={universe} onChange={setUniverse} />}
      >
        <InfoNote label="How to read this">
          An index can rise on a few heavyweights while most stocks fall. Breadth shows what the typical stock is doing.
          Above 60% of stocks over their 200-day average is a healthy market; under 40% is a weak one. New 52-week highs
          outnumbering lows means leadership; the reverse means damage. The McClellan oscillator turning up from deep
          negative often marks the end of a sell-off. Figures use split-adjusted NSE closes; &ldquo;Top 500&rdquo; is the 500
          most traded stocks, which tracks the NIFTY 500 closely.
        </InfoNote>
      </ScreenHeader>

      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState variant="cards">Reading the market — the first run builds a year of history from NSE, which can take up to a minute.</LoadingState>}

      {data?.note && (
        <div className="mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--accent-dim)", background: "var(--accent-wash)", color: "var(--text)" }}>
          {data.note}
        </div>
      )}

      {data && latest && (
        <div className="space-y-4">
          {data.verdict && tone && (
            <Panel>
              <div className="flex items-start gap-3 flex-wrap">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider" style={{ color: tone.color, background: tone.bg }}>
                  {tone.label}
                </span>
                <div className="flex-1 min-w-[16rem]">
                  <p className="font-display text-base font-semibold" style={{ color: "var(--text)" }}>
                    {data.verdict.headline}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-sm" style={{ color: "var(--text-muted)" }}>
                    {data.verdict.reasons.map((r) => (
                      <li key={r}>· {r}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
                    A rule of thumb on today&apos;s numbers, not a forecast.
                  </p>
                </div>
              </div>
            </Panel>
          )}

          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            <Tile label="> 200-day avg" value={latest.above200 != null ? `${fmt(latest.above200, 0)}%` : "—"} delta={delta("above200")} />
            <Tile label="> 50-day avg" value={latest.above50 != null ? `${fmt(latest.above50, 0)}%` : "—"} delta={delta("above50")} />
            <Tile label="> 20-day avg" value={latest.above20 != null ? `${fmt(latest.above20, 0)}%` : "—"} delta={delta("above20")} />
            <Tile
              label="Adv / Dec"
              value={`${latest.advancers} / ${latest.decliners}`}
              tone={latest.advancers >= latest.decliners ? "var(--gain)" : "var(--loss)"}
              hint="Stocks that closed up vs down in the latest session"
            />
            <Tile label="52w highs / lows" value={latest.newHighs != null ? `${latest.newHighs} / ${latest.newLows}` : "—"} hint="Needs a year of history" />
            <Tile label="McClellan" value={latest.mcclellan != null ? fmt(latest.mcclellan, 0) : "—"} tone={toneOf(latest.mcclellan)} delta={delta("mcclellan")} deltaSuffix="" />
            <Tile label="In Stage 2" value={data.latestStageMix?.stage2 != null ? `${fmt(data.latestStageMix.stage2, 0)}%` : "—"} hint="Weekly Weinstein stage" />
          </div>

          {charts && (
            <div className="grid gap-3 lg:grid-cols-2">
              <ChartCard
                title="% of stocks above their moving average"
                legend={[
                  { label: "200-day", color: "var(--accent)" },
                  { label: "50-day", color: "var(--tier-low)" },
                  { label: "20-day", color: "var(--text-faint)" },
                ]}
              >
                <LineChart series={charts.above} refLines={ref50} percent ariaLabel="Percent of stocks above 20, 50 and 200-day averages" />
              </ChartCard>
              <ChartCard title="Advance / decline line" legend={[{ label: "cumulative advancers − decliners", color: "var(--tier-low)" }]}>
                <LineChart series={charts.ad} ariaLabel="Advance decline line" />
              </ChartCard>
              <ChartCard
                title="New 52-week highs vs lows"
                legend={[
                  { label: "Highs", color: "var(--gain)" },
                  { label: "Lows", color: "var(--loss)" },
                ]}
              >
                <LineChart series={charts.hl} ariaLabel="New 52-week highs and lows" />
              </ChartCard>
              <ChartCard title="McClellan oscillator" legend={[{ label: "19 vs 39-day EMA of net advances", color: "var(--text-faint)" }]}>
                <LineChart series={charts.mcc} refLines={ref0} ariaLabel="McClellan oscillator" />
              </ChartCard>
              {charts.stages && (
                <div className="lg:col-span-2">
                  <ChartCard
                    title="Weinstein stage mix (weekly)"
                    legend={[
                      { label: "Stage 2", color: "var(--gain)" },
                      { label: "Stage 4", color: "var(--loss)" },
                      { label: "Stage 1", color: "var(--tier-low)" },
                      { label: "Stage 3", color: "var(--accent)" },
                    ]}
                  >
                    <LineChart series={charts.stages} percent height={200} ariaLabel="Share of stocks in each Weinstein stage" />
                  </ChartCard>
                </div>
              )}
            </div>
          )}

          {data.sectors?.length > 0 && (
            <div>
              <SectionTitle meta="Which sectors are strong underneath">Sector breadth</SectionTitle>
              <Panel flush>
                <TableFrame name="breadth-sectors">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                        <th className="py-2 px-4">Sector</th>
                        <th className="py-2 px-2 text-right">Stocks</th>
                        <th className="py-2 px-2 text-right">% &gt; 50-day</th>
                        <th className="py-2 px-2 text-right">% &gt; 200-day</th>
                        <th className="py-2 px-4 text-right">% Stage 2</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sectors.map((s) => (
                        <tr key={s.key} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2 px-4">
                            <Link href={`/sector/${encodeURIComponent(s.key)}`} className="hover:underline" style={{ color: "var(--text)" }}>
                              {s.name}
                            </Link>
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-xs">{s.stocks}</td>
                          <td className="py-2 px-2 text-right">
                            <Bar pct={s.above50} />
                          </td>
                          <td className="py-2 px-2 text-right">
                            <Bar pct={s.above200} />
                          </td>
                          <td className="py-2 px-4 text-right">
                            <Bar pct={s.stage2} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableFrame>
              </Panel>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <StockList title="New 52-week highs today" rows={data.newHighList ?? []} empty="None today (or not enough history yet)." />
            <StockList title="New 52-week lows today" rows={data.newLowList ?? []} empty="None today (or not enough history yet)." />
          </div>
        </div>
      )}
    </div>
  );
}
