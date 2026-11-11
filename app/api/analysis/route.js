import { getSessionUser } from "@/lib/auth";
import {
  getEntries,
  upsertEntry,
  deleteEntry,
  addIdea,
  importEntries,
  gradeEntries,
  marketSnapshot,
  getPrefs,
  savePrefs,
  studyTechnicals,
} from "@/lib/analysis";
import { getTechnicalView } from "@/lib/technicalView";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET                 → all entries, graded (bias vs next session, idea outcomes), + prefs
// GET ?snapshot=DATE  → market snapshot for that day (indices, breadth, sector/theme movers)
// GET ?symbol=TCS     → every idea you've written on that stock, graded (stock page)
// POST { entry }      → save a day
// POST { idea, date } → add one idea to a day (stock page "Add to analysis")
// POST { import, mode } / { prefs }
// DELETE ?date=       → remove a day
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

export async function GET(request) {
  return guard(async (user) => {
    const { searchParams } = new URL(request.url);
    // Auto-fill for a stock study: Panel's readings (+ which screens it's
    // on, for the latest session only).
    const tech = searchParams.get("technicals")?.trim().toUpperCase();
    if (tech) {
      const date = searchParams.get("date");
      const asOf = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const [t, view] = await Promise.all([
        studyTechnicals(tech, asOf && asOf < today ? asOf : null),
        !asOf || asOf >= today
          ? Promise.race([getTechnicalView(tech).catch(() => null), new Promise((r) => setTimeout(() => r(null), 20000))])
          : null,
      ]);
      const screens = view?.cards?.filter((c) => c.status === "match" || c.status === "watch").map((c) => `${c.label}: ${c.headline}`) ?? null;
      return Response.json({ ...t, screens });
    }
    const snap = searchParams.get("snapshot");
    if (snap && /^\d{4}-\d{2}-\d{2}$/.test(snap)) return Response.json(await marketSnapshot(snap));

    const entries = await getEntries(user);
    // Home tab card: the latest day only, ungraded (fast).
    if (searchParams.get("summary") === "1") {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      return Response.json({ today, latest: entries[0] ?? null, days: entries.length });
    }
    const symbol = searchParams.get("symbol")?.trim().toUpperCase();
    if (symbol) {
      const mine = entries.filter((e) => e.ideas.some((i) => i.symbol === symbol) || (e.studies ?? []).some((st) => st.symbol === symbol));
      const graded = await gradeEntries(mine);
      return Response.json({
        symbol,
        ideas: graded.flatMap((e) => e.ideas.filter((i) => i.symbol === symbol).map((i) => ({ ...i, date: e.date }))),
        studies: graded.flatMap((e) => (e.studies ?? []).filter((st) => st.symbol === symbol).map((st) => ({ ...st, date: e.date }))),
      });
    }
    const [graded, prefs] = await Promise.all([gradeEntries(entries), getPrefs(user)]);
    return Response.json({ entries: graded, prefs });
  });
}

export async function POST(request) {
  return guard(async (user) => {
    const body = (await request.json().catch(() => null)) ?? {};
    if (body.prefs) return Response.json({ prefs: await savePrefs(user, body.prefs) });
    if (Array.isArray(body.import)) {
      const n = await importEntries(user, body.import, body.mode === "replace" ? "replace" : "merge");
      return Response.json({ imported: n });
    }
    if (body.idea) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") ? body.date : new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      return Response.json({ entry: await addIdea(user, date, body.idea) });
    }
    return Response.json({ entry: await upsertEntry(user, body.entry) });
  });
}

export async function DELETE(request) {
  return guard(async (user) => {
    const date = new URL(request.url).searchParams.get("date");
    if (!date) throw new Error("Which day? (?date=)");
    await deleteEntry(user, date);
    return Response.json({ ok: true });
  });
}
