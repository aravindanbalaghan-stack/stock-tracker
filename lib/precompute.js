// Instant tabs — results computed once per trading day and served from
// Redis, instead of every visit re-reading NSE files and Yahoo history.
//
// HOW IT FITS TOGETHER
//   - serveCached() wraps a route's GET. For the "latest session" form of a
//     request (no past date, no live overlay) it returns the stored result
//     straight away if it belongs to the session the app should be showing
//     now; otherwise it computes as before, stores the result, and returns
//     it. So even without the nightly job, only the FIRST visit per session
//     is slow.
//   - The nightly job (app/api/cron/precompute) calls every such request
//     once after NSE publishes its files, with a header that forces a fresh
//     compute — so by morning every tab is already warm.
//
// WHICH SESSION SHOULD BE SHOWING
//   NSE's end-of-day files land in the evening. Until EOD_READY_MINUTES
//   (19:30 IST) on a trading day, the latest complete session is the
//   previous trading day; after it, today. Weekends and holidays roll back.
//   A stored result is served when its own data date matches that session,
//   or — if NSE hasn't published yet — when it was re-checked in the last
//   RECHECK_MS, so a late NSE file doesn't make every visit slow.
//
// Large results are split across several keys (CHUNK chars each) to stay
// well inside Upstash's per-request size limit.

import { kv } from "@/lib/kv";
import { getHolidaySet } from "@/lib/marketCalendar";
import { isNonTradingDate, istToday, istNowMinutes } from "@/lib/marketHours";

const PREFIX = "pre:v1:";
const CHUNK = 400_000;
const EOD_READY_MINUTES = 19 * 60 + 30;
const RECHECK_MS = 20 * 60 * 1000;
export const STATUS_KEY = "pre:v1:status";

export async function expectedSession() {
  const holidays = await getHolidaySet().catch(() => new Set());
  let d = istToday();
  const ready = istNowMinutes() >= EOD_READY_MINUTES;
  if (!(ready && !isNonTradingDate(d, holidays))) {
    // Step back to the previous trading day.
    const x = new Date(`${d}T00:00:00Z`);
    do {
      x.setUTCDate(x.getUTCDate() - 1);
      d = x.toISOString().slice(0, 10);
    } while (isNonTradingDate(d, holidays));
  }
  return d;
}

async function putBig(key, value) {
  const s = JSON.stringify(value);
  const n = Math.max(1, Math.ceil(s.length / CHUNK));
  // Each chunk wrapped in an object: Upstash auto-parses values that look
  // like JSON, which would mangle a bare string slice.
  await Promise.all(Array.from({ length: n }, (_, i) => kv.set(`${key}:c${i}`, { d: s.slice(i * CHUNK, (i + 1) * CHUNK) })));
  return n;
}

async function getBig(key, n) {
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => kv.get(`${key}:c${i}`)));
  if (parts.some((p) => typeof p?.d !== "string")) return null;
  return JSON.parse(parts.map((p) => p.d).join(""));
}

/** The data date a response belongs to, from whichever field it uses. */
function sessionOf(body) {
  const d = body?.asOf ?? body?.latestDate ?? body?.date ?? body?.today ?? null;
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * opts:
 *   name       route name, part of the key
 *   vary       query params that change the result (part of the key)
 *   cacheable  (searchParams) → boolean — only "latest session" requests
 */
export async function serveCached(request, opts, compute) {
  const url = new URL(request.url);
  const sp = url.searchParams;
  if (!opts.cacheable(sp)) return compute(request);

  const key = `${PREFIX}${opts.name}:${opts.vary.map((v) => `${v}=${sp.get(v) ?? ""}`).join("&")}`;
  const force = request.headers.get("x-panel-refresh") === "1";
  const expected = await expectedSession();

  if (!force) {
    try {
      const meta = await kv.get(key);
      if (meta?.chunks && (meta.session === expected || Date.now() - (meta.checkedAt ?? 0) < RECHECK_MS)) {
        const body = await getBig(key, meta.chunks);
        if (body) {
          return Response.json(
            { ...body, _cache: { at: meta.at, session: meta.session } },
            { headers: { "x-panel-cache": "hit" } }
          );
        }
      }
    } catch {
      // No KV / unreachable — just compute.
    }
  }

  const res = await compute(request);
  if (!res.ok) return res;
  let body;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  const at = new Date().toISOString();
  // A view still building its history (lib/marketPanel.js) says so; caching
  // it would pin the partial answer until the next session.
  if (body?.incomplete) {
    return Response.json({ ...body, _cache: { at, session: sessionOf(body) ?? expected, fresh: true } }, { headers: { "x-panel-cache": "skip" } });
  }
  try {
    const chunks = await putBig(key, body);
    await kv.set(key, { chunks, at, checkedAt: Date.now(), session: sessionOf(body) ?? expected });
  } catch {
    // Storing is best-effort.
  }
  return Response.json({ ...body, _cache: { at, session: sessionOf(body) ?? expected, fresh: true } }, { headers: { "x-panel-cache": "miss" } });
}
