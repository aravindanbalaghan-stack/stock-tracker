"use client";

import { useEffect, useState } from "react";
import { marketIsOpen } from "@/lib/marketHours";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function TickerItem({ q }) {
  const up = (q.change ?? 0) >= 0;
  return (
    <div className="flex items-center gap-2 px-6 py-2 whitespace-nowrap border-r" style={{ borderColor: "var(--border)" }}>
      <span className="font-mono text-xs tracking-wide" style={{ color: "var(--text-muted)" }}>
        {q.symbol}
      </span>
      <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
        ₹{fmt(q.price)}
      </span>
      <span
        className="font-mono text-xs"
        style={{ color: up ? "var(--gain)" : "var(--loss)" }}
      >
        {up ? "▲" : "▼"} {fmt(Math.abs(q.changePercent ?? 0))}%
      </span>
    </div>
  );
}

export default function TickerTape({ quotes }) {
  // Scrolling implies live movement. When NSE is shut the prices are
  // frozen at the last close, so animating them is misleading — the tape
  // holds still and says so instead. Computed client-side after mount to
  // avoid a server/client mismatch, since the two can disagree on time.
  const [open, setOpen] = useState(null);
  useEffect(() => {
    const check = () => setOpen(marketIsOpen());
    check();
    // Re-check periodically so the tape starts and stops on its own across
    // the open and close without needing a reload.
    const id = setInterval(check, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!quotes || quotes.length === 0) return null;

  // Duplicating the list is only needed for a seamless loop. When static,
  // one copy avoids rendering everything twice for no reason.
  const items = open ? [...quotes, ...quotes] : quotes;

  return (
    <div
      className="overflow-hidden border-b flex items-stretch"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-label={open ? "Live price ticker" : "Price ticker — market closed"}
    >
      {open === false && (
        <div
          className="flex items-center gap-1.5 px-3 shrink-0 border-r"
          style={{ borderColor: "var(--border)" }}
          title="NSE is closed — these are last-traded prices, not live"
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
