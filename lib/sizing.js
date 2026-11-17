// Pure money-management maths, safe to use in the browser (the Position
// sizer recalculates as you type). Server-side analytics live in
// lib/portfolio.js.

const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// Market-cap buckets. SEBI's actual rule is by rank (AMFI list: top 100
// large, 101–250 mid, 251+ small), refreshed every January and July. The
// large/mid cut-offs below approximate where those ranks fell in the
// Aug 2026 list (≈ ₹1,07,000 Cr and ≈ ₹32,800 Cr). Mega, micro and nano
// aren't SEBI categories — they're the market's common shorthand for the
// very top (₹5 lakh Cr+, roughly the ten biggest companies), the tail
// below the Nifty 500's range (under ₹5,000 Cr), and the tiniest listed
// companies (under ₹500 Cr), which carry the most liquidity risk.
export const CAP_BUCKETS = [
  { id: "mega", label: "Mega cap", short: "Mega", minCr: 500000 },
  { id: "large", label: "Large cap", short: "Large", minCr: 107000 },
  { id: "mid", label: "Mid cap", short: "Mid", minCr: 32800 },
  { id: "small", label: "Small cap", short: "Small", minCr: 5000 },
  { id: "micro", label: "Micro cap", short: "Micro", minCr: 500 },
  { id: "nano", label: "Nano cap", short: "Nano", minCr: 0 },
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

