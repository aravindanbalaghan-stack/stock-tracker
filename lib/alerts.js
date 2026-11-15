// Alerts: your rules, the engine that checks them, and delivery.
//
// Storage (per account):
//   alerts:v1:<user>          [rule]                  your alert rules
//   alert-settings:v1:<user>  { auto, telegramChatId } automatic holding alerts + Telegram
//   alert-inbox:v1:<user>     [item]                  last 100 fired alerts
//   alert-state:v1:<user>     { fired: {key: date}, stages: {sym: n}, breadth }
//   push-subs:v1:<user>       [PushSubscription]      devices that installed Panel
//   alerts:v1:users           [user]                  who has anything to check
//
// Delivery: the in-app inbox always; Web Push to every device where you
// turned notifications on (needs VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY);
// Telegram if TELEGRAM_BOT_TOKEN is set and you've entered your chat id.

import webpush from "web-push";
import { kv } from "@/lib/kv";
import { validateRule, describeRule, DEFAULT_ALERT_SETTINGS, ALERT_TYPE_BY_ID, MARKET_ALERT_BY_ID } from "@/lib/alertTypes";
import { getHoldings } from "@/lib/holdingsStore";
import { fetchLiveQuotes } from "@/lib/liveQuotes";
import { symbolContext } from "@/lib/portfolio";
import { getSignalLogs } from "@/lib/signalLog";
import { computeBreadth } from "@/lib/breadth";

const K = {
  rules: (u) => `alerts:v1:${u}`,
  settings: (u) => `alert-settings:v1:${u}`,
  inbox: (u) => `alert-inbox:v1:${u}`,
  state: (u) => `alert-state:v1:${u}`,
  subs: (u) => `push-subs:v1:${u}`,
  users: "alerts:v1:users",
};
const MAX_RULES = 100;
const INBOX = 100;

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fmtR = (n) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

async function addUser(user) {
  const list = (await kv.get(K.users)) ?? [];
  if (!list.includes(user)) await kv.set(K.users, [...list, user]);
}

// ── rules & settings ─────────────────────────────────────────────────────
export async function listRules(user) {
  const v = await kv.get(K.rules(user));
  return Array.isArray(v) ? v : [];
}

export async function addRule(user, raw) {
  const rule = { id: newId("al"), ...validateRule(raw), active: true, createdAt: new Date().toISOString(), lastFired: null };
  const list = await listRules(user);
  if (list.length >= MAX_RULES) throw new Error(`Up to ${MAX_RULES} alerts — delete some first`);
  await kv.set(K.rules(user), [...list, rule]);
  await addUser(user);
  return rule;
}

export async function updateRule(user, id, patch) {
  const list = await listRules(user);
  const next = list.map((r) => (r.id === id ? { ...r, ...(patch.active !== undefined ? { active: !!patch.active } : {}) } : r));
  await kv.set(K.rules(user), next);
  return next;
}

export async function deleteRule(user, id) {
  const next = (await listRules(user)).filter((r) => r.id !== id);
  await kv.set(K.rules(user), next);
  return next;
}

export async function getAlertSettings(user) {
  const v = (await kv.get(K.settings(user)).catch(() => null)) ?? {};
  return { ...DEFAULT_ALERT_SETTINGS, ...v, auto: { ...DEFAULT_ALERT_SETTINGS.auto, ...(v.auto ?? {}) } };
}

export async function saveAlertSettings(user, raw) {
  const cur = await getAlertSettings(user);
  const next = { ...cur };
  if (raw.auto && typeof raw.auto === "object") for (const k of Object.keys(cur.auto)) if (k in raw.auto) next.auto[k] = !!raw.auto[k];
  if (raw.telegramChatId !== undefined) {
    const id = String(raw.telegramChatId ?? "").trim();
    if (id && !/^-?\d{4,20}$/.test(id)) throw new Error("A Telegram chat id is a number, e.g. 123456789");
    next.telegramChatId = id || null;
  }
  await kv.set(K.settings(user), next);
  await addUser(user);
  return next;
}

