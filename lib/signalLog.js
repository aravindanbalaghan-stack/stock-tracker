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
const BACKFILL_KEY = "signals:v1:backfilled-v2"; // v2: resumable import (v1 could stop early)
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
 * One-off import of history from before the signal log existed, from the
 * per-stock occurrence log (screener-membership:symbol:<SYM> →
 * { occurrences: { screenId: [dates] } }).
 *
 * Resumable: it works through the keys a page at a time, merges each page
 * into the logs straight away and saves its cursor, so a slow Redis
 * connection just means it finishes over a few runs instead of starting
 * over every time (the first version restarted from scratch whenever it ran
 * out of time, so on a distant Redis region it never finished). Merging is
 * a union, so re-reading a page is harmless.
 *
 * Returns { done, scanned }.
 */
const BACKFILL_STATE = "signals:v1:backfill-state";

async function mergeIntoLogs(merged) {
  const ids = Object.keys(merged);
  if (!ids.length) return;
  const existing = await getSignalLogs(ids);
  await Promise.all(
    ids.map((id) => {
      const dates = { ...existing[id] };
      for (const [d, set] of Object.entries(merged[id])) dates[d] = [...new Set([...(dates[d] ?? []), ...set])];
      return kv.set(KEY(id), { dates: trim(dates) });
    })
  );
  await addToIndex(ids);
}

export async function backfillSignalLogs({ budgetMs = 20_000 } = {}) {
  if (await kv.get(BACKFILL_KEY).catch(() => null)) return { done: true };
  const started = Date.now();
  const state = (await kv.get(BACKFILL_STATE).catch(() => null)) ?? { cursor: "0", scanned: 0, pages: 0 };
  let cursor = String(state.cursor ?? "0");
  let { scanned = 0, pages = 0 } = state;
  const prefix = "screener-membership:symbol:";
  do {
    const [next, keys] = await kv.scan(cursor, { match: `${prefix}*`, count: 500 });
    cursor = String(next);
    pages++;
    if (keys.length) {
      const chunks = [];
      for (let i = 0; i < keys.length; i += 50) chunks.push(keys.slice(i, i + 50));
      const docsPerChunk = await Promise.all(chunks.map((c) => kv.mget(...c)));
      const merged = {};
      chunks.forEach((chunk, ci) =>
        chunk.forEach((k, j) => {
          const occ = docsPerChunk[ci][j]?.occurrences;
          if (!occ) return;
          const sym = k.slice(prefix.length);
          for (const [screen, dates] of Object.entries(occ)) {
            if (!Array.isArray(dates)) continue;
            const m = (merged[screen] ??= {});
            for (const d of dates) if (typeof d === "string") (m[d] ??= new Set()).add(sym);
          }
        })
      );
      await mergeIntoLogs(merged);
      scanned += keys.length;
    }
    await kv.set(BACKFILL_STATE, { cursor, scanned, pages });
    if (cursor !== "0" && Date.now() - started > budgetMs) return { done: false, scanned };
  } while (cursor !== "0");

  await kv.set(BACKFILL_KEY, { at: new Date().toISOString(), scanned });
  return { done: true, scanned };
}
