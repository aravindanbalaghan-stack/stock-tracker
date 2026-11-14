import { getSessionUser } from "@/lib/auth";
import { listScreens, saveScreen, deleteScreen } from "@/lib/customScreensStore";

export const dynamic = "force-dynamic";

const unavailable = () =>
  Response.json({ error: "Saving screens needs storage — add the Upstash database (README → Set up storage)." }, { status: 503 });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    return Response.json({ screens: await listScreens(user) });
  } catch {
    return Response.json({ screens: [], storage: "unavailable" });
  }
}

export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const { list, saved } = await saveScreen(user, body ?? {});
    return Response.json({ screens: list, saved });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/KV store not configured/.test(msg)) return unavailable();
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which screen?" }, { status: 400 });
  try {
    return Response.json({ screens: await deleteScreen(user, id) });
  } catch (err) {
    if (/KV store not configured/.test(String(err?.message))) return unavailable();
    return Response.json({ error: "Couldn't delete" }, { status: 500 });
  }
}
