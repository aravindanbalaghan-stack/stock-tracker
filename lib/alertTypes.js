// What you can be alerted about — shared by the alert builder (browser)
// and the alert engine (server). No server imports here.
//
// `when`: "live" rules are checked against live prices whenever the alert
// check runs during market hours (and at the nightly run); "eod" rules
// need a finished session and run only in the nightly check.

export const ALERT_TYPES = [
  { id: "price_above", label: "Price rises above", needs: "price", when: "live", unit: "₹" },
  { id: "price_below", label: "Price falls below", needs: "price", when: "live", unit: "₹" },
  { id: "change_up", label: "Up on the day by at least", needs: "pct", when: "live", unit: "%" },
  { id: "change_down", label: "Down on the day by at least", needs: "pct", when: "live", unit: "%" },
  { id: "volume_surge", label: "Volume reaches × its 20-day average", needs: "mult", when: "live", unit: "×" },
  { id: "cross_above_sma50", label: "Crosses above its 50-day average", when: "live" },
  { id: "cross_below_sma50", label: "Crosses below its 50-day average", when: "live" },
  { id: "cross_above_ma30w", label: "Crosses above its 30-week average", when: "live" },
  { id: "cross_below_ma30w", label: "Crosses below its 30-week average", when: "live" },
  { id: "stage_change", label: "Changes Weinstein stage", when: "eod" },
];
export const ALERT_TYPE_BY_ID = Object.fromEntries(ALERT_TYPES.map((t) => [t.id, t]));

// Alerts that aren't about one stock.
export const MARKET_ALERTS = [
  { id: "screen_new", label: "New stocks appear in a screener", needs: "screen", when: "eod" },
  { id: "breadth_change", label: "Market breadth verdict changes", when: "eod" },
];
export const MARKET_ALERT_BY_ID = Object.fromEntries(MARKET_ALERTS.map((t) => [t.id, t]));

// Automatic alerts on your holdings, switched on/off as a group.
export const AUTO_ALERTS = [
  { id: "stops", label: "A holding closes at or below its stop-loss" },
  { id: "targets", label: "A holding reaches its target price" },
  { id: "stage4", label: "A holding enters Stage 4" },
];

export const DEFAULT_ALERT_SETTINGS = {
  auto: { stops: true, targets: true, stage4: true },
  telegramChatId: null,
};

/** "RELIANCE price rises above ₹3,000" — for lists and notifications. */
export function describeRule(r) {
  if (MARKET_ALERT_BY_ID[r.type]) {
    if (r.type === "screen_new") return `New stocks in ${r.screenLabel ?? r.screenId}`;
    return MARKET_ALERT_BY_ID[r.type].label;
  }
  const t = ALERT_TYPE_BY_ID[r.type];
  if (!t) return r.type;
  const v = r.value == null ? "" : t.unit === "₹" ? ` ₹${Number(r.value).toLocaleString("en-IN")}` : ` ${r.value}${t.unit}`;
  return `${r.symbol} — ${t.label.charAt(0).toLowerCase()}${t.label.slice(1)}${v}`;
}

export function validateRule(raw) {
  const type = String(raw?.type ?? "");
  const market = MARKET_ALERT_BY_ID[type];
  const stock = ALERT_TYPE_BY_ID[type];
  if (!market && !stock) throw new Error("Pick what to be alerted about");
  const rule = {
    type,
    repeat: raw.repeat === "daily" ? "daily" : "once",
    note: typeof raw.note === "string" ? raw.note.slice(0, 200) : "",
  };
  if (stock) {
    const symbol = String(raw.symbol ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Enter an NSE symbol");
    rule.symbol = symbol;
    if (stock.needs) {
      const v = Number(raw.value);
      if (!Number.isFinite(v) || v <= 0) throw new Error(stock.unit === "₹" ? "Enter a price" : stock.unit === "×" ? "Enter a multiple, e.g. 2" : "Enter a percentage");
      rule.value = v;
    }
  } else if (type === "screen_new") {
    if (!raw.screenId) throw new Error("Pick a screener");
    rule.screenId = String(raw.screenId);
    rule.screenLabel = typeof raw.screenLabel === "string" ? raw.screenLabel.slice(0, 80) : rule.screenId;
    rule.repeat = "daily";
  } else {
    rule.repeat = "daily";
  }
  return rule;
}
