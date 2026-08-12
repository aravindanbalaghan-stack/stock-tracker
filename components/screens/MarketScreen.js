"use client";

import { useState } from "react";
import IndicesTab from "@/components/IndicesTab";
import MidcapVolumeTab from "@/components/MidcapVolumeTab";
import StocksBySectorTab from "@/components/StocksBySectorTab";
import { SubNav } from "@/components/ui/Chrome";

// "What's moving right now" — index-level and stock-level views of the
// same question, previously two separate top-level tabs.
const VIEWS = [
  { id: "indices", label: "Indices" },
  { id: "midcap", label: "Midcap movers" },
  { id: "directory", label: "All stocks by sector" },
];

export default function MarketScreen() {
  const [view, setView] = useState("indices");
  return (
    <div>
      <div className="mb-4">
        <SubNav items={VIEWS} active={view} onChange={setView} />
      </div>
      {view === "indices" && <IndicesTab />}
      {view === "midcap" && <MidcapVolumeTab />}
      {view === "directory" && <StocksBySectorTab />}
    </div>
  );
}
