// The last few stocks you opened, for the command bar's empty state.
const KEY = "panel:recent-symbols";
const MAX = 8;

export function loadRecentSymbols() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((s) => typeof s === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentSymbol(symbol) {
  if (!symbol) return;
  const s = String(symbol).toUpperCase();
  try {
    const next = [s, ...loadRecentSymbols().filter((x) => x !== s)].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
}
