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
// delivery, one bucket per period.
//
// Four figures per bucket, and the ORDER matters:
//   price move  — was delivery happening into strength or weakness
//   delivery %  — the ratio
//   delivered   — the actual shares taken, in absolute terms
//   traded      — total volume, the ratio's denominator
//
// Delivery % alone is genuinely misleading when volume is falling: the
// ratio is delivered ÷ traded, so as speculative volume drains away the
// percentage climbs even while fewer and fewer shares are actually being
// taken. A sector whose volume collapsed 87% can show delivery rising from
// 42% to 57% while delivered quantity fell 83%. Showing the absolute
// figure next to the ratio is what makes that visible.
export default function DeliveryHistoryPanel({ history }) {
  if (!history || history.length === 0) {
    return (
      <div className="px-4 py-3 text-xs" style={{ color: "var(--text-faint)" }}>
        No recent history available.
      </div>
    );
  }

  const hasQty = history.some((d) => d.deliveryQty != null);
  const hasChange = history.some((d) => d.changePercent != null);

  // Trend direction of delivered quantity across the strip — the check
  // that separates real accumulation from a shrinking denominator.
  const qtys = history.map((d) => d.deliveryQty).filter((v) => v != null);
  let qtyTrend = null;
  if (qtys.length >= 4) {
    const half = Math.floor(qtys.length / 2);
    const first = qtys.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const second = qtys.slice(-half).reduce((a, b) => a + b, 0) / half;
    if (first > 0) qtyTrend = Math.round(((second - first) / first) * 100);
  }

  const pctFirst = history.find((d) => d.deliveryPct != null)?.deliveryPct;
  const pctLast = [...history].reverse().find((d) => d.deliveryPct != null)?.deliveryPct;
  const pctRising = pctFirst != null && pctLast != null && pctLast > pctFirst;

  return (
    <div className="px-4 py-3">
      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {history.map((d, i) => {
            const up = (d.changePercent ?? 0) >= 0;
            return (
              <div key={d.startDate ?? d.date ?? i} className="flex flex-col items-center min-w-[76px]">
                <span className="text-[10px] whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
                  {periodLabel(d)}
                </span>
                {hasChange && (
                  <span
                    className="font-mono text-[11px] mt-1"
                    style={{ color: d.changePercent == null ? "var(--text-faint)" : up ? "var(--gain)" : "var(--loss)" }}
                  >
                    {d.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(d.changePercent, 1)}%`}
                  </span>
                )}
                <span className="font-mono text-sm mt-0.5" style={{ color: "var(--text)" }}>
                  {d.deliveryPct == null ? "—" : `${fmt(d.deliveryPct)}%`}
                </span>
                {hasQty && (
                  <span
                    className="font-mono text-[10px] mt-0.5"
                    style={{ color: "var(--accent)" }}
                    title="Shares actually delivered — the numerator behind the percentage"
                  >
                    {fmtVolume(d.deliveryQty)}
                  </span>
                )}
                <span
                  className="font-mono text-[10px] mt-0.5"
                  style={{ color: "var(--text-faint)" }}
                  title="Total traded volume — the denominator"
                >
                  {fmtVolume(d.volume)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-2.5 text-[10px] flex-wrap" style={{ color: "var(--text-faint)" }}>
        <span>move</span>
        <span style={{ color: "var(--text)" }}>delivery %</span>
        <span style={{ color: "var(--accent)" }}>delivered</span>
        <span>traded</span>
        {qtyTrend != null && (
          <span
            className="ml-auto"
            style={{ color: qtyTrend >= 0 ? "var(--gain)" : "var(--loss)" }}
            title="Change in shares actually delivered, comparing the second half of this window to the first"
          >
            Delivered quantity {qtyTrend >= 0 ? "up" : "down"} {Math.abs(qtyTrend)}% across the window
            {pctRising && qtyTrend < 0 && (
              <span style={{ color: "var(--loss)" }}>
                {" "}
                — delivery % rose while fewer shares were taken, so the ratio is being lifted by falling
                volume rather than by more buying
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
