"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

// Same IST-anchored "now" reasoning as lib/nseBhavcopy.js — the section
// dates come from NSE's IST trading calendar, so "Today"/"Yesterday" must
// be judged against IST, not the browser's local timezone.
function nowIST() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "Yesterday" only makes sense relative to actual calendar days — over a
// weekend, Friday's session is "3 days ago" by the calendar even though
// it's the very next trading day, so we don't try to force
// "day before yesterday"-style labels past the first two sections. Every
// other section just gets its plain date, which stays unambiguous.
function sectionLabel(dateStr) {
  const today = nowIST();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateStr === ymd(today)) return "Today";
  if (dateStr === ymd(yesterday)) return "Yesterday";

  const d = new Date(`${dateStr}T00:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

function SectionTable({ rows }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border py-8 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
        No stocks cleared all three filters this day.
      </div>
    );
  }
  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Symbol</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Close</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Chg %</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Deliv. %</th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>Volume</th>
            <th className="py-2 pl-2 pr-4 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>vs Avg Vol</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
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
                <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--gain)" }}>{fmt(r.deliveryPct)}%</td>
                <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(r.volume)}</td>
                <td className="py-2.5 pl-2 pr-4 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                  {r.volumeRatio ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function BreakoutsTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/breakouts");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load breakout screen");
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
        Pulling NSE data — this can take a moment the first time…
      </div>
    );
  }

  const sections = data.sections || [];

  return (
    <div>
      <h2 className="font-display text-lg mb-4" style={{ color: "var(--text)" }}>
        Breakouts
      </h2>

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.date}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {sectionLabel(section.date)}
              </h3>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>{section.date}</span>
              <span className="text-xs" style={{ color: "var(--text-faint)" }}>· {section.results.length} match{section.results.length === 1 ? "" : "es"}</span>
            </div>
            <SectionTable rows={section.results} />
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs" style={{ color: "var(--text-faint)" }}>
        Each day is evaluated independently: delivery % above {data.criteria?.deliveryPctMin ?? 70}%, price up
        more than {data.criteria?.changePctMin ?? 1}% vs that day&apos;s previous close, and volume at least{" "}
        {data.criteria?.volumeRatioMin ?? 2}× that day&apos;s own trailing 30-day average — a same-day surge
        screen, not a confirmed signal.
      </p>
    </div>
  );
}
