// Every screener's daily picks, kept so they can be graded later.
//
// One Redis key per screen: `signals:v1:<screenId>` → { dates: { "YYYY-MM-DD": [symbols] } },
// the last ~300 sessions. Written by recordScreenSnapshot (each time a
// screen computes the latest session, which the nightly job does for every
// screen), so the log grows by itself.
//
// History from before this existed is recovered once from the per-stock
// occurrence log lib/screenerMembership.js has always kept (up to ~120
// sessions per stock per screen) — see backfillSignalLogs.

import { kv } from "@/lib/kv";

const KEY = (id) => `signals:v1:${id}`;
const INDEX_KEY = "signals:v1:index"; // [screenIds]
const BACKFILL_KEY = "signals:v1:backfilled";
const MAX_DATES = 300;

function trim(dates) {
  const keys = Object.keys(dates).sort();
  if (keys.length <= MAX_DATES) return dates;
  const keep = keys.slice(-MAX_DATES);
  return Object.fromEntries(keep.map((k) => [k, dates[k]]));
}

async function addToIndex(ids) {
  const idx = (await kv.get(INDEX_KEY).catch(() => null)) ?? [];
  const next = [...new Set([...(Array.isArray(idx) ? idx : []), ...ids])];
  if (next.length !== (idx?.length ?? 0)) await kv.set(INDEX_KEY, next);
}

/** Records one screen's picks for one session (replaces that session's list). */
export async function recordSignals(screenId, date, symbols) {
  try {
    const doc = (await kv.get(KEY(screenId))) ?? { dates: {} };
    doc.dates = trim({ ...(doc.dates ?? {}), [date]: [...new Set(symbols)] });
    await kv.set(KEY(screenId), doc);
    await addToIndex([screenId]);
  } catch {
    /* storage not configured — the scorecard just has nothing to grade */
  }
}

export async function listSignalScreens() {
  const idx = await kv.get(INDEX_KEY).catch(() => null);
  return Array.isArray(idx) ? idx : [];
}

/** { screenId: { date: [symbols] } } */
export async function getSignalLogs(ids) {
  if (!ids.length) return {};
  const docs = await kv.mget(...ids.map(KEY)).catch(() => ids.map(() => null));
  return Object.fromEntries(ids.map((id, i) => [id, docs[i]?.dates ?? {}]));
}

/**
 * One-off: rebuild the logs from the per-stock occurrence history
 * (screener-membership:symbol:<SYM> → { occurrences: { screenId: [dates] } }).
 * Runs once per deployment's storage; safe to re-run (it merges).
 */
export async function backfillSignalLogs({ budgetMs = 12_000 } = {}) {
  if (await kv.get(BACKFILL_KEY).catch(() => null)) return { skipped: true };
  const started = Date.now();
  const merged = {}; // screenId → date → Set
  let cursor = "0";
  let scanned = 0;
  do {
    const [next, keys] = await kv.scan(cursor, { match: "screener-membership:symbol:*", count: 500 });
    cursor = String(next);
    if (keys.length) {
      for (let i = 0; i < keys.length; i += 50) {
        const chunk = keys.slice(i, i + 50);
        const docs = await kv.mget(...chunk);
        chunk.forEach((k, j) => {
          const sym = k.slice("screener-membership:symbol:".length);
          const occ = docs[j]?.occurrences;
          if (!occ) return;
          for (const [screen, dates] of Object.entries(occ)) {
            if (!Array.isArray(dates)) continue;
            const m = (merged[screen] ??= {});
            for (const d of dates) (m[d] ??= new Set()).add(sym);
          }
        });
      }
      scanned += keys.length;
    }
    if (Date.now() - started > budgetMs) return { partial: true, scanned };
  } while (cursor !== "0");

  const ids = Object.keys(merged);
  const existing = await getSignalLogs(ids);
  for (const id of ids) {
    const dates = { ...existing[id] };
    for (const [d, set] of Object.entries(merged[id])) {
      dates[d] = [...new Set([...(dates[d] ?? []), ...set])];
    }
    await kv.set(KEY(id), { dates: trim(dates) });
  }
  await addToIndex(ids);
  await kv.set(BACKFILL_KEY, { at: new Date().toISOString(), scanned, screens: ids.length });
  return { scanned, screens: ids.length };
}
