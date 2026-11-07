import { getSessionUser } from "@/lib/auth";
import { getHoldings, saveHoldings, addHolding, removeHolding, updateHolding } from "@/lib/holdingsStore";

export const dynamic = "force-dynamic";

// The username comes ONLY from the signed session cookie (lib/auth.js), so
// it can't be spoofed — and the same account on any device reads and
// writes the same server-side list.
async function currentIdentity() {
  return getSessionUser();
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
    // Storage down: answer like GET does, so the Holdings tab applies the
    // add in this browser instead of failing outright.
    if (/kv|redis|upstash|url|token|credential|not configured/i.test(msg)) return unavailable(null);
    return Response.json({ error: msg }, { status: 400 });
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
