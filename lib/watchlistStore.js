import { kv } from "@vercel/kv";

// Per-user watchlist, stored server-side and keyed by the logged-in
// identity. Previously the watchlist lived in localStorage, which meant it
// was per-BROWSER, not per-user: signing in elsewhere showed an empty list,
// and two people sharing a machine shared a watchlist.
//
// Each entry records where it was added from, so a stock that turned up in
// a screener weeks ago is still identifiable as such rather than being
// indistinguishable from one added by hand.
//
// Falls back cleanly when KV isn't configured — callers treat a null return
// as "server storage unavailable" and keep using local storage, so the app
// still works on a deployment without the binding.

const PREFIX = "watchlist:";

function keyFor(identity) {
  return `${PREFIX}${String(identity).trim().toLowerCase()}`;
}

/** Normalises a stored list into the current entry shape. */
function normalise(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      // Tolerate the older shape, where entries were bare symbol strings.
      if (typeof e === "string") {
        return { symbol: e.toUpperCase(), source: null, addedAt: null, addedPrice: null, notes: "" };
      }
      if (!e || typeof e !== "object" || !e.symbol) return null;
      return {
        symbol: String(e.symbol).toUpperCase(),
        source: e.source ?? null,
        sourceLabel: e.sourceLabel ?? null,
        addedAt: e.addedAt ?? null,
        addedPrice: e.addedPrice ?? null,
        notes: e.notes ?? "",
      };
    })
    .filter(Boolean);
}

export async function getWatchlist(identity) {
  if (!identity) return null;
  try {
    const stored = await kv.get(keyFor(identity));
    return normalise(stored);
  } catch {
    return null; // KV unavailable — caller falls back to local storage
  }
}

export async function saveWatchlist(identity, entries) {
  if (!identity) throw new Error("Not signed in");
  const clean = normalise(entries);
  await kv.set(keyFor(identity), clean);
  return clean;
}

export async function addToWatchlist(identity, { symbol, source, sourceLabel }) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");

  const current = (await getWatchlist(identity)) ?? [];
  if (current.some((e) => e.symbol === clean)) {
    return { added: false, reason: "already-present", entries: current };
  }

  const next = [
    ...current,
    {
      symbol: clean,
      source: source ?? null,
      sourceLabel: sourceLabel ?? null,
      addedAt: new Date().toISOString(),
      addedPrice: null, // backfilled by the quote poll once a price arrives
      notes: "",
    },
  ];
  await kv.set(keyFor(identity), next);
  return { added: true, entries: next };
}

export async function removeFromWatchlist(identity, symbol) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  const current = (await getWatchlist(identity)) ?? [];
  const next = current.filter((e) => e.symbol !== clean);
  await kv.set(keyFor(identity), next);
  return { entries: next };
}

export async function updateWatchlistEntry(identity, symbol, patch) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  const current = (await getWatchlist(identity)) ?? [];
  const next = current.map((e) => (e.symbol === clean ? { ...e, ...patch, symbol: e.symbol } : e));
  await kv.set(keyFor(identity), next);
  return { entries: next };
}
