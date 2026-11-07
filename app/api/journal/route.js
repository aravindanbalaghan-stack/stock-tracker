import { getSessionUser } from "@/lib/auth";
import { getJournal, upsertTrade, deleteTrade, importTrades } from "@/lib/journalStore";

export const dynamic = "force-dynamic";

// GET → all of the signed-in user's trades
// POST { trade }                 → add or update one trade (matched by id)
// POST { import: [...], mode }   → bulk import ("merge" or "replace")
// DELETE ?id=…                   → remove one trade
async function guard(fn) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    return await fn(user);
  } catch (err) {
    const msg = String(err?.message || err);
    const storage = /kv|redis|upstash|not configured/i.test(msg);
    return Response.json({ error: storage ? "Couldn't reach the database" : msg }, { status: storage ? 503 : 400 });
  }
}

export async function GET() {
  return guard(async (user) => Response.json({ trades: await getJournal(user) }));
}

export async function POST(request) {
  return guard(async (user) => {
    const body = (await request.json().catch(() => null)) ?? {};
    if (Array.isArray(body.import)) {
      if (body.import.length > 5000) throw new Error("That file has more than 5,000 trades");
      return Response.json(await importTrades(user, body.import, body.mode === "replace" ? "replace" : "merge"));
    }
    return Response.json(await upsertTrade(user, body.trade));
  });
}

export async function DELETE(request) {
  return guard(async (user) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Which trade? (?id=)");
    return Response.json({ trades: await deleteTrade(user, id) });
  });
}
