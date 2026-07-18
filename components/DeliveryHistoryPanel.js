"use client";

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

// Shown when a row (stock or sector) is expanded — the last N trading
// days of delivery % and volume for that symbol/sector.
export default function DeliveryHistoryPanel({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
        No recent history available.
      </div>
    );
  }
  return (
    <div className="px-4 py-3 overflow-x-auto">
      <div className="flex gap-4 min-w-max">
        {history.map((d) => (
          <div key={d.date} className="flex flex-col items-center min-w-[64px]">
            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
              {d.date.slice(5)}
            </span>
            <span className="font-mono text-xs mt-1" style={{ color: "var(--text)" }}>
              {d.deliveryPct == null ? "—" : `${fmt(d.deliveryPct)}%`}
            </span>
            <span className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {fmtVolume(d.volume)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
