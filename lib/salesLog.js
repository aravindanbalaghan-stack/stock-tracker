import { kv } from "@/lib/kv";
import { SELL_REASON_BY_ID, PLAN_FOLLOWED } from "@/lib/sellReasons";
import { EMOTIONS } from "@/lib/journalStats";

// Every sale of a holding — partial or the whole position — with why you
// sold. holdings-sales:v1:<identity> → [sale], oldest first, up to 1,000.
//
// sale = { id, symbol, quantity, buyPrice, sellPrice, sellDate, buyDate,
//          pnl, pnlPct, holdDays, full, remaining, reason, note,
//          followedPlan, emotions, stopAtSale, targetAtSale, recordedAt }
//
// Full exits recorded before this log existed (holdings-closed:<identity>)
// are carried over the first time the log is read.

const KEY = (id) => `holdings-sales:v1:${id}`;
const LEGACY = (id) => `holdings-closed:${id}`;
const MAX = 1000;
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const newId = () => `sl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function cleanMeta(raw = {}) {
  const out = {};
  if (raw.reason !== undefined) out.reason = SELL_REASON_BY_ID[raw.reason] ? raw.reason : null;
  if (raw.note !== undefined) out.note = typeof raw.note === "string" ? raw.note.slice(0, 1000) : "";
  if (raw.followedPlan !== undefined) out.followedPlan = PLAN_FOLLOWED.some((p) => p.id === raw.followedPlan) ? raw.followedPlan : null;
  if (raw.emotions !== undefined) out.emotions = Array.isArray(raw.emotions) ? raw.emotions.filter((e) => EMOTIONS.includes(e)).slice(0, 5) : [];
  return out;
}

const daysBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);

export async function getSales(identity) {
  let list;
  try {
    list = await kv.get(KEY(identity));
  } catch {
    return [];
  }
  if (Array.isArray(list)) return list;
  // First read: bring over earlier full exits.
  const legacy = (await kv.get(LEGACY(identity)).catch(() => null)) ?? [];
  const migrated = (Array.isArray(legacy) ? legacy : []).map((c) => ({
    id: newId(),
    symbol: c.symbol,
    quantity: c.quantity,
    buyPrice: c.buyPrice ?? null,
    sellPrice: c.sellPrice ?? null,
    sellDate: c.sellDate ?? null,
    buyDate: c.buyDate ?? null,
    pnl: c.pnl ?? null,
    pnlPct: c.buyPrice && c.sellPrice ? r2((c.sellPrice / c.buyPrice - 1) * 100) : null,
    holdDays: daysBetween(c.buyDate, c.sellDate),
    full: true,
    remaining: 0,
    reason: null,
    note: "",
    followedPlan: null,
    emotions: [],
    recordedAt: new Date().toISOString(),
  }));
  await kv.set(KEY(identity), migrated).catch(() => {});
  return migrated;
}

/** holding = the position BEFORE the sale. */
export async function recordSale(identity, holding, { quantity, price, date, ...meta }) {
  if (!identity || !holding) return null;
  const q = Number(quantity);
  const sellPrice = Number(price) > 0 ? Number(price) : null;
  const buyPrice = holding.avgPrice ?? null;
  const sellDate = typeof date === "string" && date ? date : new Date().toISOString().slice(0, 10);
  const sale = {
    id: newId(),
    symbol: holding.symbol,
    quantity: q,
    buyPrice,
    sellPrice,
    sellDate,
    buyDate: holding.buyDate ?? null,
    pnl: sellPrice != null && buyPrice != null ? r2((sellPrice - buyPrice) * q) : null,
    pnlPct: sellPrice != null && buyPrice ? r2((sellPrice / buyPrice - 1) * 100) : null,
    holdDays: daysBetween(holding.buyDate, sellDate),
    full: q >= holding.quantity,
    remaining: Math.max(0, holding.quantity - q),
    reason: null,
    note: "",
    followedPlan: null,
    emotions: [],
    stopAtSale: holding.stopLoss ?? null,
    targetAtSale: holding.target ?? null,
    recordedAt: new Date().toISOString(),
    ...cleanMeta(meta),
  };
  const list = await getSales(identity);
  await kv.set(KEY(identity), [...list, sale].slice(-MAX));
  return sale;
}

/** Edit why a sale happened (or its note) afterwards. */
export async function updateSale(identity, id, raw) {
  const list = await getSales(identity);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) throw new Error("Sale not found");
  list[i] = { ...list[i], ...cleanMeta(raw), editedAt: new Date().toISOString() };
  await kv.set(KEY(identity), list);
  return list[i];
}

export async function deleteSale(identity, id) {
  const list = (await getSales(identity)).filter((s) => s.id !== id);
  await kv.set(KEY(identity), list);
  return list;
}
