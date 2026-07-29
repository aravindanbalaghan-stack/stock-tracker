// Listing-debut price: what a stock opened at on its very first day of
// trading, and how far today's price sits from it.
//
// Two things worth knowing about the number this produces:
//
//  1. It's the LISTING-DAY OPEN, not the IPO issue price. Those differ —
//     often a lot, since listing day frequently opens at a premium or
//     discount to what subscribers paid. "Where it first traded" is what
//     the debut column reports.
//
//  2. Yahoo's OHLC is split- and bonus-adjusted. For a company that has
//     split since listing, the debut open shown here is the adjusted
//     figure, so it will NOT match the original headline price. That's
//     deliberate: today's price is on the same adjusted basis, so the
//     comparison stays apples-to-apples and the "above/below debut"
//     verdict is correct in real terms. It just means the rupee figure
//     isn't the historical headline number for older listings.
//
// The fetch uses interval=3mo rather than daily bars: a quarterly bar's
// open IS the open of the first trading day in that quarter, so the first
// bar of a max-range quarterly series gives the debut open exactly, while
// returning ~120 bars for a 30-year history instead of ~7,500.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// A listing debut is a historical fact that can never change, so this is
// cached for 30 days. Repeat loads of any screen cost nothing after the
// first lookup of each symbol.
const DEBUT_CACHE_SECONDS = 60 * 60 * 24 * 30;

export async function fetchDebut(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=3mo&range=max`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: DEBUT_CACHE_SECONDS },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const opens = result.indicators?.quote?.[0]?.open || [];
    const timestamps = result.timestamp || [];

    // First bar with a usable open. Yahoo occasionally leads with a null
    // bar, so this scans forward rather than blindly taking index 0.
    let debutOpen = null;
    let debutBarTime = null;
    for (let i = 0; i < opens.length; i++) {
      if (opens[i] != null && opens[i] > 0) {
        debutOpen = opens[i];
        debutBarTime = timestamps[i] ?? null;
        break;
      }
    }
    if (debutOpen == null) return null;

    // meta.firstTradeDate is the precise listing date; the quarterly bar's
    // timestamp is only the start of the quarter, so prefer the former.
    const firstTrade = result.meta?.firstTradeDate ?? debutBarTime;

    return {
      debutOpen: Math.round(debutOpen * 100) / 100,
      debutDate: firstTrade ? new Date(firstTrade * 1000).toISOString().slice(0, 10) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Batch lookup with bounded concurrency, reusing anything already in
 * `cache` (a Map) so a symbol appearing on several screens in one request
 * is only fetched once. Mirrors lib/wma.js's fetchWma30Batch.
 */
export async function fetchDebutBatch(symbols, { concurrency = 8, cache } = {}) {
  const results = cache instanceof Map ? cache : new Map();
  const unique = [...new Set(symbols)].filter((s) => !results.has(s));

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const values = await Promise.all(batch.map((s) => fetchDebut(s).catch(() => null)));
    batch.forEach((s, idx) => results.set(s, values[idx]));
  }
  return results;
}

/**
 * Attaches debut fields to a row: the debut open, its date, and how far
 * the current close sits from it. `vsDebutPct` is what the "above or
 * below debut" column reads from — positive means trading above its
 * listing price, negative means below.
 */
export function withDebut(row, debut) {
  if (!debut || debut.debutOpen == null || row.close == null) {
    return { ...row, debutOpen: null, debutDate: null, vsDebutPct: null };
  }
  const pct = ((row.close - debut.debutOpen) / debut.debutOpen) * 100;
  return {
    ...row,
    debutOpen: debut.debutOpen,
    debutDate: debut.debutDate,
    vsDebutPct: Math.round(pct * 100) / 100,
  };
}
