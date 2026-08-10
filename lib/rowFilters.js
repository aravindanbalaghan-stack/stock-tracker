// Shared price/volume range filtering, so "price above 500" means the same
// thing on every screen rather than each tab inventing its own rules.
//
// Blank means "no bound" — an empty Min price is not the same as 0, and a
// blank Max is not Infinity-by-accident. Rows missing the field entirely
// are kept when no bound is set on it and dropped when one is, since a
// row with no price can't honestly be said to satisfy "price above 500".

export const EMPTY_NUMERIC_FILTERS = {
  minPrice: "",
  maxPrice: "",
  minVolume: "",
  maxVolume: "",
};

function toNumber(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hasActiveNumericFilters(filters) {
  return Object.values(filters ?? {}).some((v) => toNumber(v) !== null);
}

/**
 * Applies the bounds to a row set. `priceKey`/`volumeKey` let each screen
 * point at whatever it calls those columns — the Events tab filters on the
 * event-day price, the screens on the current close.
 */
export function applyNumericFilters(rows, filters, { priceKey = "close", volumeKey = "volume" } = {}) {
  if (!rows || !hasActiveNumericFilters(filters)) return rows;

  const minP = toNumber(filters.minPrice);
  const maxP = toNumber(filters.maxPrice);
  const minV = toNumber(filters.minVolume);
  const maxV = toNumber(filters.maxVolume);

  return rows.filter((r) => {
    const price = r?.[priceKey];
    const volume = r?.[volumeKey];

    if (minP !== null || maxP !== null) {
      if (price == null) return false;
      if (minP !== null && price < minP) return false;
      if (maxP !== null && price > maxP) return false;
    }
    if (minV !== null || maxV !== null) {
      if (volume == null) return false;
      if (minV !== null && volume < minV) return false;
      if (maxV !== null && volume > maxV) return false;
    }
    return true;
  });
}

/** Serialises the active bounds onto a query string, skipping blanks. */
export function appendNumericParams(qs, filters) {
  for (const [key, value] of Object.entries(filters ?? {})) {
    const n = toNumber(value);
    if (n !== null) qs.set(key, String(n));
  }
  return qs;
}

/** Reads the same bounds back out of a request's search params. */
export function readNumericParams(searchParams) {
  const out = {};
  for (const key of Object.keys(EMPTY_NUMERIC_FILTERS)) {
    const raw = searchParams.get(key);
    const n = raw == null || raw === "" ? null : Number(raw);
    out[key] = Number.isFinite(n) ? n : null;
  }
  return out;
}

/** Server-side counterpart of applyNumericFilters, working on parsed numbers. */
export function passesNumericBounds({ price, volume }, bounds) {
  if (!bounds) return true;
  const { minPrice, maxPrice, minVolume, maxVolume } = bounds;

  if (minPrice != null || maxPrice != null) {
    if (price == null) return false;
    if (minPrice != null && price < minPrice) return false;
    if (maxPrice != null && price > maxPrice) return false;
  }
  if (minVolume != null || maxVolume != null) {
    if (volume == null) return false;
    if (minVolume != null && volume < minVolume) return false;
    if (maxVolume != null && volume > maxVolume) return false;
  }
  return true;
}
