import { serveCached } from "@/lib/precompute";
import { loadPanel } from "@/lib/marketPanel";
import { computeBreadth } from "@/lib/breadth";
import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { panelMeta } from "@/lib/panelResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UNIVERSES = ["top500", "liquid"];

async function compute(request) {
  const sp = new URL(request.url).searchParams;
  const universe = UNIVERSES.includes(sp.get("universe")) ? sp.get("universe") : "top500";
  try {
    const [panel, sectors] = await Promise.all([loadPanel(), getResolvedSectorList().catch(() => [])]);
    if (panel.dates.length < 30) {
      return Response.json({ ...panelMeta(panel), universe, daily: [], stageWeeks: [], sectors: [], newHighList: [], newLowList: [], verdict: null });
    }
    return Response.json({ ...panelMeta(panel), ...computeBreadth(panel, { universe, sectors }) });
  } catch (err) {
    console.error("breadth:", err);
    return Response.json({ error: "Couldn't compute market breadth", detail: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET(request) {
  return serveCached(request, { name: "breadth", vary: ["universe"], cacheable: () => true }, compute);
}
