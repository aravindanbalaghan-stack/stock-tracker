import { getSessionUser } from "@/lib/auth";
import { getSales, updateSale, deleteSale } from "@/lib/salesLog";
import { loadPanel } from "@/lib/marketPanel";

// Holdings → Closed: every sale with why, plus each stock's latest close so
// you can see what it did after you sold.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const unavailable = (err) =>
  /KV store not configured/.test(String(err?.message))
    ? Response.json({ error: "Closed holdings need storage — add the Upstash database (README → Set up storage)." }, { status: 503 })
    : null;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const sales = await getSales(user);
    // Latest close per sold symbol, from the stored price history (no NSE
    // fetches here — it's only for the "since you sold" column).
    const latest = {};
    if (sales.length) {
      const panel = await loadPanel({ budgetMs: 2000, fill: false }).catch(() => null);
      if (panel?.dates?.length) {
        const T = panel.dates.length;
        for (const s of new Set(sales.map((x) => x.symbol))) {
          const i = panel.idx.get(s);
          if (i == null) continue;
          for (let t = T - 1; t >= Math.max(0, T - 10); t--) {
            if (Number.isFinite(panel.c[i][t])) {
              latest[s] = { close: panel.c[i][t], date: panel.dates[t] };
              break;
            }
          }
        }
      }
    }
    return Response.json({ sales: [...sales].reverse(), latest });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: "Couldn't load closed holdings" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { id, ...rest } = (await request.json()) ?? {};
    if (!id) return Response.json({ error: "Which sale?" }, { status: 400 });
    return Response.json({ sale: await updateSale(user, id, rest) });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Which sale?" }, { status: 400 });
  try {
    await deleteSale(user, id);
    return Response.json({ ok: true });
  } catch (err) {
    return unavailable(err) ?? Response.json({ error: "Couldn't delete" }, { status: 500 });
  }
}
