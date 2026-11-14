import { serveCached } from "@/lib/precompute";
import { loadPanel } from "@/lib/marketPanel";
import { computeRotation } from "@/lib/rotation";
import { panelMeta } from "@/lib/panelResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function compute(request) {
  const sp = new URL(request.url).searchParams;
  const kind = sp.get("group") === "themes" ? "themes" : "sectors";
  try {
    const panel = await loadPanel();
    if (panel.dates.length < 120) {
      return Response.json({ ...panelMeta(panel), kind, groups: [], weeks: [] });
    }
    return Response.json({ ...panelMeta(panel), ...(await computeRotation(panel, { kind })) });
  } catch (err) {
    console.error("rotation:", err);
    return Response.json({ error: "Couldn't compute rotation", detail: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET(request) {
  return serveCached(request, { name: "rotation", vary: ["group"], cacheable: () => true }, compute);
}
