"use client";

import DeliveryTab from "@/components/DeliveryTab";
import SectorDeliveryTab from "@/components/SectorDeliveryTab";
import PeriodToggle from "@/components/PeriodToggle";
import DatePicker from "@/components/DatePicker";
import { ScreenHeader } from "@/components/ui/Chrome";
import { DELIVERY_BUCKETS } from "@/lib/deliveryBuckets";
import { usePersistentState } from "@/lib/usePersistentState";

// A "Sectors" tab (the full, unfiltered sector list — same as before the
// bucket tabs existed) sits alongside one tab per delivery-% bucket (see
// lib/deliveryBuckets.js). Each bucket tab shows stocks only now — the
// two used to be stacked together on every bucket tab, but a sector's
// own delivery % doesn't naturally belong to just one stock-level bucket
// the way a stock does, so splitting them back out reads more clearly:
// Sectors for the overview, a bucket tab when you want to drill into
// stocks at a specific delivery-% range. Period, as-of date, and the
// stage toggle are owned here and shared by both views.
const SECTORS_TAB = { id: "sectors", label: "Sectors" };
const TABS = [SECTORS_TAB, ...DELIVERY_BUCKETS];

export default function DeliveryScreen({ onAddToWatchlist, watchlistSymbols }) {
  const [view, setView] = usePersistentState("delivery.view", "60");
  const [period, setPeriod] = usePersistentState("delivery.period", "daily");
  const [asOfDate, setAsOfDate] = usePersistentState("delivery.date", "");
  const [showStage, setShowStage] = usePersistentState("delivery.showStage", false);

  const isSectors = view === "sectors";
  const activeBucket = DELIVERY_BUCKETS.find((b) => b.id === view) ?? DELIVERY_BUCKETS[3];

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
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className="px-3 py-2 text-sm border-b-2 whitespace-nowrap"
            style={{
              borderColor: view === t.id ? "var(--accent)" : "transparent",
              color: view === t.id ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isSectors ? (
        <SectorDeliveryTab
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
          period={period}
          asOfDate={asOfDate}
          showStage={showStage}
        />
      ) : (
        <DeliveryTab
          onAddToWatchlist={onAddToWatchlist}
          watchlistSymbols={watchlistSymbols}
          bucket={view}
          bucketLabel={activeBucket.label}
          period={period}
          asOfDate={asOfDate}
          showStage={showStage}
        />
      )}
    </div>
  );
}
