// Single source of truth for where you can go in Panel. The tab bar, the
// ⌘K command bar and the "g + key" shortcuts all read from here, so a new
// tab only has to be added once.

import { SCREENS, CONFLUENCE_SCREEN, CONFLUENCE_DEF, MAIN_SCREEN_IDS, ARCHIVE_SCREEN_IDS } from "@/lib/screens";

// `key` is the second key of the "g then key" shortcut (g h → Home).
export const TABS = [
  { id: "home", label: "Home", key: "h" },
  { id: "watchlist", label: "Watchlist", key: "w" },
  { id: "holdings", label: "Holdings", key: "p", keywords: "portfolio positions" },
  { id: "journal", label: "Journal", key: "j", keywords: "trades log" },
  { id: "analysis", label: "Analysis", key: "a", keywords: "daily view studies plan" },
  { id: "market", label: "Market", key: "m", keywords: "indices movers" },
  { id: "delivery", label: "Delivery", key: "d", keywords: "accumulation" },
  { id: "trading", label: "Trading Suggestions", key: "t", keywords: "connors setups fno" },
  { id: "screeners", label: "Screeners", key: "s", keywords: "scans" },
  { id: "sectors", label: "Sectors", key: "e", keywords: "themes industry" },
  { id: "data", label: "Stock Data", key: "x", keywords: "import export master" },
];

export function tabHref(id) {
  return id === "home" ? "/" : `/?tab=${encodeURIComponent(id)}`;
}

// Screens inside a tab that the command bar can jump straight to.
// `store` is the usePersistentState key the screen keeps its sub-view in.
export const SUB_VIEWS = [
  ...MAIN_SCREEN_IDS.map((id) => ({ tab: "screeners", view: id, label: SCREENS[id].label, group: "Screeners" })),
  { tab: "screeners", view: "picks", label: "Odds-ranked picks", group: "Screeners" },
  ...[
    { id: "breakouts", label: "Breakouts" },
    { id: "wma", label: "30WMA watch" },
    ...ARCHIVE_SCREEN_IDS.map((id) => ({ id, label: SCREENS[id].label })),
    { id: CONFLUENCE_SCREEN, label: CONFLUENCE_DEF.label },
    { id: "lookback", label: "Lookback (10d)" },
  ].map((v) => ({ tab: "screeners", view: "archive", archiveView: v.id, label: v.label, group: "Screeners · Archive" })),
  { tab: "delivery", view: "sectors", label: "Delivery · Sectors", group: "Delivery" },
  { tab: "delivery", view: "themes", label: "Delivery · Themes", group: "Delivery" },
  { tab: "delivery", view: "top-weekly", label: "Delivery · Top 20 Weekly", group: "Delivery" },
  { tab: "delivery", view: "top-monthly", label: "Delivery · Top 20 Monthly", group: "Delivery" },
];

// Fired on window when the command bar asks an already-open screen to
// switch its sub-view (a mounted screen won't re-read sessionStorage).
export const VIEW_EVENT = "panel:navigate-view";
export const PALETTE_EVENT = "panel:open-palette";

const FILTER_PREFIX = "panel:filters:"; // matches lib/usePersistentState.js

/** Pre-select a sub-view so it's showing when the tab mounts. */
export function presetSubView(sv) {
  try {
    const set = (k, v) => window.sessionStorage.setItem(FILTER_PREFIX + k, JSON.stringify(v));
    if (sv.tab === "screeners") {
      set("screeners.view", sv.view);
      if (sv.archiveView) set("screeners.archiveView", sv.archiveView);
    } else if (sv.tab === "delivery") {
      set("delivery.view", sv.view);
    }
  } catch {
    /* storage blocked — the tab still opens, on its default view */
  }
  window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: sv }));
}
