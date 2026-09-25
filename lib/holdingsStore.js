import { kv } from "@vercel/kv";

// Per-identity holdings list — same storage pattern and same "identity
// cookie is not real auth" caveat as lib/watchlistStore.js. A holding is
// a watchlist entry plus the position itself: how many shares, and the
// average price paid, so the Holdings tab can show P&L rather than just
// a price.

function keyFor(identity) {
  return `holdings:${identity}`;
}

function normalise(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const symbol = String(e.symbol || "").trim().toUpperCase();
      if (!symbol) return null;
      const quantity = Number(e.quantity);
      if (!(quantity > 0)) return null;
      return {
        symbol,
        quantity,
        avgPrice: e.avgPrice != null && Number.isFinite(Number(e.avgPrice)) ? Number(e.avgPrice) : null,
        buyDate: e.buyDate ?? null,
        notes: e.notes ?? "",
        addedAt: e.addedAt ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

export async function getHoldings(identity) {
  if (!identity) return null;
  try {
    const stored = await kv.get(keyFor(identity));
    return normalise(stored);
  } catch {
    return null; // KV unavailable — caller falls back to local storage
  }
}

export async function saveHoldings(identity, entries) {
  if (!identity) throw new Error("Not signed in");
  const clean = normalise(entries);
  await kv.set(keyFor(identity), clean);
  return clean;
}

/**
 * Add a new holding, or — if the symbol is already held — merge the
 * purchase into the existing position with a recomputed weighted-average
 * cost, the way a real brokerage statement would: new avg = (old qty ×
 * old avg + added qty × added price) ÷ total qty.
 */
export async function addHolding(identity, { symbol, quantity, avgPrice, buyDate }) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");
  const addQty = Number(quantity);
  if (!(addQty > 0)) throw new Error("Quantity must be a positive number");
  const addPrice = avgPrice != null && avgPrice !== "" ? Number(avgPrice) : null;
  if (avgPrice != null && avgPrice !== "" && !Number.isFinite(addPrice)) {
    throw new Error("Average price must be a number");
  }

  const current = (await getHoldings(identity)) ?? [];
  const existingIdx = current.findIndex((e) => e.symbol === clean);

  let next;
  if (existingIdx >= 0) {
    const existing = current[existingIdx];
    const oldQty = existing.quantity;
    const oldAvg = existing.avgPrice ?? addPrice ?? 0;
    const usedAddPrice = addPrice ?? oldAvg;
    const totalQty = oldQty + addQty;
    const newAvg = totalQty > 0 ? (oldQty * oldAvg + addQty * usedAddPrice) / totalQty : usedAddPrice;
    next = [...current];
    next[existingIdx] = {
      ...existing,
      quantity: totalQty,
      avgPrice: Math.round(newAvg * 100) / 100,
    };
  } else {
    next = [
      ...current,
      {
        symbol: clean,
        quantity: addQty,
        avgPrice: addPrice,
        buyDate: buyDate ?? null,
        notes: "",
        addedAt: new Date().toISOString(),
      },
    ];
  }
  await kv.set(keyFor(identity), next);
  return { entries: next };
}

export async function removeHolding(identity, symbol) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  const current = (await getHoldings(identity)) ?? [];
  const next = current.filter((e) => e.symbol !== clean);
  await kv.set(keyFor(identity), next);
  return { entries: next };
}

/** Overwrites a holding's fields directly (quantity, avgPrice, buyDate,
 * notes) rather than merging a new purchase into it — used when someone
 * corrects a typo'd quantity or price rather than adding to a position. */
export async function updateHolding(identity, symbol, patch) {
  if (!identity) throw new Error("Not signed in");
  const clean = String(symbol || "").trim().toUpperCase();
  const current = (await getHoldings(identity)) ?? [];
  const next = current.map((e) => (e.symbol === clean ? { ...e, ...patch, symbol: e.symbol } : e));
  await kv.set(keyFor(identity), next);
  return { entries: next };
}
