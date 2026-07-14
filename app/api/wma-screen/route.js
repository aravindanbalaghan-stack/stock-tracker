import { MIDCAP_UNIVERSE } from "@/lib/midcapUniverse";
import { NIFTY50_UNIVERSE } from "@/lib/nifty50";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const WMA_WEEKS = 30;
const CROSS_LOOKBACK_DAYS = 7; // trading days
const NEAR_BAND_PCT = 1; // +/- 1%
const MIN_DELIVERY_PCT = 60;
const CONCURRENCY = 8;

// Universe: large + mid cap — deduped, since this kind of "pull back to
// the 30WMA" setup is normally screened on liquid, established names.
const UNIVERSE = [...new Set([...NIFTY50_UNIVERSE, ...MIDCAP_UNIVERSE])];

async function fetchDailySeries(symbol) {
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
    const bars = timestamps
      .map((t, i) => ({ t, c: closes[i] }))
      .filter((b) => b.c != null);

    return bars;
  } catch {
    return null;
  }
}

// Resample a daily bar series into one closing price per ISO week
// (Mon-Sun), oldest first. This avoids a second Yahoo request just to get
// weekly candles — we already have enough daily history in one call.
function toWeeklyCloses(bars) {
  const weeks = new Map(); // "YYYY-Wnn" -> last close seen that week
  for (const bar of bars) {
    const d = new Date(bar.t * 1000);
    // ISO week key: good enough here since we only need a stable,
    // monotonically-ordered grouping, not the literal ISO week number.
    const monday = new Date(d);
    const day = (monday.getUTCDay() + 6) % 7; // 0 = Monday
    monday.setUTCDate(monday.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, bar.c); // later bars in the same week overwrite — keeps the last
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => c);
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function evaluateSymbol(symbol) {
  const bars = await fetchDailySeries(symbol);
  if (!bars || bars.length < 40) return null;

  const weeklyCloses = toWeeklyCloses(bars);
  // Drop the current, still-forming week — only use completed weeks for
  // the average.
  const completedWeeks = weeklyCloses.slice(0, -1);
  if (completedWeeks.length < WMA_WEEKS) return null;

  const wma30 = average(completedWeeks.slice(-WMA_WEEKS));

  const recentDaily = bars.slice(-(CROSS_LOOKBACK_DAYS + 1)); // need one extra for the "before" comparison
  if (recentDaily.length < 2) return null;

  const latestClose = recentDaily[recentDaily.length - 1].c;

  // Did price cross from below to at/above the 30WMA at any point in the
  // last N trading days? We treat the 30WMA as roughly constant across
  // this short window (it only moves once a new week completes), which is
  // a standard simplification for this kind of screen.
  let crossedUp = false;
  for (let i = 1; i < recentDaily.length; i++) {
    const prev = recentDaily[i - 1].c;
    const curr = recentDaily[i].c;
    if (prev < wma30 && curr >= wma30) {
      crossedUp = true;
      break;
    }
  }
  if (!crossedUp) return null;

  const distancePct = ((latestClose - wma30) / wma30) * 100;
  if (Math.abs(distancePct) > NEAR_BAND_PCT) return null;

  return { symbol, price: latestClose, wma30, distancePct };
}

export async function GET() {
  try {
    // Delivery % comes from NSE's own bhavcopy (Yahoo doesn't have it) —
    // just need the single latest trading day.
    const bhavDays = await getRecentBhavcopies(2);
    const latestBhav = bhavDays[bhavDays.length - 1];

    const candidates = [];
    for (let i = 0; i < UNIVERSE.length; i += CONCURRENCY) {
      const batch = UNIVERSE.slice(i, i + CONCURRENCY);
      const evaluated = await Promise.all(batch.map(evaluateSymbol));
      for (const r of evaluated) if (r) candidates.push(r);
    }

    const withDelivery = candidates
      .map((c) => {
        const deliveryPct = latestBhav?.bySymbol.get(c.symbol)?.deliveryPct ?? null;
        return { ...c, deliveryPct };
      })
      .filter((c) => c.deliveryPct != null && c.deliveryPct >= MIN_DELIVERY_PCT);

    withDelivery.sort((a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

    return Response.json({
      asOf: latestBhav?.date ?? null,
      results: withDelivery,
      universeSize: UNIVERSE.length,
      criteria: {
        wmaWeeks: WMA_WEEKS,
        crossLookbackDays: CROSS_LOOKBACK_DAYS,
        nearBandPct: NEAR_BAND_PCT,
        minDeliveryPct: MIN_DELIVERY_PCT,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compute 30WMA screen", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
