// One set of number formatters for the whole app.
//
// Before this, ~30 components each carried their own copy of fmt /
// fmtVolume / fmtTurnover / fmtCap, and the copies had drifted (one
// showed "12.4K", another "12,400"; one showed ₹0 Cr, another "—"). Every
// screen now formats the same number the same way.
//
// Conventions (Indian market):
//   prices      1,234.50          en-IN grouping, 2 decimals
//   volume      1.24Cr / 12.40L / 45,600
//   turnover    ₹1,234 Cr / ₹56.4 Cr / ₹3.21 Cr
//   market cap  ₹2.31L Cr / ₹45,120 Cr
//   percent     +1.24% (signed) or 1.24%
//   missing     "—" everywhere

export const DASH = "—";

const missing = (n) => n === null || n === undefined || (typeof n === "number" && Number.isNaN(n));

/** Plain number with fixed decimals and Indian digit grouping. */
export function fmt(n, d = 2) {
  if (missing(n)) return DASH;
  const v = Number(n);
  if (!Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

/** Price with a rupee sign. */
export function fmtPrice(n, d = 2) {
  return missing(n) ? DASH : `₹${fmt(n, d)}`;
}

/** Share counts in crore / lakh / plain. */
export function fmtVolume(n) {
  if (missing(n)) return DASH;
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  return Math.round(v).toLocaleString("en-IN");
}

/** An amount already expressed in crore (turnover, traded value). */
export function fmtTurnover(cr) {
  if (missing(cr)) return DASH;
  const v = Number(cr);
  const a = Math.abs(v);
  if (a >= 1000) return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
  if (a >= 10) return `₹${v.toFixed(1)} Cr`;
  return `₹${v.toFixed(2)} Cr`;
}

/** Market cap in crore; lakh-crore for the giants. */
export function fmtCap(cr) {
  if (missing(cr)) return DASH;
  const v = Number(cr);
  if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(2)}L Cr`;
  return `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
}

/** Percent, unsigned. */
export function fmtPct(n, d = 2) {
  return missing(n) ? DASH : `${fmt(n, d)}%`;
}

/** Percent with an explicit + for gains. */
export function fmtSignedPct(n, d = 2) {
  if (missing(n)) return DASH;
  return `${Number(n) >= 0 ? "+" : ""}${fmt(n, d)}%`;
}

/** Signed plain number (e.g. change in points). */
export function fmtSigned(n, d = 2) {
  if (missing(n)) return DASH;
  return `${Number(n) >= 0 ? "+" : ""}${fmt(n, d)}`;
}

/** Ratio like 1.35×. */
export function fmtRatio(n, d = 2) {
  return missing(n) ? DASH : `${Number(n).toFixed(d)}×`;
}

/** CSS colour token for a signed value. */
export function toneOf(n) {
  if (missing(n) || Number(n) === 0) return "var(--text-faint)";
  return Number(n) > 0 ? "var(--gain)" : "var(--loss)";
}
