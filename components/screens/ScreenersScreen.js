"use client";

import { useState } from "react";
import BreakoutsTab from "@/components/BreakoutsTab";
import WmaScreenTab from "@/components/WmaScreenTab";
import { SubNav } from "@/components/ui/Chrome";

// Both are "find me stocks matching a fixed set of conditions" screens —
// the difference is the conditions, not the kind of thing they are.
const VIEWS = [
  { id: "breakouts", label: "Breakouts" },
  { id: "wma", label: "30WMA watch" },
];

export default function ScreenersScreen({ onAddToWatchlist, watchlistSymbols }) {
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
    </div>
  );
}
