import { kv } from "@vercel/kv";
import { SECTOR_LIST as BASE_SECTOR_LIST } from "@/lib/sectors";

// User-added (and now user-removed) sector memberships, stored server-side
// so they apply everywhere — the sector screens, the stock insight page,
// Holdings, and anything else that resolves a stock's sector — rather than
// only in the browser that added them. Uses the same KV store the alerts
// feature already relies on (see lib/alertsStore.js).
//
// Two independent overlays sit on top of the hand-maintained base lists in
// lib/sectors.js, which are never mutated directly:
//   - OVERRIDES: { [sectorKey]: string[] } — extra symbols ADDED to a
//     sector that isn't in its base list.
//   - EXCLUSIONS: { [sectorKey]: string[] } — symbols REMOVED from a
//     sector's base list, for when a stock is filed under the wrong
//     sector and the base list itself can't be hand-edited from the UI.
// "Reassigning" a stock's sector (see moveSymbolToSector) is simply an
// exclusion from the old sector plus an override into the new one — both
// reversible independently, so a bad edit can always be undone without
// touching the source-controlled base lists.

const OVERRIDES_KEY = "sector-overrides";
const EXCLUSIONS_KEY = "sector-exclusions";

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

/**
 * Whether the KV store this whole module depends on is actually
 * reachable. getSectorOverrides/getSectorExclusions above quietly return
 * {} either way — on purpose, so every READ path (getResolvedSectorList
 * and everything built on it: sector pages, Delivery's sector column,
 * Holdings) keeps working even when KV isn't configured, same as the
 * rest of this app degrades gracefully. But a person trying to ADD or
 * REASSIGN a sector needs to know their edit genuinely can't be saved,
 * not just get a generic error after the fact — the Sectors tab uses
 * this to show that upfront. Unlike Watchlist/Holdings, there's no
 * browser-local fallback for sector data (it's shared/global, not
 * personal to one browser), so this is the one piece of state in the app
 * that has nothing to silently fall back to.
 */
