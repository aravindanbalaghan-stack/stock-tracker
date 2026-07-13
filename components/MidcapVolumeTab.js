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

export default function MidcapVolumeTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/midcap-volume");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load midcap screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000); // this data only changes once/day — no need to poll fast
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
          Midcap stocks trading above 30-day average volume
        </h2>
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          As of {data.asOf}
        </span>
      </div>

      {data.results.length === 0 ? (
        <div className="rounded-lg border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
          No midcap stocks are currently trading above their 30-day average volume.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Symbol</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Close</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Chg %</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Volume</th>
                <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>30d Avg</th>
                <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>vs Avg</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r, i) => {
                const up = (r.changePercent ?? 0) >= 0;
                return (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-5" style={{ color: "var(--accent)" }}>{i + 1}</span>
                        <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{r.symbol}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.close)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                      {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(r.volume)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-faint)" }}>{fmtVolume(r.avgVolume30d)}</td>
                    <td className="py-2.5 pl-2 pr-4 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.volumeRatio ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
