"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function WmaScreenTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/wma-screen");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Scanning {" "}{"~180"} stocks against their 30-week average — this can take a moment…
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-display text-lg" style={{ color: "var(--text)" }}>
          Near the 30-week average, after a recent breakout
        </h2>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          As of {data.asOf ?? "—"}
        </span>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
        Crossed above the 30WMA within the last {data.criteria?.crossLookbackDays ?? 7} trading days,
        currently within ±{data.criteria?.nearBandPct ?? 1}% of it, delivery % ≥ {data.criteria?.minDeliveryPct ?? 60}%.
      </p>

      {data.results.length === 0 ? (
        <div className="rounded-lg border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
          No stocks currently match all three conditions.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Symbol</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Price</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>30WMA</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Distance</th>
                <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Deliv. %</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => {
                const above = r.distancePct >= 0;
                return (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2 font-mono text-sm" style={{ color: "var(--text)" }}>{r.symbol}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.price)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text-muted)" }}>₹{fmt(r.wma30)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: above ? "var(--gain)" : "var(--loss)" }}>
                      {above ? "+" : ""}{fmt(r.distancePct)}%
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right font-mono text-sm" style={{ color: "var(--accent)" }}>{fmt(r.deliveryPct)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Universe: Nifty 50 + Nifty Midcap 150 (~180 stocks). The 30WMA is treated as roughly flat across
        the lookback window, which is standard for this kind of screen since it only moves once a
        trading week completes.
      </p>
    </div>
  );
}
