import { cookies } from "next/headers";
import { IDENTITY_COOKIE } from "@/lib/identity";
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  updateWatchlistEntry,
  saveWatchlist,
} from "@/lib/watchlistStore";

export const dynamic = "force-dynamic";

// NOTE ON WHAT THIS IS: the identity cookie is a self-declared name, not
// authenticated — see lib/identity.js. It's enough to keep two people's
// watchlists apart on a shared link, which is what it's for, but it is NOT
// a security boundary: anyone could type someone else's identity on the
// login screen and see their list. Don't put anything sensitive here.

async function currentIdentity() {
  const store = await cookies();
  return store.get(IDENTITY_COOKIE)?.value ?? null;
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
