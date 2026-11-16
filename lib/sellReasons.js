// Why a holding was sold — picked in the sell dialog, analysed on
// Holdings → Closed. Client-safe (no server imports).
//
// `kind` groups reasons for the analysis:
//   plan           — a rule you set in advance fired (stop, target, trailing
//                    stop, trend break, time stop)
//   judgement      — a considered decision (story changed, valuation,
//                    better use of money, rebalancing, market turning)
//   outside        — not about the stock (needed the money) or emotion

export const SELL_REASONS = [
  { id: "stop_hit", label: "Stop-loss hit", kind: "plan" },
  { id: "target_hit", label: "Target reached", kind: "plan" },
  { id: "trailing_stop", label: "Trailing stop / protect profit", kind: "plan" },
  { id: "trend_broke", label: "Trend broke (below 50-DMA / 30-week, Stage 3–4)", kind: "plan" },
  { id: "time_stop", label: "Not moving (time stop)", kind: "plan" },
  { id: "thesis_changed", label: "Story changed (results, news, management)", kind: "judgement" },
  { id: "valuation", label: "Valuation stretched", kind: "judgement" },
  { id: "better_opportunity", label: "Better opportunity elsewhere", kind: "judgement" },
  { id: "rebalance", label: "Reduce size / rebalance", kind: "judgement" },
  { id: "market_weak", label: "Market turning weak", kind: "judgement" },
  { id: "need_cash", label: "Needed the money", kind: "outside" },
  { id: "fear", label: "Nervous / fear of losing", kind: "outside" },
  { id: "other", label: "Other", kind: "judgement" },
];
export const SELL_REASON_BY_ID = Object.fromEntries(SELL_REASONS.map((r) => [r.id, r]));

export const REASON_KINDS = {
  plan: "Planned exit",
  judgement: "Judgement call",
  outside: "Outside / emotional",
  unknown: "Reason not recorded",
};

export const PLAN_FOLLOWED = [
  { id: "yes", label: "Yes, as planned" },
  { id: "no", label: "No, I deviated" },
  { id: "none", label: "I had no plan" },
];

export const reasonLabel = (id) => SELL_REASON_BY_ID[id]?.label ?? (id ? id : "Not recorded");
export const reasonKind = (id) => SELL_REASON_BY_ID[id]?.kind ?? "unknown";
