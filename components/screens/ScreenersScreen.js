"use client";

import BreakoutsTab from "@/components/BreakoutsTab";
import WmaScreenTab from "@/components/WmaScreenTab";
import ScreenerTab from "@/components/ScreenerTab";
import LookbackTab from "@/components/LookbackTab";
import PicksScreenerTab from "@/components/PicksScreenerTab";
import ScorecardTab from "@/components/ScorecardTab";
import CustomScreenerTab from "@/components/CustomScreenerTab";
import { SubNav } from "@/components/ui/Chrome";
import { useEffect } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import { VIEW_EVENT } from "@/lib/navigation";
import {
  SCREENS,
  CONFLUENCE_SCREEN,
  CONFLUENCE_DEF,
  MAIN_SCREEN_IDS,
  ARCHIVE_SCREEN_IDS,
} from "@/lib/screens";

// Front row: the five screens in active use plus the Odds-ranked picks.
// Everything else moved to Archive — still working, just out of the way.
const MAIN_VIEWS = [
  ...MAIN_SCREEN_IDS.map((id) => ({ id, label: SCREENS[id].label })),
  { id: "picks", label: "Odds-ranked picks" },
  { id: "custom", label: "Build your own" },
  { id: "scorecard", label: "Scorecard" },
  { id: "archive", label: "Archive" },
];

const ARCHIVE_VIEWS = [
  { id: "breakouts", label: "Breakouts" },
  { id: "wma", label: "30WMA watch" },
  ...ARCHIVE_SCREEN_IDS.map((id) => ({ id, label: SCREENS[id].label })),
  { id: CONFLUENCE_SCREEN, label: CONFLUENCE_DEF.label },
  { id: "lookback", label: "Lookback (10d)" },
];

const MAIN_IDS = MAIN_VIEWS.map((v) => v.id);
const ARCHIVE_IDS = ARCHIVE_VIEWS.map((v) => v.id);

function View({ view, archived, onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  if (view === "breakouts") return <BreakoutsTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />;
  if (view === "wma") return <WmaScreenTab />;
  if (view === "lookback") return <LookbackTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />;
  if (view === "scorecard") return <ScorecardTab />;
  if (view === "custom") return <CustomScreenerTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />;
  if (view === "picks") return <PicksScreenerTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />;
  return (
    <ScreenerTab
      key={view}
      screen={view}
      archived={archived}
      onAddToWatchlist={onAddToWatchlist}
      watchlistSymbols={watchlistSymbols}
      onOpenDetail={onOpenDetail}
    />
  );
}

export default function ScreenersScreen({ onAddToWatchlist, watchlistSymbols, onOpenDetail }) {
  const [stored, setView] = usePersistentState("screeners.view", MAIN_SCREEN_IDS[0]);
  const [storedArchive, setArchiveView] = usePersistentState("screeners.archiveView", "breakouts");
  // A view id saved before the reshuffle may no longer be in the front row.
  const view = MAIN_IDS.includes(stored) ? stored : MAIN_SCREEN_IDS[0];
  const archiveView = ARCHIVE_IDS.includes(storedArchive) ? storedArchive : "breakouts";
  const props = { onAddToWatchlist, watchlistSymbols, onOpenDetail };

  // ⌘K "jump to screener" while this tab is already open.
  useEffect(() => {
    function onView(e) {
      const sv = e.detail;
      if (sv?.tab !== "screeners") return;
      setView(sv.view);
      if (sv.archiveView) setArchiveView(sv.archiveView);
    }
    window.addEventListener(VIEW_EVENT, onView);
    return () => window.removeEventListener(VIEW_EVENT, onView);
  }, [setView, setArchiveView]);

  return (
    <div>
      <div className="mb-4 overflow-x-auto">
        <SubNav items={MAIN_VIEWS} active={view} onChange={setView} />
      </div>

      {view === "archive" ? (
        <>
          <div className="mb-4 overflow-x-auto">
            <SubNav items={ARCHIVE_VIEWS} active={archiveView} onChange={setArchiveView} />
          </div>
          <View key={`archive-${archiveView}`} view={archiveView} archived {...props} />
        </>
      ) : (
        <View key={view} view={view} archived={false} {...props} />
      )}
    </div>
  );
}