// ── inbox ───────────────────────────────────────────────────────────────
export async function getInbox(user) {
  const v = await kv.get(K.inbox(user)).catch(() => null);
  return Array.isArray(v) ? v : [];
}

export async function markRead(user, ids) {
  const inbox = await getInbox(user);
  const all = ids === "all";
  const next = inbox.map((x) => (all || ids.includes(x.id) ? { ...x, read: true } : x));
  await kv.set(K.inbox(user), next);
  return next;
}

// ── push subscriptions ───────────────────────────────────────────────────
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

export async function addSubscription(user, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error("Invalid push subscription");
  const list = ((await kv.get(K.subs(user))) ?? []).filter((s) => s.endpoint !== sub.endpoint);
  await kv.set(K.subs(user), [...list, { endpoint: sub.endpoint, keys: sub.keys, at: new Date().toISOString() }].slice(-10));
  await addUser(user);
}

export async function removeSubscription(user, endpoint) {
  const list = ((await kv.get(K.subs(user))) ?? []).filter((s) => s.endpoint !== endpoint);
  await kv.set(K.subs(user), list);
}

async function sendPush(user, payload) {
  if (!pushConfigured()) return 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const subs = (await kv.get(K.subs(user))) ?? [];
  let sent = 0;
  const dead = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600 });
        sent++;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint); // device unsubscribed
      }
    })
  );
  if (dead.length) await kv.set(K.subs(user), subs.filter((s) => !dead.includes(s.endpoint)));
  return sent;
}

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Puts alerts in the inbox and pushes them out. items: [{title, body, url, symbol, ruleId}] */
export async function deliver(user, items, { settings, origin } = {}) {
  if (!items.length) return { delivered: 0 };
  const at = new Date().toISOString();
  const full = items.map((x) => ({ id: newId("ai"), at, read: false, ...x }));
  const inbox = await getInbox(user);
  await kv.set(K.inbox(user), [...full.reverse(), ...inbox].slice(0, INBOX));
  const s = settings ?? (await getAlertSettings(user));
  // One notification per alert when there are a few; a summary when many.
  const batch =
    full.length <= 4
      ? full.map((x) => ({ title: x.title, body: x.body, url: x.url ?? "/", tag: x.ruleId ?? x.id }))
      : [{ title: `${full.length} Panel alerts`, body: full.map((x) => x.title).slice(0, 6).join(" · "), url: "/?alerts=1", tag: "panel-batch" }];
  let pushed = 0;
  for (const p of batch) pushed += await sendPush(user, p);
  let telegram = false;
  if (s.telegramChatId) {
    const text = full.map((x) => `🔔 ${x.title}\n${x.body}${origin && x.url ? `\n${origin}${x.url}` : ""}`).join("\n\n");
    telegram = await sendTelegram(s.telegramChatId, text);
  }
  return { delivered: full.length, pushed, telegram };
}

// ── the engine ───────────────────────────────────────────────────────────

function avgVol20(panel, symbol) {
  const i = panel?.idx.get(symbol);
  if (i == null) return null;
  const T = panel.dates.length;
  let s = 0, n = 0;
  for (let t = T - 20; t < T; t++) if (t >= 0 && Number.isFinite(panel.v[i][t])) { s += panel.v[i][t]; n++; }
  return n >= 10 ? s / n : null;
}

/**
 * Checks one user's alerts. mode "live": price-type rules against live
 * quotes. mode "eod": everything, against the last close, plus stage,
 * screener and breadth alerts. Returns what fired.
 */
