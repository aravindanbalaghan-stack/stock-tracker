"use client";

import TableFrame from "@/components/ui/TableFrame";
import SymbolLink from "@/components/SymbolLink";
import { fmt, fmtSignedPct, toneOf } from "@/lib/format";

// How a screen's picks did 5, 10 and 20 sessions later — shared by the
// Signal scorecard and the custom screener's backtest.

export const SMALL_SAMPLE = 20;

export function HorizonCards({ stats, horizons = [5, 10, 20] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {horizons.map((h) => {
        const s = stats?.[h] ?? { n: 0 };
        return (
          <div key={h} className="rounded-[var(--radius)] border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                {h} sessions later
              </span>
              <span className="text-[11px]" style={{ color: s.n < SMALL_SAMPLE ? "var(--tier-mid)" : "var(--text-faint)" }}>
                {s.n} graded{s.n > 0 && s.n < SMALL_SAMPLE ? " · small sample" : ""}
              </span>
            </div>
            {s.n ? (
              <>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold" style={{ color: s.winRate >= 55 ? "var(--gain)" : s.winRate < 45 ? "var(--loss)" : "var(--text)" }}>
                    {fmt(s.winRate, 0)}%
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    went up
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt style={{ color: "var(--text-faint)" }}>Average</dt>
                  <dd className="text-right font-mono" style={{ color: toneOf(s.avg) }}>{fmtSignedPct(s.avg)}</dd>
                  <dt style={{ color: "var(--text-faint)" }}>Median</dt>
                  <dd className="text-right font-mono" style={{ color: toneOf(s.median) }}>{fmtSignedPct(s.median)}</dd>
                  <dt style={{ color: "var(--text-faint)" }} title="Average return minus the equal-weight top-500 over the same days">vs market</dt>
                  <dd className="text-right font-mono" style={{ color: toneOf(s.avgExcess) }}>{fmtSignedPct(s.avgExcess)}</dd>
                  <dt style={{ color: "var(--text-faint)" }}>Beat market</dt>
                  <dd className="text-right font-mono">{s.beatRate != null ? `${fmt(s.beatRate, 0)}%` : "—"}</dd>
                  <dt style={{ color: "var(--text-faint)" }}>Best / worst</dt>
                  <dd className="text-right font-mono">
                    <span style={{ color: "var(--gain)" }}>{fmtSignedPct(s.best, 1)}</span> / <span style={{ color: "var(--loss)" }}>{fmtSignedPct(s.worst, 1)}</span>
                  </dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                Nothing old enough to grade yet.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SignalsTable({ name, signals }) {
  const cell = (v) => (
    <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: v == null ? "var(--text-faint)" : toneOf(v) }}>
      {v == null ? "open" : fmtSignedPct(v, 1)}
    </td>
  );
  return (
    <TableFrame name={name} style={{ maxHeight: "28rem" }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            <th className="py-2 px-3">Symbol</th>
            <th className="py-2 px-2">Flagged</th>
            <th className="py-2 px-2 text-right">Entry close</th>
            <th className="py-2 px-2 text-right">5 days</th>
            <th className="py-2 px-2 text-right">10 days</th>
            <th className="py-2 px-2 text-right">20 days</th>
            <th className="py-2 px-3 text-right" title="10-day return minus the market's">10d vs mkt</th>
          </tr>
        </thead>
        <tbody>
          {signals.map((s) => (
            <tr key={`${s.date}-${s.symbol}`} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-1.5 px-3">
                <SymbolLink symbol={s.symbol} className="text-sm" />
              </td>
              <td className="py-1.5 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>{s.date}</td>
              <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(s.entry)}</td>
              {cell(s.ret5)}
              {cell(s.ret10)}
              {cell(s.ret20)}
              {cell(s.excess10)}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
