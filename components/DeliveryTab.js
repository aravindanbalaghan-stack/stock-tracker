"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (!n) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function DeliverySparkline({ history }) {
  const values = history.map((h) => h.deliveryPct).filter((v) => v != null);
  if (values.length < 2) return <span className="text-xs" style={{ color: "var(--text-faint)" }}>—</span>;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 90;
  const h = 24;
  const step = w / (history.length - 1);

  const points = history
    .map((d, i) => {
      if (d.deliveryPct == null) return null;
      const x = i * step;
      const y = h - ((d.deliveryPct - min) / range) * h;
      return `${x},${y}`;
    })
    .filter(Boolean)
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}

export default function DeliveryTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/delivery");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load delivery screen");
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
        Pulling NSE bhavcopy data — this can take a moment the first time…
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-display text-lg" style={{ color: "var(--text)" }}>
          Highest delivery %, volume above 30-day average
        </h2>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          As of {data.asOf}
        </span>
      </div>

      {data.results.length === 0 ? (
        <div className="rounded-lg border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
          No stocks currently clear both filters.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Symbol</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Close</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Deliv. %</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>vs Avg Vol</th>
                <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>10-day trend</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r, i) => (
                <>
                  <tr
                    key={r.symbol}
                    className="border-b cursor-pointer hover:bg-white/5"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}
                  >
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-5" style={{ color: "var(--accent)" }}>{i + 1}</span>
                        <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{r.symbol}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.close)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--gain)" }}>{fmt(r.deliveryPct)}%</td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.volumeRatio ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                    </td>
                    <td className="py-2.5 pl-2 pr-4">
                      <DeliverySparkline history={r.deliveryHistory} />
                    </td>
                  </tr>
                  {expanded === r.symbol && (
                    <tr style={{ background: "var(--surface-2)" }}>
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex gap-4 flex-wrap">
                          {r.deliveryHistory.map((d) => (
                            <div key={d.date} className="flex flex-col items-center">
                              <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                                {d.date.slice(5)}
                              </span>
                              <span className="font-mono text-xs" style={{ color: "var(--text)" }}>
                                {d.deliveryPct == null ? "—" : `${fmt(d.deliveryPct)}%`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Tap a row to see the exact delivery % for each of the last 10 trading days. BE-series
        stocks (100% delivery by rule) are excluded.
      </p>
    </div>
  );
}
