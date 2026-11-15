"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionTitle, Panel, SubNav, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import LineChart from "@/components/charts/LineChart";
import InfoNote from "@/components/InfoNote";
import SymbolLink from "@/components/SymbolLink";
import MoneyRules from "@/components/MoneyRules";
import { fmt, fmtSignedPct, toneOf } from "@/lib/format";

const rupees = (v, d = 0) => (v == null ? "—" : `₹${fmt(v, d)}`);
const signedRupees = (v) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}₹${fmt(Math.abs(v), 0)}`);

const LEVEL = {
  high: { color: "var(--loss)", bg: "var(--loss-dim)", label: "Act" },
  medium: { color: "var(--tier-mid)", bg: "var(--tier-mid-dim)", label: "Review" },
  low: { color: "var(--text-muted)", bg: "var(--surface-3)", label: "Note" },
};

function Tile({ label, value, sub, tone, hint }) {
  return (
    <div className="rounded-[var(--radius)] border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }} title={hint}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </div>
      <div className="font-mono text-lg font-semibold mt-1" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function AllocationBars({ groups, limit }) {
  const max = Math.max(...groups.map((g) => g.weightPct ?? 0), 1);
  return (
    <ul className="space-y-2">
      {groups.map((g) => {
        const over = limit != null && g.weightPct > limit && g.name !== "Unclassified" && g.name !== "No theme";
        return (
          <li key={g.name}>
            <div className="flex items-baseline justify-between text-sm gap-2">
              <span className="truncate" style={{ color: "var(--text)" }}>
                {g.name}
                <span className="ml-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
                  {g.count} stock{g.count === 1 ? "" : "s"}
                </span>
              </span>
              <span className="font-mono text-xs whitespace-nowrap" style={{ color: over ? "var(--tier-mid)" : "var(--text-muted)" }}>
                {fmt(g.weightPct, 1)}% · {rupees(g.value)}
                {over && " · over limit"}
              </span>
            </div>
            <div className="h-1.5 mt-1 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${((g.weightPct ?? 0) / max) * 100}%`, background: over ? "var(--tier-mid)" : "var(--accent)" }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function StopCell({ row, onSave }) {
  const [val, setVal] = useState(row.stopLoss ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = String(val) !== String(row.stopLoss ?? "");
  async function save(v = val) {
    setBusy(true);
    try {
      await onSave(row.symbol, { stopLoss: v === "" ? null : Number(v) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        step="0.05"
        min="0"
        value={val}
        placeholder="set"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
        className="w-20 rounded border px-1.5 py-0.5 text-xs font-mono text-right bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)]"
        aria-label={`Stop-loss for ${row.symbol}`}
      />
      {dirty ? (
        <button type="button" className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "var(--accent)", color: "var(--on-accent)" }} onClick={() => save()} disabled={busy}>
          {busy ? "…" : "Save"}
        </button>
      ) : (
        row.stopLoss == null &&
        row.suggestedStops?.length > 0 && (
          <select
            className="text-[11px] rounded border px-1 py-0.5 bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)] w-16"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              setVal(e.target.value);
              save(e.target.value);
            }}
            aria-label={`Suggested stops for ${row.symbol}`}
            title="Pick a suggested stop"
          >
            <option value="">Pick…</option>
            {row.suggestedStops.map((s) => (
              <option key={s.id} value={s.price}>
                {s.label} ₹{fmt(s.price)} ({fmt(s.pct, 1)}%)
              </option>
            ))}
          </select>
        )
      )}
    </div>
  );
}

const ALLOC_VIEWS = [
  { id: "bySector", label: "Sector" },
  { id: "byTheme", label: "Theme" },
  { id: "byCap", label: "Market cap" },
  { id: "byStage", label: "Stage" },
];

