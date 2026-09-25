// Browser-local fallback for Holdings — same pattern as lib/watchlist.js,
// used when there's no signed-in identity yet or server storage isn't
// configured, so the Holdings tab still works standalone.

const STORAGE_KEY = "panel:holdings";

export function loadHoldings() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHoldingsLocal(holdings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
}
