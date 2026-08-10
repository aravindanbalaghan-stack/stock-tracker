import { kv } from "@vercel/kv";
import { SECTOR_LIST as BASE_SECTOR_LIST } from "@/lib/sectors";

// User-added sector memberships, stored server-side so they apply
// everywhere — the sector screens, the stock insight page, and anything
// else that resolves a stock's sector — rather than only in the browser
// that added them. Uses the same KV store the alerts feature already
// relies on (see lib/alertsStore.js).
//
// Shape: { [sectorKey]: string[] } — extra symbols added to that sector.
// Base membership in lib/sectors.js is never mutated; overrides are merged
// on read, so a bad addition can always be removed without touching the
// hand-maintained lists.

const OVERRIDES_KEY = "sector-overrides";

export async function getSectorOverrides() {
  try {
    const stored = await kv.get(OVERRIDES_KEY);
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    // KV not configured, or unreachable. The app still works — it just
    // runs on the base sector lists.
    return {};
  }
}

export async function addSymbolToSector(sectorKey, symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");
  if (!BASE_SECTOR_LIST.some((s) => s.key === sectorKey)) throw new Error("Unknown sector");

  const overrides = await getSectorOverrides();
  const existing = new Set(overrides[sectorKey] ?? []);

  // Already there through the base list — nothing to store, and saying so
  // is more useful than silently succeeding.
  const base = BASE_SECTOR_LIST.find((s) => s.key === sectorKey);
  if (base.symbols.includes(clean)) {
    return { added: false, reason: "already-in-sector", overrides };
  }
  if (existing.has(clean)) return { added: false, reason: "already-added", overrides };

  existing.add(clean);
  const next = { ...overrides, [sectorKey]: [...existing].sort() };
  await kv.set(OVERRIDES_KEY, next);
  return { added: true, overrides: next };
}

export async function removeSymbolFromSector(sectorKey, symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  const overrides = await getSectorOverrides();
  const existing = (overrides[sectorKey] ?? []).filter((s) => s !== clean);
  const next = { ...overrides, [sectorKey]: existing };
  if (existing.length === 0) delete next[sectorKey];
  await kv.set(OVERRIDES_KEY, next);
  return { removed: true, overrides: next };
}

/**
 * The sector list every consumer should use: base membership plus any
 * user additions, with `addedSymbols` kept separate so the UI can show
 * which entries were added manually and offer to remove them.
 */
export async function getResolvedSectorList() {
  const overrides = await getSectorOverrides();
  return BASE_SECTOR_LIST.map((sector) => {
    const added = (overrides[sector.key] ?? []).filter((s) => !sector.symbols.includes(s));
    return {
      ...sector,
      symbols: [...sector.symbols, ...added],
      addedSymbols: added,
    };
  });
}

/**
 * Every sector a symbol belongs to. A stock genuinely can sit in several
 * (a bank is in both "Banking" and "PSU Banks"), so this returns all of
 * them rather than picking one.
 */
export async function getSectorsForSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  const list = await getResolvedSectorList();
  return list
    .filter((s) => s.symbols.includes(clean))
    .map((s) => ({ key: s.key, name: s.name, viaOverride: s.addedSymbols.includes(clean) }));
}
