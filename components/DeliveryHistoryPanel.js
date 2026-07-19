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

// "07-14" for a single day, "07-01–07-05" for a multi-day bucket (Weekly/
// Monthly) — falls back to whatever `date` holds if start/end aren't
// present, so this still works with any older/simpler history shape.
function periodLabel(d) {
  const start = d.startDate?.slice(5);
  const end = d.endDate?.slice(5) ?? d.date?.slice(5);
  if (start && end && start !== end) return `${start}–${end}`;
  return end ?? d.date?.slice(5) ?? "—";
}

// Shown when a row (stock or sector) is expanded — the last N periods of
// delivery % and volume, one bucket per period (a single day for Daily, a
// volume-weighted 5-day bucket for Weekly, a volume-weighted 21-day
// bucket for Monthly — see lib/deliveryMetrics.js buildRecentPeriodHistory).
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
        {history.map((d, i) => (
          <div key={d.startDate ?? d.date ?? i} className="flex flex-col items-center min-w-[64px]">
            <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
              {periodLabel(d)}
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
