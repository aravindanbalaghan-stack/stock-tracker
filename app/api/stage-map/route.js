import { serveCached } from "@/lib/precompute";
import { loadPanel } from "@/lib/marketPanel";
import { panelMeta } from "@/lib/panelResponse";
import { getGroups } from "@/lib/rotation";
import { stockStages, groupStages } from "@/lib/stageMap";

// Stage for every stock, sector and theme in one response — what the
// Delivery tab's "Show stage" toggle reads. Precomputed nightly
// (lib/precomputeJobs.js), so turning stages on is instant.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function compute() {
  try {
    const panel = await loadPanel();
    const [sectorList, themeList] = await Promise.all([getGroups("sectors"), getGroups("themes").catch(() => [])]);
    const stocks = stockStages(panel);
    return Response.json({
      ...panelMeta(panel),
      stocks,
      sectors: groupStages(panel, sectorList, stocks),
      themes: groupStages(panel, themeList, stocks),
    });
  } catch (err) {
    console.error("stage-map:", err);
    return Response.json({ error: "Couldn't compute stages", detail: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET(request) {
  return serveCached(request, { name: "stage-map", vary: [], cacheable: () => true }, compute);
}
