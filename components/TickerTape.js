"use client";

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
  if (!quotes || quotes.length === 0) return null;
  // duplicate the list so the marquee loops seamlessly
  const doubled = [...quotes, ...quotes];

  return (
    <div
      className="overflow-hidden border-b"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      aria-label="Live price ticker"
    >
      <div className="ticker-track">
        {doubled.map((q, i) => (
          <TickerItem q={q} key={`${q.symbol}-${i}`} />
        ))}
      </div>
    </div>
  );
}
