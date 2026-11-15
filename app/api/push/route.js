import { getSessionUser } from "@/lib/auth";
import { addSubscription, removeSubscription, pushConfigured } from "@/lib/alerts";

// Register / unregister this device for push notifications.

export const dynamic = "force-dynamic";

export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!pushConfigured()) return Response.json({ error: "Push isn't set up on the server — add VAPID keys (README → Alerts)." }, { status: 503 });
  try {
    const { subscription } = (await request.json()) ?? {};
    await addSubscription(user, subscription);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { endpoint } = (await request.json()) ?? {};
    if (endpoint) await removeSubscription(user, endpoint);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
