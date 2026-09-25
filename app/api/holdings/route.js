import { cookies } from "next/headers";
import { IDENTITY_COOKIE } from "@/lib/identity";
import { getHoldings, saveHoldings, addHolding, removeHolding, updateHolding } from "@/lib/holdingsStore";

export const dynamic = "force-dynamic";

// Same "identity cookie isn't real auth" caveat as app/api/watchlist/route.js
// — good enough to keep two people's holdings apart on a shared link, not a
// security boundary.

async function currentIdentity() {
  const store = await cookies();
  return store.get(IDENTITY_COOKIE)?.value ?? null;
}

function unavailable(entries) {
  return Response.json(
    {
      storage: "unavailable",
      message:
        "Server-side holdings storage isn't configured for this deployment, so your holdings are being kept in this browser only.",
      entries: entries ?? [],
    },
    { status: 200 }
  );
}

export async function GET() {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  const entries = await getHoldings(identity);
  if (entries === null) return unavailable(null);
  return Response.json({ storage: "server", identity, entries });
}

export async function POST(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const body = await request.json();

    // Bulk replace — used for the browser-local -> server migration on
    // first sign-in, same as the watchlist route.
    if (Array.isArray(body?.entries)) {
      const saved = await saveHoldings(identity, body.entries);
      return Response.json({ storage: "server", entries: saved });
    }

    const { symbol, quantity, avgPrice, buyDate } = body || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });

    const result = await addHolding(identity, { symbol, quantity, avgPrice, buyDate });
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    const msg = String(err?.message || err);
    const isStorage = /kv|redis|url|token|credential/i.test(msg);
    return Response.json(
      {
        error: isStorage
          ? "Couldn't save — server-side storage isn't configured for this deployment."
          : msg,
      },
      { status: isStorage ? 503 : 400 }
    );
  }
}

export async function PATCH(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { symbol, ...patch } = (await request.json()) || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });
    const result = await updateHolding(identity, symbol, patch);
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });
    const result = await removeHolding(identity, symbol);
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
