"use client";

import { useState } from "react";
import DeliveryTab from "@/components/DeliveryTab";
import SectorDeliveryTab from "@/components/SectorDeliveryTab";
import PeriodToggle from "@/components/PeriodToggle";
import DatePicker from "@/components/DatePicker";
import { ScreenHeader } from "@/components/ui/Chrome";
import { DELIVERY_BUCKETS } from "@/lib/deliveryBuckets";
import { usePersistentState } from "@/lib/usePersistentState";

// One tab per delivery-% bucket (see lib/deliveryBuckets.js) rather than
// the old "By stock" / "By sector" split — each bucket tab now shows
// BOTH, stacked (sectors above, stocks below), since the two answer the
// same question ("where is delivery-based accumulation happening right
// now") at different granularities and belong together at a given
// threshold, not split across separate tabs. Period, as-of date, and the
// stage toggle are owned here and shared by both sections below.

export default function DeliveryScreen({ onAddToWatchlist, watchlistSymbols }) {
  const [bucket, setBucket] = usePersistentState("delivery.bucket", "60");
  const [period, setPeriod] = usePersistentState("delivery.period", "daily");
  const [asOfDate, setAsOfDate] = usePersistentState("delivery.date", "");
  const [showStage, setShowStage] = usePersistentState("delivery.showStage", false);

  const activeBucket = DELIVERY_BUCKETS.find((b) => b.id === bucket) ?? DELIVERY_BUCKETS[3];

  return (
    <div>
      <ScreenHeader
        title="Delivery"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <PeriodToggle period={period} onChange={setPeriod} />
            <button
              type="button"
              onClick={() => setShowStage((v) => !v)}
              className="px-2.5 py-1 rounded-[var(--radius-sm)] border text-xs"
              style={{
                borderColor: showStage ? "var(--accent)" : "var(--border)",
                color: showStage ? "var(--accent)" : "var(--text-muted)",
              }}
              title="Show each sector's composite stage and each stock's own Weinstein stage — reads weekly history per symbol, so it takes a moment the first time"
            >
              {showStage ? "Stage on" : "Show stage"}
            </button>
            <DatePicker value={asOfDate} onChange={setAsOfDate} />
          </div>
        }
      />

      <div className="flex gap-1 mb-5 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
        {DELIVERY_BUCKETS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBucket(b.id)}
            className="px-3 py-2 text-sm border-b-2 whitespace-nowrap"
            style={{
              borderColor: bucket === b.id ? "var(--accent)" : "transparent",
              color: bucket === b.id ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="mb-8">
        <SectorDeliveryTab
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
          bucket={bucket}
          period={period}
          asOfDate={asOfDate}
          showStage={showStage}
        />
      </div>

      <div>
        <DeliveryTab
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
          bucket={bucket}
          bucketLabel={activeBucket.label}
          period={period}
          asOfDate={asOfDate}
          showStage={showStage}
        />
      </div>
    </div>
  );
}
