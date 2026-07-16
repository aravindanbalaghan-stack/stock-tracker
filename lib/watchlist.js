const STORAGE_KEY = "panel:watchlist";

export const DEFAULT_WATCHLIST = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "TATAMOTORS",
];

export function loadWatchlist() {
  if (typeof window === "undefined") return DEFAULT_WATCHLIST;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WATCHLIST;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

export function saveWatchlist(symbols) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

// Per-symbol metadata — the price a stock had when it was added to the
// watchlist, and freeform personal notes. Kept as a separate store, keyed
// by symbol, so the plain symbol-list store above doesn't need to change
// shape (avoids touching every other place that reads/writes it).
const META_STORAGE_KEY = "panel:watchlist-meta";

export function loadWatchlistMeta() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveWatchlistMeta(meta) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
}
