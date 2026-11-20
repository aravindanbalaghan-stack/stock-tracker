import { getSessionUser } from "@/lib/auth";
import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

// Journal settings — the trading capital monthly returns and exposure are
// measured against. GET → { capital }   PUT { capital } → saves it.
const key = (user) => `journal-settings:v1:${user}`;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const saved = await kv.get(key(user)).catch(() => null);
  return Response.json({ capital: saved?.capital ?? null, updatedAt: saved?.updatedAt ?? null });
}

export async function PUT(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) ?? {};
  const capital = body.capital === null || body.capital === "" ? null : Number(body.capital);
  if (capital !== null && !(Number.isFinite(capital) && capital > 0 && capital < 1e12)) {
    return Response.json({ error: "Enter the amount as a positive number" }, { status: 400 });
  }
  const value = { capital, updatedAt: new Date().toISOString() };
  try {
    await kv.set(key(user), value);
    return Response.json(value);
  } catch {
    return Response.json({ error: "Couldn't reach the database" }, { status: 503 });
  }
}