export default function PortfolioAnalytics({ onSaveHolding }) {
  const [state, setState] = useState({ data: null, error: null, v: 0 });
  const [reload, setReload] = useState(0);
  const [alloc, setAlloc] = useState("bySector");

  useEffect(() => {
    let live = true;
    fetch("/api/portfolio")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load analytics");
        if (live) setState({ data: j, error: null });
      })
      .catch((e) => live && setState({ data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [reload]);

  const data = state.data;
  const perfSeries = useMemo(
    () =>
      data?.performance
        ? [
            { name: "Portfolio", color: "--accent", data: data.performance.series.map((p) => ({ date: p.date, value: p.portfolio })) },
            { name: "Market", color: "--tier-low", data: data.performance.series.map((p) => ({ date: p.date, value: p.market })), width: 1 },
          ]
        : null,
    [data]
  );
  const zero = useMemo(() => [{ value: 0 }], []);

  async function saveHolding(symbol, patch) {
    await onSaveHolding(symbol, patch);
    setReload((n) => n + 1);
  }

  if (state.error) return <ErrorState>{state.error}</ErrorState>;
  if (!data) return <LoadingState variant="cards">Analysing your portfolio against a year of prices…</LoadingState>;
  if (data.empty) return <EmptyState>Add holdings on the Positions view to see analytics here.</EmptyState>;
  if (data.notReady) return <EmptyState>{data.note ?? "Price history is still loading — try again in a minute."}</EmptyState>;

  const s = data.summary;
  const risk = data.risk;
  const conc = data.concentration;
  const set = data.settings;

  return (
    <div className="space-y-5">
      <InfoNote label="About these numbers">
        Figures use end-of-day, split-adjusted NSE closes as of {data.asOf} (the Positions view shows live prices). Performance
        is rebuilt from your buy/sell history and shown as a time-weighted return, so adding money doesn&apos;t count as
        profit; &ldquo;Market&rdquo; is an equal-weight basket of the 500 most traded stocks. Beta, volatility and drawdown
        use your current holdings and weights over the last ~6 months. Brokerage, taxes and dividends aren&apos;t included.
      </InfoNote>

      {data.note && (
        <div className="rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--accent-dim)", background: "var(--accent-wash)", color: "var(--text)" }}>
          {data.note}
        </div>
      )}

      {data.flags.length > 0 && (
        <Panel>
          <SectionTitle meta={`${data.flags.length} item${data.flags.length === 1 ? "" : "s"}`}>Needs attention</SectionTitle>
          <ul className="space-y-1.5">
            {data.flags.map((f, k) => (
              <li key={k} className="flex items-start gap-2 text-sm">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded mt-0.5 shrink-0" style={{ color: LEVEL[f.level].color, background: LEVEL[f.level].bg }}>
                  {LEVEL[f.level].label}
                </span>
                <span style={{ color: "var(--text)" }}>{f.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Value" value={rupees(s.value)} sub={`invested ${rupees(s.invested)}`} />
        <Tile label="Unrealised" value={signedRupees(s.pnl)} tone={toneOf(s.pnl)} sub={fmtSignedPct(s.pnlPct)} />
        <Tile label="Last session" value={signedRupees(s.dayPnl)} tone={toneOf(s.dayPnl)} />
        <Tile label="Realised" value={signedRupees(s.realised)} tone={toneOf(s.realised)} hint="From partial sells and fully closed positions" />
        <Tile
          label="Open risk"
          value={s.openRiskPct != null ? `${fmt(s.openRiskPct, 1)}%` : "—"}
          tone={s.openRiskPct > set.maxOpenRiskPct ? "var(--loss)" : undefined}
          sub={`${rupees(s.openRisk)} to stops · limit ${set.maxOpenRiskPct}%`}
          hint="What you'd lose if every holding hit its stop, as a % of capital"
        />
        <Tile label="Cash" value={s.cash != null ? rupees(s.cash) : "—"} sub={s.capitalIsValue ? "set capital below" : `of ${rupees(s.capital)}`} />
        <Tile label="Beta" value={risk?.beta != null ? fmt(risk.beta, 2) : "—"} hint="How much the portfolio moves for a 1% market move (1.0 = in line)" sub="vs market" />
        <Tile
          label="Volatility"
          value={risk?.volatilityPct != null ? `${fmt(risk.volatilityPct, 1)}%` : "—"}
          sub={risk?.marketVolatilityPct != null ? `market ${fmt(risk.marketVolatilityPct, 1)}% · yearly` : "yearly"}
        />
      </div>

      {data.performance && (
        <Panel>
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
            <SectionTitle meta={`since ${data.performance.from}`}>Performance vs market</SectionTitle>
            <div className="flex gap-4 text-xs font-mono">
              {Object.entries(data.performance.periods).map(([k, v]) =>
                v ? (
                  <span key={k}>
                    <span style={{ color: "var(--text-faint)" }}>{k} </span>
                    <span style={{ color: toneOf(v.portfolio) }}>{fmtSignedPct(v.portfolio, 1)}</span>
                    <span style={{ color: "var(--text-faint)" }}> vs </span>
                    <span style={{ color: toneOf(v.market) }}>{fmtSignedPct(v.market, 1)}</span>
                  </span>
                ) : null
              )}
            </div>
          </div>
          <LineChart series={perfSeries} refLines={zero} height={240} percent ariaLabel="Portfolio cumulative return vs market" />
          {data.performance.note && (
            <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
              {data.performance.note}
            </p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <h4 className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Allocation
            </h4>
            <SubNav items={ALLOC_VIEWS} active={alloc} onChange={setAlloc} />
          </div>
          <AllocationBars groups={data.allocation[alloc]} limit={alloc === "bySector" ? set.maxSectorPct : null} />
        </Panel>
        <Panel>
          <h4 className="text-sm font-medium mb-3" style={{ color: "var(--text)" }}>
            Concentration and risk
          </h4>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt style={{ color: "var(--text-muted)" }} title="1 ÷ sum of squared weights: how many equal-sized positions your portfolio behaves like">
              Behaves like
            </dt>
            <dd className="font-mono text-right">{conc.effectiveHoldings != null ? `${fmt(conc.effectiveHoldings, 1)} equal stocks` : "—"}</dd>
            <dt style={{ color: "var(--text-muted)" }}>Largest holding</dt>
            <dd className="font-mono text-right" style={{ color: conc.top1Pct > set.maxPositionPct ? "var(--tier-mid)" : undefined }}>
              {fmt(conc.top1Pct, 1)}%
            </dd>
            <dt style={{ color: "var(--text-muted)" }}>Top 3 holdings</dt>
            <dd className="font-mono text-right">{fmt(conc.top3Pct, 1)}%</dd>
            <dt style={{ color: "var(--text-muted)" }} title="Average correlation of daily moves between your holdings — near 1 means they all move together">
              Move together
            </dt>
            <dd className="font-mono text-right">{risk?.avgCorrelation != null ? fmt(risk.avgCorrelation, 2) : "—"}</dd>
            <dt style={{ color: "var(--text-muted)" }} title="Worst peak-to-trough fall of today's portfolio over the last ~6 months">
              Max drawdown (6m)
            </dt>
            <dd className="font-mono text-right" style={{ color: "var(--loss)" }}>
              {risk?.maxDrawdownPct != null ? `${fmt(risk.maxDrawdownPct, 1)}%` : "—"}
            </dd>
            <dt style={{ color: "var(--text-muted)" }} title="On 1 day in 20, the portfolio fell at least this much (historical)">
              Bad day (1 in 20)
            </dt>
            <dd className="font-mono text-right" style={{ color: "var(--loss)" }}>
              {risk?.var95Pct != null ? `${fmt(risk.var95Pct, 2)}%` : "—"}
              {risk?.var95Pct != null && s.value ? <span className="text-xs" style={{ color: "var(--text-faint)" }}> ≈ ₹{fmt(Math.abs((risk.var95Pct / 100) * s.value), 0)}</span> : null}
            </dd>
          </dl>
        </Panel>
      </div>

      <div>
        <SectionTitle meta="Set a stop on each holding to measure open risk">Holdings, risk and stops</SectionTitle>
        <Panel flush>
          <TableFrame name="portfolio-risk">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                  <th className="py-2 px-3">Symbol</th>
                  <th className="py-2 px-2 text-right">Weight</th>
                  <th className="py-2 px-2 text-right">Value</th>
                  <th className="py-2 px-2 text-right">P&amp;L</th>
                  <th className="py-2 px-2 text-right">Stage</th>
                  <th className="py-2 px-2 text-right" title="Close vs 50-day average">vs 50-day</th>
                  <th className="py-2 px-2 text-right" title="Close vs 30-week average">vs 30-wk</th>
                  <th className="py-2 px-2 text-right" title="Average daily range as % of price">ATR</th>
                  <th className="py-2 px-2 text-right">Stop</th>
                  <th className="py-2 px-2 text-right" title="(close − stop) × quantity, and as % of capital">Open risk</th>
                  <th className="py-2 px-3 text-right">Held</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.symbol} className="border-t" style={{ borderColor: "var(--border)", background: r.belowStop || r.stage === 4 ? "var(--loss-dim)" : undefined }}>
                    <td className="py-1.5 px-3">
                      <SymbolLink symbol={r.symbol} className="text-sm" />
                      <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                        {r.sector} · {r.cap}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: r.weightPct > set.maxPositionPct ? "var(--tier-mid)" : undefined }}>
                      {r.weightPct != null ? `${fmt(r.weightPct, 1)}%` : "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs">{rupees(r.value)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.pnlPct) }}>
                      {fmtSignedPct(r.pnlPct, 1)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: r.stage === 2 ? "var(--gain)" : r.stage === 4 ? "var(--loss)" : r.stage === 3 ? "var(--tier-mid)" : "var(--text-muted)" }}>
                      {r.stage ?? "—"}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.vsSma50Pct) }}>{fmtSignedPct(r.vsSma50Pct, 1)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(r.vsMa30wPct) }}>{fmtSignedPct(r.vsMa30wPct, 1)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs">{r.atrPct != null ? `${fmt(r.atrPct, 1)}%` : "—"}</td>
                    <td className="py-1.5 px-2 text-right">
                      <StopCell row={r} onSave={saveHolding} />
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: r.belowStop ? "var(--loss)" : undefined }}>
                      {r.openRisk != null ? (
                        <>
                          {rupees(r.openRisk)}
                          <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>{fmt(r.openRiskPct, 2)}% of capital</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.daysHeld != null ? `${r.daysHeld}d` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </Panel>
      </div>

      {data.closed?.length > 0 && (
        <div>
          <SectionTitle meta="Fully sold positions">Closed trades</SectionTitle>
          <Panel flush>
            <TableFrame name="portfolio-closed">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-2 text-right">Qty</th>
                    <th className="py-2 px-2 text-right">Bought</th>
                    <th className="py-2 px-2 text-right">Sold</th>
                    <th className="py-2 px-2 text-right">P&amp;L</th>
                    <th className="py-2 px-3 text-right">Sold on</th>
                  </tr>
                </thead>
                <tbody>
                  {data.closed.map((c, k) => (
                    <tr key={`${c.symbol}-${k}`} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1.5 px-3"><SymbolLink symbol={c.symbol} className="text-sm" /></td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(c.quantity, 0)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{rupees(c.buyPrice, 2)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs">{rupees(c.sellPrice, 2)}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(c.pnl) }}>{signedRupees(c.pnl)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{c.sellDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </Panel>
        </div>
      )}

      <MoneyRules initial={set} onSaved={() => setReload((n) => n + 1)} />
    </div>
  );
}
