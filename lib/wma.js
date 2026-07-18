// Shared 30-week-moving-average helpers. Originally lived only inside
// app/api/wma-screen/route.js; pulled out here so the Delivery Leaders and
// Breakouts screens can show a "30WMA" column without duplicating the
// Yahoo daily-series fetch + weekly-resample logic.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const WMA_WEEKS = 30;

export async function fetchDailySeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=1y`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      next: { revalidate: 1800 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    return timestamps.map((t, i) => ({ t, c: closes[i] })).filter((b) => b.c != null);
  } catch {
    return null;
  }
}

// Resample a daily bar series into one closing price per ISO week
// (Mon-Sun), oldest first.
export function toWeeklyCloses(bars) {
  const weeks = new Map();
  for (const bar of bars) {
    const d = new Date(bar.t * 1000);
    const monday = new Date(d);
    const day = (monday.getUTCDay() + 6) % 7; // 0 = Monday
    monday.setUTCDate(monday.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, bar.c); // later bars in the same week overwrite — keeps the last
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => c);
}

export function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Current 30WMA for a single symbol, or null if there isn't enough
// history yet (recent listing, illiquid, or Yahoo lookup failed).
export async function fetchWma30(symbol) {
  const bars = await fetchDailySeries(symbol);
  if (!bars || bars.length < 40) return null;

  const weeklyCloses = toWeeklyCloses(bars);
  // Drop the current, still-forming week — only completed weeks count.
  const completedWeeks = weeklyCloses.slice(0, -1);
  if (completedWeeks.length < WMA_WEEKS) return null;

  return average(completedWeeks.slice(-WMA_WEEKS));
}

// Batch lookup with bounded concurrency, reusing any values already in
// `cache` (a Map) so the same symbol is never fetched twice within one
// request — useful when the same stock shows up across multiple sections
// (e.g. Breakouts' per-day tables).
export async function fetchWma30Batch(symbols, { concurrency = 8, cache } = {}) {
  const results = cache instanceof Map ? cache : new Map();
  const unique = [...new Set(symbols)].filter((s) => !results.has(s));

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const values = await Promise.all(batch.map((s) => fetchWma30(s).catch(() => null)));
    batch.forEach((s, idx) => results.set(s, values[idx]));
  }

  return results;
}
