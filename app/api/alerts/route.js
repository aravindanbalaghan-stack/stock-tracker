import { getSessionUser } from "@/lib/auth";
import {
  listRules,
  addRule,
  updateRule,
  deleteRule,
  getAlertSettings,
  saveAlertSettings,
  getInbox,
  markRead,
  deliver,
  evaluateUser,
  pushConfigured,
} from "@/lib/alerts";
import { loadPanel } from "@/lib/marketPanel";
import { marketIsOpen } from "@/lib/marketHours";

// Your alerts: GET everything for the bell panel; POST { action, … } to
// change something; DELETE ?id= to remove a rule.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const storageError = (err) =>
  /KV store not configured/.test(String(err?.message)) ? Response.json({ error: "Alerts need storage — add the Upstash database (README → Set up storage)." }, { status: 503 }) : null;

export async function GET(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const onlyCount = new URL(request.url).searchParams.get("count") === "1";
    const inbox = await getInbox(user);
    const unread = inbox.filter((x) => !x.read).length;
    if (onlyCount) return Response.json({ unread });
    const [rules, settings] = await Promise.all([listRules(user), getAlertSettings(user)]);
    return Response.json({
      rules,
      settings,
      inbox,
      unread,
      push: { configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null },
      telegram: { configured: !!process.env.TELEGRAM_BOT_TOKEN },
    });
  } catch (err) {
    return storageError(err) ?? Response.json({ error: "Couldn't load alerts" }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const origin = new URL(request.url).origin;
    switch (body.action) {
      case "add":
        return Response.json({ rule: await addRule(user, body.rule ?? {}), rules: await listRules(user) });
      case "toggle":
        return Response.json({ rules: await updateRule(user, body.id, { active: body.active }) });
      case "settings":
        return Response.json({ settings: await saveAlertSettings(user, body.settings ?? {}) });
      case "read":
        return Response.json({ inbox: await markRead(user, body.ids === "all" ? "all" : Array.isArray(body.ids) ? body.ids : []) });
      case "test":
        return Response.json(
          await deliver(user, [{ title: "Panel test alert", body: "If you can read this, alerts reach you here.", url: "/" }], { origin })
        );
      case "check": {
        // Checked while Panel is open, so price alerts work even without
        // an external scheduler. Live prices only during market hours.
        const open = await Promise.resolve(marketIsOpen()).catch(() => false);
        if (!open) return Response.json({ fired: 0, skipped: "market closed" });
        const panel = await loadPanel({ budgetMs: 3000, fill: false }).catch(() => null);
        const r = await evaluateUser(user, { mode: "live", panel, origin });
        return Response.json({ fired: r.fired, items: r.items });
      }
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return storageError(err) ?? Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which alert?" }, { status: 400 });
  try {
    return Response.json({ rules: await deleteRule(user, id) });
  } catch (err) {
    return storageError(err) ?? Response.json({ error: "Couldn't delete" }, { status: 500 });
  }
}