export async function evaluateUser(user, { mode = "live", panel = null, breadthVerdict = null, origin = null, quotes: quoteCache = null } = {}) {
  const [rules, settings, holdings, state] = await Promise.all([
    listRules(user),
    getAlertSettings(user),
    getHoldings(user).catch(() => []),
    kv.get(K.state(user)).then((v) => v ?? { fired: {}, stages: {} }),
  ]);
  const today = todayIST();
  const active = rules.filter((r) => r.active);
  const stockRules = active.filter((r) => ALERT_TYPE_BY_ID[r.type] && (mode === "eod" || ALERT_TYPE_BY_ID[r.type].when === "live"));
  const held = (holdings ?? []).filter((h) => (settings.auto.stops && h.stopLoss) || (settings.auto.targets && h.target) || (mode === "eod" && settings.auto.stage4));

  const symbols = [...new Set([...stockRules.map((r) => r.symbol), ...held.map((h) => h.symbol)])];
  const quotes = mode === "live" && symbols.length ? quoteCache ?? (await fetchLiveQuotes(symbols)) : new Map();
  const ctxCache = new Map();
  const ctx = (s) => {
    if (!panel) return null;
    if (!ctxCache.has(s)) ctxCache.set(s, symbolContext(panel, s));
    return ctxCache.get(s);
  };
  // Price & previous close: live quote, else the last close from the panel.
  const px = (s) => {
    const q = quotes.get(s);
    if (q?.price != null) return { price: q.price, prev: q.prevClose, changePct: q.changePct, volume: q.volume };
    const c = ctx(s);
    if (!c) return null;
    const i = panel.idx.get(s), T = panel.dates.length;
    return { price: c.close, prev: panel.c[i][T - 2], changePct: c.changePct, volume: panel.v[i][T - 1] };
  };

  const out = [];
  const fired = { ...(state.fired ?? {}) };
  const once = (key) => {
    if (fired[key] === today) return false;
    fired[key] = today;
    return true;
  };
  const rulesNext = rules.map((r) => ({ ...r }));
  const fire = (r, title, body) => {
    const rr = rulesNext.find((x) => x.id === r.id);
    if (r.repeat === "once") rr.active = false;
    else if (rr.lastFired === today) return;
    rr.lastFired = today;
    out.push({ ruleId: r.id, symbol: r.symbol ?? null, title, body: r.note ? `${body} — ${r.note}` : body, url: r.symbol ? `/stock/${encodeURIComponent(r.symbol)}` : "/" });
  };

  for (const r of stockRules) {
    const p = px(r.symbol);
    if (!p) continue;
    const c = ctx(r.symbol);
    const at = fmtR(p.price);
    switch (r.type) {
      case "price_above":
        if (p.price >= r.value) fire(r, `${r.symbol} above ${fmtR(r.value)}`, `Now ${at}`);
        break;
      case "price_below":
        if (p.price <= r.value) fire(r, `${r.symbol} below ${fmtR(r.value)}`, `Now ${at}`);
        break;
      case "change_up":
        if (p.changePct != null && p.changePct >= r.value) fire(r, `${r.symbol} up ${p.changePct.toFixed(1)}% today`, `Now ${at}`);
        break;
      case "change_down":
        if (p.changePct != null && p.changePct <= -r.value) fire(r, `${r.symbol} down ${Math.abs(p.changePct).toFixed(1)}% today`, `Now ${at}`);
        break;
      case "volume_surge": {
        const avg = avgVol20(panel, r.symbol);
        if (avg && p.volume && p.volume >= r.value * avg) fire(r, `${r.symbol} volume ${(p.volume / avg).toFixed(1)}× average`, `Price ${at}`);
        break;
      }
      case "cross_above_sma50":
      case "cross_below_sma50":
      case "cross_above_ma30w":
      case "cross_below_ma30w": {
        const level = r.type.endsWith("sma50") ? c?.sma50 : c?.ma30w;
        if (!level || p.prev == null) break;
        const name = r.type.endsWith("sma50") ? "50-day average" : "30-week average";
        const up = r.type.startsWith("cross_above");
        if (up ? p.prev <= level && p.price > level : p.prev >= level && p.price < level) {
          fire(r, `${r.symbol} crossed ${up ? "above" : "below"} its ${name}`, `${at} vs ${fmtR(level)}`);
        }
        break;
      }
      case "stage_change": {
        const st = c?.stage;
        const was = state.stages?.[r.symbol];
        if (st != null && was != null && st !== was) fire(r, `${r.symbol} moved to Stage ${st}`, `From Stage ${was} on the weekly close`);
        break;
      }
    }
  }

  // Automatic holding alerts (fire once per day per holding).
  for (const h of held) {
    const p = px(h.symbol);
    if (!p) continue;
    if (settings.auto.stops && h.stopLoss && p.price <= h.stopLoss && once(`stop:${h.symbol}`)) {
      out.push({ symbol: h.symbol, title: `${h.symbol} hit your stop`, body: `${fmtR(p.price)} ≤ stop ${fmtR(h.stopLoss)} · ${h.quantity} shares`, url: "/?tab=holdings" });
    }
    if (settings.auto.targets && h.target && p.price >= h.target && once(`target:${h.symbol}`)) {
      out.push({ symbol: h.symbol, title: `${h.symbol} reached your target`, body: `${fmtR(p.price)} ≥ target ${fmtR(h.target)}`, url: "/?tab=holdings" });
    }
    if (mode === "eod" && settings.auto.stage4) {
      const st = ctx(h.symbol)?.stage;
      if (st === 4 && state.stages?.[h.symbol] != null && state.stages[h.symbol] !== 4 && once(`stage4:${h.symbol}`)) {
        out.push({ symbol: h.symbol, title: `${h.symbol} entered Stage 4`, body: "Closed below a falling 30-week average — Weinstein's sell signal", url: `/stock/${encodeURIComponent(h.symbol)}` });
      }
    }
  }

  // End-of-day market alerts.
  const nextState = { fired, stages: { ...(state.stages ?? {}) }, breadth: state.breadth ?? null };
  if (mode === "eod") {
    for (const r of active.filter((x) => x.type === "screen_new")) {
      const log = (await getSignalLogs([r.screenId]))[r.screenId] ?? {};
      const days = Object.keys(log).sort();
      const last = days[days.length - 1];
      if (!last || last <= (r.lastSeenDate ?? "")) continue;
      const prev = new Set(days.length > 1 ? log[days[days.length - 2]] : []);
      const fresh = (log[last] ?? []).filter((s) => !prev.has(s));
      const rr = rulesNext.find((x) => x.id === r.id);
      rr.lastSeenDate = last;
      if (fresh.length) fire(r, `${fresh.length} new in ${r.screenLabel ?? r.screenId}`, fresh.slice(0, 12).join(", ") + (fresh.length > 12 ? ` +${fresh.length - 12} more` : ""));
    }
    if (breadthVerdict) {
      for (const r of active.filter((x) => x.type === "breadth_change")) {
        if (nextState.breadth && nextState.breadth !== breadthVerdict.tone) {
          fire(r, `Market breadth turned ${breadthVerdict.tone === "risk-on" ? "Risk-on" : breadthVerdict.tone === "risk-off" ? "Risk-off" : "Mixed"}`, breadthVerdict.headline);
        }
      }
      nextState.breadth = breadthVerdict.tone;
    }
    // Remember stages for next time's stage-change checks.
    for (const s of new Set([...active.filter((r) => r.type === "stage_change").map((r) => r.symbol), ...(holdings ?? []).map((h) => h.symbol)])) {
      const st = ctx(s)?.stage;
      if (st != null) nextState.stages[s] = st;
    }
  }

  // Trim the fired-key memory to the last ~10 days.
  for (const [k, d] of Object.entries(nextState.fired)) if (d < new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10)) delete nextState.fired[k];
  await kv.set(K.state(user), nextState);
  if (JSON.stringify(rulesNext) !== JSON.stringify(rules)) await kv.set(K.rules(user), rulesNext);
  const result = await deliver(user, out, { settings, origin });
  return { fired: out.length, ...result, items: out };
}

/** Every user with alerts — used by the cron. */
export async function evaluateAll({ mode, panel, origin }) {
  const users = (await kv.get(K.users)) ?? [];
  let breadthVerdict = null;
  if (mode === "eod" && panel && panel.dates.length >= 60) breadthVerdict = computeBreadth(panel, { universe: "top500" }).verdict;
  const results = {};
  for (const u of users) {
    try {
      results[u] = await evaluateUser(u, { mode, panel, breadthVerdict, origin });
    } catch (err) {
      results[u] = { error: String(err?.message || err) };
    }
  }
  return results;
}

export { describeRule, MARKET_ALERT_BY_ID };
