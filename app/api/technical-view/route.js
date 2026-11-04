import { getTechnicalView } from "@/lib/technicalView";

// GET /api/technical-view?symbol=TCS — the stock run through the five
// front-row screens (see lib/technicalView.js).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9&\-]+$/.test(symbol)) {
    return Response.json({ error: "Expected ?symbol=" }, { status: 400 });
  }
  try {
    const result = await getTechnicalView(symbol);
    if (result.error) return Response.json(result, { status: 503 });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "Couldn't build the technical view", detail: String(err?.message || err) }, { status: 502 });
  }
}
