import { kv } from "@vercel/kv";

const ALERTS_KEY = "panel:alerts";

// This is a single-user personal app (no login), so alerts are stored
// under one fixed key rather than scoped per-account.

export async function listAlerts() {
  const alerts = await kv.get(ALERTS_KEY);
  return Array.isArray(alerts) ? alerts : [];
}

export async function saveAlerts(alerts) {
  await kv.set(ALERTS_KEY, alerts);
}

export async function addAlert(alert) {
  const alerts = await listAlerts();
  const newAlert = {
    id: crypto.randomUUID(),
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

export async function removeAlert(id) {
  const alerts = await listAlerts();
  const next = alerts.filter((a) => a.id !== id);
  await saveAlerts(next);
  return next;
}

export async function markTriggered(id) {
  const alerts = await listAlerts();
  const next = alerts.map((a) => (a.id === id ? { ...a, triggered: true, triggeredAt: new Date().toISOString() } : a));
  await saveAlerts(next);
  return next;
}
