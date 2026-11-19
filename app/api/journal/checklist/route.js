import { getSessionUser } from "@/lib/auth";
import { kv } from "@/lib/kv";
import { defaultTemplate, normaliseTemplate } from "@/lib/tradeChecklist";

export const dynamic = "force-dynamic";

// Your trade checklist — the points every new trade is scored against.
// GET → { points, isDefault }   PUT { points } → saves and returns it.
const key = (user) => `journal-checklist:v1:${user}`;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const saved = await kv.get(key(user));
    return Response.json(Array.isArray(saved) ? { points: saved, isDefault: false } : { points: defaultTemplate(), isDefault: true });
  } catch {
    return Response.json({ points: defaultTemplate(), isDefault: true, offline: true });
  }
}

export async function PUT(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) ?? {};
  const points = normaliseTemplate(body.points);
  if (points.length === 0) return Response.json({ error: "Keep at least one point on the checklist" }, { status: 400 });
  try {
    await kv.set(key(user), points);
    return Response.json({ points, isDefault: false });
  } catch {
    return Response.json({ error: "Couldn't reach the database" }, { status: 503 });
  }
}
