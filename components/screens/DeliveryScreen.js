"use client";

import { useState } from "react";
import DeliveryTab from "@/components/DeliveryTab";
import SectorDeliveryTab from "@/components/SectorDeliveryTab";
import DeliveryEventsTab from "@/components/DeliveryEventsTab";
import DeliveryEntryTab from "@/components/DeliveryEntryTab";
import MoversTab from "@/components/MoversTab";
import { SubNav } from "@/components/ui/Chrome";

// All three views answer "where is delivery-based accumulation happening" —
// one ranks individual stocks, one rolls the same bhavcopy data up by
// sector, and one looks backwards at what actually followed the strongest
// volume + delivery days. They share the Daily/Weekly/Monthly period idea
// and the as-of date, so they belong together.
const VIEWS = [
  { id: "stocks", label: "By stock" },
  { id: "sectors", label: "By sector" },
  { id: "events", label: "Events & follow-through" },
  { id: "entry", label: "Entry" },
  { id: "movers", label: "Movers" },
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
      {view === "events" && (
        <DeliveryEventsTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
      {view === "entry" && (
        <DeliveryEntryTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
      {view === "movers" && (
        <MoversTab onAddToWatchlist={onAddToWatchlist} watchlistSymbols={watchlistSymbols} />
      )}
    </div>
  );
}
