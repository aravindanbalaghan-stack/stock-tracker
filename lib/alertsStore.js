import { kv } from "@vercel/kv";

const ALERTS_KEY = "panel:alerts";

// Alerts now carry an "owner" — the identity string from the
// panel_identity cookie (see lib/identity.js) — so that once this app is
// shared with more than one person, everyone's alerts don't land in one
// shared pool that anyone can see or delete. There's still only one
// underlying KV list; owner is just a field filtered on, not a separate
// per-person store.

export async function listAlerts(owner) {
  const alerts = await kv.get(ALERTS_KEY);
  const all = Array.isArray(alerts) ? alerts : [];
  return owner ? all.filter((a) => a.owner === owner) : all;
}

export async function saveAlerts(alerts) {
  await kv.set(ALERTS_KEY, alerts);
}

export async function addAlert(alert) {
  const alerts = await listAlerts();
  const newAlert = {
    id: crypto.randomUUID(),
    owner: alert.owner,
    symbol: alert.symbol.toUpperCase(),
    targetPrice: Number(alert.targetPrice),
    direction: alert.direction === "below" ? "below" : "above",
    phone: alert.phone,
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  alerts.push(newAlert);
  await saveAlerts(alerts);
  return newAlert;
}

// owner, when passed, restricts deletion to that person's own alert —
// removeAlert returns { removed: false, reason: "forbidden" } rather than
// silently deleting someone else's alert if the id doesn't belong to them.
export async function removeAlert(id, owner) {
  const alerts = await listAlerts();
  const target = alerts.find((a) => a.id === id);
  if (!target) {
    return { alerts, removed: false, reason: "not_found" };
  }
  if (owner && target.owner !== owner) {
    return { alerts, removed: false, reason: "forbidden" };
  }
  const next = alerts.filter((a) => a.id !== id);
  await saveAlerts(next);
  return { alerts: next, removed: true };
}

// No owner check here — this runs from the check-alerts cron, which acts
// on everyone's alerts regardless of who owns them.
export async function markTriggered(id) {
  const alerts = await listAlerts();
  const next = alerts.map((a) => (a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a));
  await saveAlerts(next);
  return next;
}
