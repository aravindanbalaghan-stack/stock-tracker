import { BROWSER_UA as UA } from "@/lib/browserUA";

// Live (delayed) quotes for the alert engine — price, previous close, day
// change and volume per NSE symbol, from Yahoo's chart endpoint (the same
// source /api/quote uses for the Watchlist).

const istDate = (s) => new Date(s * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function one(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(`${symbol}.NS`)}?interval=1d&range=5d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const r = (await res.json())?.chart?.result?.[0];
    if (!r) return null;
    const meta = r.meta ?? {};
    const ts = r.timestamp ?? [];
    const closes = r.indicators?.quote?.[0]?.close ?? [];
    const price = meta.regularMarketPrice ?? null;
    if (price == null) return null;
    const session = meta.regularMarketTime ? istDate(meta.regularMarketTime) : null;
    let prevClose = null;
    for (let i = ts.length - 1; i >= 0; i--) {
      if (closes[i] != null && session && istDate(ts[i]) < session) {
        prevClose = closes[i];
        break;
      }
    }
    prevClose ??= meta.chartPreviousClose ?? meta.previousClose ?? null;
    return {
      symbol,
      price,
      prevClose,
      changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
      volume: meta.regularMarketVolume ?? null,
      session,
    };
  } catch {
    return null;
  }
}

/** Map(symbol → quote) for up to a few hundred symbols, 8 at a time. */
export async function fetchLiveQuotes(symbols) {
  const list = [...new Set(symbols)];
  const out = new Map();
  let k = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, list.length) }, async () => {
      while (k < list.length) {
        const s = list[k++];
        const q = await one(s);
        if (q) out.set(s, q);
      }
    })
  );
  return out;
}
