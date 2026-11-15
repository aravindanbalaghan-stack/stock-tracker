// Pure money-management maths, safe to use in the browser (the Position
// sizer recalculates as you type). Server-side analytics live in
// lib/portfolio.js.

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// Market-cap buckets. SEBI's actual rule is by rank (top 100 large, 101–250
// mid); these ₹ cut-offs approximate where those ranks fall today.
export const CAP_BUCKETS = [
  { id: "large", label: "Large cap", minCr: 100000 },
  { id: "mid", label: "Mid cap", minCr: 33000 },
  { id: "small", label: "Small cap", minCr: 5000 },
  { id: "micro", label: "Micro cap", minCr: 0 },
];
export function capBucket(cr) {
  if (cr == null) return { id: "unknown", label: "Unknown" };
  return CAP_BUCKETS.find((b) => cr >= b.minCr) ?? CAP_BUCKETS[CAP_BUCKETS.length - 1];
}

export const DEFAULT_SETTINGS = {
  capital: null, // ₹ — total trading capital; falls back to portfolio value
  riskPct: 1, // % of capital risked per trade
  maxPositionPct: 20,
  maxSectorPct: 30,
  maxOpenRiskPct: 6, // total of (price − stop) × qty across holdings
  breadthAdjust: true, // scale suggested risk with the Breadth verdict
};

/** Shares for a trade under the risk rules. */
export function sizePosition({ capital, riskPct, maxPositionPct, entry, stop, multiplier = 1 }) {
  if (!(capital > 0) || !(entry > 0) || !(stop > 0) || stop >= entry) return null;
  const riskBudget = capital * (riskPct / 100) * multiplier;
  const perShare = entry - stop;
  const byRisk = Math.floor(riskBudget / perShare);
  const byCap = Math.floor((capital * (maxPositionPct / 100)) / entry);
  const shares = Math.max(0, Math.min(byRisk, byCap));
  return {
    shares,
    cappedBy: byCap < byRisk ? "position limit" : "risk",
    positionValue: r2(shares * entry),
    positionPct: r2(((shares * entry) / capital) * 100),
    riskAmount: r2(shares * perShare),
    riskPctOfCapital: r2(((shares * perShare) / capital) * 100),
    stopPct: r2((stop / entry - 1) * 100),
    riskBudget: r2(riskBudget),
    targets: [1, 2, 3].map((m) => ({ r: m, price: r2(entry + m * perShare), pct: r2((m * perShare * 100) / entry) })),
  };
}

