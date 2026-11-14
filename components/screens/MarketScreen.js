"use client";

import { useEffect } from "react";
import IndicesTab from "@/components/IndicesTab";
import MidcapVolumeTab from "@/components/MidcapVolumeTab";
import StocksBySectorTab from "@/components/StocksBySectorTab";
import BreadthTab from "@/components/BreadthTab";
import RotationTab from "@/components/RotationTab";
import { SubNav } from "@/components/ui/Chrome";
import { usePersistentState } from "@/lib/usePersistentState";
import { VIEW_EVENT } from "@/lib/navigation";

// "What's the market doing" — index levels, how broad the move is, where
// money is rotating, and stock-level movers.
const VIEWS = [
  { id: "indices", label: "Indices" },
  { id: "breadth", label: "Breadth" },
  { id: "rotation", label: "Rotation" },
  { id: "midcap", label: "Midcap movers" },
  { id: "directory", label: "All stocks by sector" },
];
const IDS = VIEWS.map((v) => v.id);

export default function MarketScreen() {
  const [stored, setView] = usePersistentState("market.view", "indices");
  const view = IDS.includes(stored) ? stored : "indices";

  // ⌘K "jump to Breadth / Rotation" while this tab is already open.
  useEffect(() => {
    function onView(e) {
      if (e.detail?.tab === "market") setView(e.detail.view);
    }
    window.addEventListener(VIEW_EVENT, onView);
    return () => window.removeEventListener(VIEW_EVENT, onView);
  }, [setView]);

  return (
    <div>
      <div className="mb-4 overflow-x-auto">
        <SubNav items={VIEWS} active={view} onChange={setView} />
      </div>
      {view === "indices" && <IndicesTab />}
      {view === "breadth" && <BreadthTab />}
      {view === "rotation" && <RotationTab />}
      {view === "midcap" && <MidcapVolumeTab />}
      {view === "directory" && <StocksBySectorTab />}
    </div>
  );
}
