"use client";

// Market-cap category beside a stock's name: Mega / Large / Mid / Small /
// Micro / Nano, with the ₹ figure behind it. Cut-offs: lib/sizing.js.

import { useEffect, useState } from "react";
import { capBucket, CAP_BUCKETS } from "@/lib/sizing";

const TONE = {
  mega: "var(--accent)",
  large: "var(--accent)",
  mid: "var(--gain)",
  small: "var(--tier-mid)",
  micro: "var(--tier-low)",
  nano: "var(--loss)",
};

function cutoffs() {
  return CAP_BUCKETS.map((b, i) => {
    const upper = CAP_BUCKETS[i - 1]?.minCr;
    const f = (n) => `₹${n.toLocaleString("en-IN")} Cr`;
    return `${b.label}: ${upper ? `${b.minCr ? f(b.minCr) : "below"} – ${f(upper)}` : `${f(b.minCr)}+`}`.replace("below – ", "below ");
  }).join("\n");
}

export default function CapBadge({ symbol }) {
  const [state, setState] = useState({ symbol: null, cr: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market-cap?symbols=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setState({ symbol, cr: j?.results?.[symbol] ?? null }))
      .catch(() => !cancelled && setState({ symbol, cr: null }));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state.symbol !== symbol || state.cr == null) return null;
  const b = capBucket(state.cr);
  const color = TONE[b.id] ?? "var(--text-muted)";
  return (
    <span
      className="px-1.5 py-0.5 rounded border font-medium"
      style={{ borderColor: color, color }}
      title={`Market cap ₹${state.cr.toLocaleString("en-IN")} Cr\n\n${cutoffs()}\n\nLarge/mid follow AMFI's rank-based list (top 100 / next 150); mega, micro and nano are common market shorthand.`}
    >
      {b.label} · ₹{state.cr.toLocaleString("en-IN")} Cr
    </span>
  );
}
