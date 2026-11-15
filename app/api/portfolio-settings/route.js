import { getSessionUser } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/portfolioSettings";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return Response.json({ settings: await getSettings(user) });
}

export async function POST(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    return Response.json({ settings: await saveSettings(user, (await request.json()) ?? {}) });
  } catch (err) {
    const msg = String(err?.message || err);
    return Response.json({ error: /KV store not configured/.test(msg) ? "Saving settings needs storage (README → Set up storage)." : msg }, { status: 400 });
  }
}