export async function isSectorStorageAvailable() {
  try {
    await kv.get(OVERRIDES_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function getSectorExclusions() {
  try {
    const stored = await kv.get(EXCLUSIONS_KEY);
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export async function addSymbolToSector(sectorKey, symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");
  if (!BASE_SECTOR_LIST.some((s) => s.key === sectorKey)) throw new Error("Unknown sector");

  const [overrides, exclusions] = await Promise.all([getSectorOverrides(), getSectorExclusions()]);
  const existing = new Set(overrides[sectorKey] ?? []);
  const excluded = new Set(exclusions[sectorKey] ?? []);

  const base = BASE_SECTOR_LIST.find((s) => s.key === sectorKey);
  // In the base list AND not excluded from it — nothing to store.
  if (base.symbols.includes(clean) && !excluded.has(clean)) {
    return { added: false, reason: "already-in-sector", overrides };
  }
  if (existing.has(clean)) return { added: false, reason: "already-added", overrides };

  existing.add(clean);
  const next = { ...overrides, [sectorKey]: [...existing].sort() };
  await kv.set(OVERRIDES_KEY, next);

  // Adding it back should also undo a prior exclusion from this same
  // sector, if there was one — otherwise the add would be immediately
  // cancelled out by getResolvedSectorList's exclusion filter below.
  if (excluded.has(clean)) {
    await includeSymbolInSector(sectorKey, clean);
  }

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

/** Removes a symbol from a sector's BASE (hand-maintained, source-
 * controlled) membership without touching lib/sectors.js — for when a
 * stock is filed under a sector it doesn't actually belong to. Has no
 * effect on a symbol only present via addSymbolToSector's override list;
 * use removeSymbolFromSector for that instead. */
export async function excludeSymbolFromSector(sectorKey, symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");
  if (!BASE_SECTOR_LIST.some((s) => s.key === sectorKey)) throw new Error("Unknown sector");

  const exclusions = await getSectorExclusions();
  const existing = new Set(exclusions[sectorKey] ?? []);
  existing.add(clean);
  const next = { ...exclusions, [sectorKey]: [...existing].sort() };
  await kv.set(EXCLUSIONS_KEY, next);
  return { excluded: true, exclusions: next };
}

/** Undoes excludeSymbolFromSector — restores a symbol to a sector's base
 * membership. */
export async function includeSymbolInSector(sectorKey, symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  const exclusions = await getSectorExclusions();
  const existing = (exclusions[sectorKey] ?? []).filter((s) => s !== clean);
  const next = { ...exclusions, [sectorKey]: existing };
  if (existing.length === 0) delete next[sectorKey];
  await kv.set(EXCLUSIONS_KEY, next);
  return { included: true, exclusions: next };
}

/**
 * Moves a symbol from one sector to another in a single call: excludes it
 * from `fromSectorKey` (if it was there via the base list) or removes it
 * (if it was only there via an override), then adds it to `toSectorKey`.
 * This is what the Sector Manager tab's "change sector" control uses —
 * the user-facing framing is "this stock is filed wrong, move it", not
 * "manage two separate overlay lists".
 */
export async function moveSymbolToSector(symbol, fromSectorKey, toSectorKey) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (!clean) throw new Error("A symbol is required");
  if (!toSectorKey || !BASE_SECTOR_LIST.some((s) => s.key === toSectorKey)) {
    throw new Error("Unknown target sector");
  }

  if (fromSectorKey) {
    const fromBase = BASE_SECTOR_LIST.find((s) => s.key === fromSectorKey);
    if (fromBase?.symbols.includes(clean)) {
      await excludeSymbolFromSector(fromSectorKey, clean);
    } else {
      await removeSymbolFromSector(fromSectorKey, clean);
    }
  }
  const result = await addSymbolToSector(toSectorKey, clean);
  return result;
}

/**
 * The sector list every consumer should use: base membership, minus
 * excluded symbols, plus user-added ones — with `addedSymbols` and
 * `excludedSymbols` kept separate so the UI can show which entries were
 * hand-edited and offer to undo them.
 */
export async function getResolvedSectorList() {
  const [overrides, exclusions] = await Promise.all([getSectorOverrides(), getSectorExclusions()]);
  return BASE_SECTOR_LIST.map((sector) => {
    const excluded = new Set(exclusions[sector.key] ?? []);
    const base = sector.symbols.filter((s) => !excluded.has(s));
    const added = (overrides[sector.key] ?? []).filter((s) => !base.includes(s));
    return {
      ...sector,
      symbols: [...base, ...added],
      addedSymbols: added,
      excludedSymbols: [...excluded],
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

/**
 * Batch form of getSectorsForSymbol — computes the resolved sector list
 * ONCE and maps every requested symbol against it, instead of redoing
 * that work per symbol. Used by the Holdings tab and the Sector Manager
 * tab, both of which need this for many symbols at once.
 */
export async function getSectorsForSymbols(symbols) {
  if (!symbols?.length) return {};
  const list = await getResolvedSectorList();
  const result = {};
  for (const symbol of symbols) {
    result[symbol] = list
      .filter((s) => s.symbols.includes(symbol))
      .map((s) => ({ key: s.key, name: s.name, viaOverride: s.addedSymbols.includes(symbol) }));
  }
  return result;
}

/**
 * Every symbol currently classified into at least one sector, inverted
 * into a symbol -> sectors map — what the Sector Manager tab renders as
 * its main table. Unlike getSectorsForSymbols, this doesn't take a symbol
 * list: it enumerates every symbol the resolved sector list itself
 * contains.
 */
export async function getAllClassifiedSymbols() {
  const list = await getResolvedSectorList();
  const bySymbol = new Map();
  for (const sector of list) {
    for (const symbol of sector.symbols) {
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
      bySymbol.get(symbol).push({
        key: sector.key,
        name: sector.name,
        viaOverride: sector.addedSymbols.includes(symbol),
      });
    }
  }
  return [...bySymbol.entries()]
    .map(([symbol, sectors]) => ({ symbol, sectors }))
    .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

/** The overrides + exclusions overlays, as a single JSON-serialisable
 * object — everything a person has customized on top of the hand-
 * maintained base lists. This is exactly what the Sector Manager tab's
 * Export button downloads, and what Import uploads back: the base lists
 * themselves live in source (lib/sectors.js) and aren't part of this,
 * so exporting never produces a multi-thousand-symbol file. */
export async function exportSectorCustomizations() {
  const [overrides, exclusions] = await Promise.all([getSectorOverrides(), getSectorExclusions()]);
  return { overrides, exclusions, exportedAt: new Date().toISOString() };
}

/** Replaces BOTH overlays wholesale with the given data — the Sector
 * Manager tab's Import button. Deliberately a full replace, not a merge:
 * a person importing a file they exported earlier (to restore a known
 * state, or move customizations to a different deployment) wants exactly
 * what's in the file, not that plus whatever was already there. */
export async function importSectorCustomizations({ overrides, exclusions }) {
  const cleanOverrides = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
  const cleanExclusions = exclusions && typeof exclusions === "object" && !Array.isArray(exclusions) ? exclusions : {};
  await Promise.all([kv.set(OVERRIDES_KEY, cleanOverrides), kv.set(EXCLUSIONS_KEY, cleanExclusions)]);
  return { imported: true };
}
