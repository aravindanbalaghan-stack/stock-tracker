import { getSessionUser } from "@/lib/auth";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistEntry,
  saveWatchlist,
} from "@/lib/watchlistStore";

export const dynamic = "force-dynamic";

// The username comes ONLY from the signed session cookie (lib/auth.js), so
// it can't be spoofed — and the same account on any device reads and
// writes the same server-side list.
async function currentIdentity() {
  return getSessionUser();
}

function unavailable(entries) {
  // KV unconfigured. Reported distinctly from "empty list" so the client
  // can keep using its local copy instead of wrongly wiping it.
  return Response.json(
    {
      storage: "unavailable",
      message:
        "Server-side watchlist storage isn't configured for this deployment, so your list is being kept in this browser only.",
      entries: entries ?? [],
    },
    { status: 200 }
  );
}

export async function GET() {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  const entries = await getWatchlist(identity);
  if (entries === null) return unavailable(null);
  return Response.json({ storage: "server", identity, entries });
}

export async function POST(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const body = await request.json();

    // Bulk replace — used once, to migrate an existing browser-local list
    // onto the server the first time someone signs in.
    if (Array.isArray(body?.entries)) {
      const saved = await saveWatchlist(identity, body.entries);
      return Response.json({ storage: "server", entries: saved });
    }

    const { symbol, source, sourceLabel } = body || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });

    const result = await addToWatchlist(identity, { symbol, source, sourceLabel });
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    const msg = String(err?.message || err);
    const isStorage = /kv|redis|url|token|credential/i.test(msg);
    return Response.json(
      {
        error: isStorage
          ? "Couldn't save — no Upstash Redis database is connected to this deployment. See README → \"Set up storage and sign-in\"."
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
    const { symbol, ...body } = (await request.json()) || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });
    // Only the fields the UI edits; anything else in the body is ignored.
    const patch = {};
    if (typeof body.notes === "string") patch.notes = body.notes;
    if ("topRank" in body) {
      const r = body.topRank;
      if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 5)) {
        return Response.json({ error: "topRank must be 1–5 or null" }, { status: 400 });
      }
      patch.topRank = r;
    }
    const result = await updateWatchlistEntry(identity, symbol, patch);
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
    const result = await removeFromWatchlist(identity, symbol);
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
