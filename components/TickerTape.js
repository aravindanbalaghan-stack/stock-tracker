"use client";

// Header ticker — every NSE index (plus India VIX), not watchlist stocks.
// Scrolls and refreshes every 30s while NSE is in session; on weekends,
// holidays and outside hours it holds still and says Closed, since the
// values are just the last close.

import { useEffect, useState } from "react";
import { marketIsOpen } from "@/lib/marketHours";
import { fmt } from "@/lib/format";

const REFRESH_MS = 30 * 1000;

function TickerItem({ q }) {
  const up = (q.change ?? 0) >= 0;
  return (
    <div className="flex items-center gap-2 px-6 py-2 whitespace-nowrap border-r" style={{ borderColor: "var(--border)" }}>
      <span className="text-xs tracking-wide" style={{ color: "var(--text-muted)" }}>
        {q.name}
      </span>
      <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
        {fmt(q.price)}
      </span>
      <span className="font-mono text-xs" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
        {up ? "▲" : "▼"} {fmt(Math.abs(q.changePercent ?? 0))}%
      </span>
    </div>
  );
}

export default function TickerTape() {
  const [open, setOpen] = useState(null);
  const [indices, setIndices] = useState([]);

  useEffect(() => {
    const check = () => setOpen(marketIsOpen());
    check();
    const id = setInterval(check, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/indices?ticker=1");
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setIndices((json.all ?? []).filter((q) => q.ok));
      } catch {
        /* keep the last values */
      }
    };
    load();
    // Only keep polling while the market is open — closed values don't move.
    if (!open) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open]);

  if (indices.length === 0) return null;
  const items = open ? [...indices, ...indices] : indices;

  return (
    <div
      className="overflow-hidden border-b flex items-stretch"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-label={open ? "Live index ticker" : "Index ticker — market closed"}
    >
      {open === false && (
        <div
          className="flex items-center gap-1.5 px-3 shrink-0 border-r"
          style={{ borderColor: "var(--border)" }}
          title="NSE is closed (outside hours, weekend or market holiday) — these are last closing values"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--text-faint)" }} />
          <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Closed
          </span>
        </div>
      )}
      <div className={open ? "ticker-track" : "flex overflow-x-auto"}>
        {items.map((q, i) => (
          <TickerItem q={q} key={`${q.symbol}-${i}`} />
        ))}
      </div>
    </div>
  );
}
