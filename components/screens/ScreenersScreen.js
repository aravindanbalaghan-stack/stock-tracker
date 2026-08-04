"use client";

import { useState } from "react";
import BreakoutsTab from "@/components/BreakoutsTab";
import WmaScreenTab from "@/components/WmaScreenTab";
import ScreenerTab from "@/components/ScreenerTab";
import { SubNav } from "@/components/ui/Chrome";
import { SCREENS, SCREEN_ORDER, CONFLUENCE_SCREEN, CONFLUENCE_DEF, ALL_SCREEN_IDS } from "@/lib/screens";

// Every view here answers "find me stocks matching a fixed set of
// conditions" — the difference is the conditions, not the kind of thing
// they are. The first two are built into the app; the rest are the
// Chartink screens, which all share one implementation (ScreenerTab) and
// one API route because they display identical columns.
const BUILT_IN = [
  { id: "breakouts", label: "Breakouts" },
  { id: "wma", label: "30WMA watch" },
];

const VIEWS = [
  ...BUILT_IN,
  ...SCREEN_ORDER.map((id) => ({ id, label: SCREENS[id].label })),
  { id: CONFLUENCE_SCREEN, label: CONFLUENCE_DEF.label },
];

export default function ScreenersScreen({ onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  const [view, setView] = useState("breakouts");

  return (
    <div>
      <div className="mb-4">
        <SubNav items={VIEWS} active={view} onChange={setView} />
      </div>

      {view === "breakouts" && (
        <BreakoutsTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
      {view === "wma" && <WmaScreenTab />}

      {ALL_SCREEN_IDS.includes(view) && (
        <ScreenerTab
          key={view}
          screen={view}
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  );
}
