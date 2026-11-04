"use client";

import BreakoutsTab from "@/components/BreakoutsTab";
import WmaScreenTab from "@/components/WmaScreenTab";
import ScreenerTab from "@/components/ScreenerTab";
import LookbackTab from "@/components/LookbackTab";
import PicksScreenerTab from "@/components/PicksScreenerTab";
import { SubNav } from "@/components/ui/Chrome";
import { usePersistentState } from "@/lib/usePersistentState";
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
