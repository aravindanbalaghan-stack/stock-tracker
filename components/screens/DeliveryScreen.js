"use client";

import { useState } from "react";
import DeliveryTab from "@/components/DeliveryTab";
import SectorDeliveryTab from "@/components/SectorDeliveryTab";
import { SubNav } from "@/components/ui/Chrome";

// Both views answer "where is delivery-based accumulation happening" —
// one ranks individual stocks, the other rolls the same bhavcopy data up
// by sector. They also share the Daily/Weekly/Monthly period concept, so
// keeping them apart as sibling top-level tabs made the relationship
// harder to see than it needed to be.
const VIEWS = [
  { id: "stocks", label: "By stock" },
  { id: "sectors", label: "By sector" },
];

export default function DeliveryScreen({ onAddToWatchlist, watchlistSymbols }) {
  const [view, setView] = useState("stocks");
  return (
    <div>
      <div className="mb-4">
        <SubNav items={VIEWS} active={view} onChange={setView} />
      </div>
      {view === "stocks" && (
        <DeliveryTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
      {view === "sectors" && (
        <SectorDeliveryTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
    </div>
  );
}
