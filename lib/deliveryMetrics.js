// Shared per-symbol computation used by both the Delivery Leaders screen
// (app/api/delivery/route.js) and the Breakouts screen
// (app/api/breakouts/route.js). Both work off the same bhavcopy history
// (see lib/nseBhavcopy.js), so the per-symbol math lives here once instead
// of being duplicated across routes.

export const ACCUMULATION_WINDOW = 20; // trading days
export const ACCUMULATION_DELIVERY_THRESHOLD = 50; // %
export const ACCUMULATION_MIN_DAYS = 10; // out of the 20-day window

// NSE's daily file has no instrument-type flag, so ETFs/REITs/InvITs are
// told apart from ordinary stocks by naming convention. This catches the
// large majority (most ETFs end in "BEES" or contain "ETF") but isn't
// guaranteed exhaustive — add to KNOWN_NON_STOCK_SYMBOLS if something
// specific slips through.
const ETF_PATTERNS = [/BEES$/i, /ETF/i];
const KNOWN_NON_STOCK_SYMBOLS = new Set([
  // REITs
  "EMBASSY", "MINDSPACE", "BIRET", "NXST",
  // InvITs
  "IRBINVIT", "INDIGRID", "PGINVIT", "ANZEN", "CUBEINVIT", "POWERGRIDINVIT",
  // Common ETFs that don't match the naming patterns above
  "GOLDSHARE", "MON100", "MOM100", "MOM50", "MOGSEC", "MASPTOP50", "MAFANG",
  "LICNETFN50", "SETFNIF50", "SETFNN50", "UTINIFTETF", "HDFCNIFTY",
  "HDFCSML250", "HDFCNEXT50", "HDFCGROWTH", "HDFCSENSEX", "GOLDIETF",
  "SILVERIETF", "AXISGOLD", "ABSLGOLD",
]);

export function classify(symbol) {
  const s = symbol.toUpperCase();
  if (KNOWN_NON_STOCK_SYMBOLS.has(s)) return "other";
  if (ETF_PATTERNS.some((p) => p.test(s))) return "other";
  return "stock";
}

// Core per-symbol computation, shared by the ranked screens and the
// single-symbol search lookup.
export function computeMetrics(symbol, days) {
  const latest = days[days.length - 1];
  const history = days.slice(0, -1);
  const accumulationWindow = days.slice(-ACCUMULATION_WINDOW);

  const today = latest.bySymbol.get(symbol);
  if (!today || today.series !== "EQ" || !today.volume || today.deliveryPct == null) return null;

  const pastVolumes = history
    .map((d) => d.bySymbol.get(symbol)?.volume)
    .filter((v) => typeof v === "number" && v > 0);
  const avgVolume = pastVolumes.length > 0 ? pastVolumes.reduce((a, b) => a + b, 0) / pastVolumes.length : null;

  const changePercent =
    today.prevClose && today.close ? ((today.close - today.prevClose) / today.prevClose) * 100 : null;

  const windowRows = accumulationWindow.map((d) => d.bySymbol.get(symbol)?.deliveryPct ?? null);
  const daysAboveThreshold = windowRows.filter((v) => v != null && v > ACCUMULATION_DELIVERY_THRESHOLD).length;

  const oldestInWindow = accumulationWindow[0]?.bySymbol.get(symbol)?.close ?? null;
  const priceHeldOrRose = oldestInWindow != null ? today.close >= oldestInWindow : null;
  const volumeAboveAvg = avgVolume != null && avgVolume > 0 ? today.volume > avgVolume : false;

  const inAccumulation =
    daysAboveThreshold >= ACCUMULATION_MIN_DAYS && priceHeldOrRose === true && volumeAboveAvg;

  return {
    symbol,
    category: classify(symbol),
    close: today.close,
    changePercent,
    deliveryPct: today.deliveryPct,
    volumeRatio: avgVolume && avgVolume > 0 ? today.volume / avgVolume : null,
    daysOfAccumulation: daysAboveThreshold,
    accumulationWindowDays: windowRows.filter((v) => v != null).length,
    inAccumulation,
    _volumeAboveAvg: volumeAboveAvg,
  };
}
