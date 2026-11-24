import { getSessionUser } from "@/lib/auth";
import { putShot, getShot } from "@/lib/screenshotStore";

export const dynamic = "force-dynamic";

// POST { data (base64), type, w, h } → { id, w, h }   upload one screenshot
// GET  ?id=…                         → the image      (yours only)
// Removing a screenshot happens when the trade is saved without it.

export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) ?? {};
  try {
    return Response.json(await putShot(user, body));
  } catch (err) {
    const msg = String(err?.message || err);
    const storage = /kv|redis|upstash|not configured/i.test(msg);
    return Response.json({ error: storage ? "Couldn't reach the database" : msg }, { status: storage ? 503 : 400 });
  }
}

export async function GET(request) {
  const user = await getSessionUser();
  if (!user) return new Response("Not signed in", { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  const shot = await getShot(user, id).catch(() => null);
  if (!shot?.data) return new Response("Not found", { status: 404 });
  // An id's bytes never change: the browser keeps it, so reopening a trade
  // doesn't ask the server again.
  return new Response(Buffer.from(shot.data, "base64"), {
    headers: { "Content-Type": shot.type || "image/webp", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
