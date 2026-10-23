import { volumeDeliverySurge, enteringStage2WithAccumulation, fiftyTwoWeekHighs } from "@/lib/homeScans";
import { getPicks } from "@/lib/picks";

export const dynamic = "force-dynamic";
// The Stage 2 section runs the same wide weekly + daily scan as the
// Stage 2 screener; the surge section is bhavcopy-only and returns fast.
// They're requested separately so the quick one never waits on the slow one.
export const maxDuration = 60;

export async function GET(request) {
  const section = new URL(request.url).searchParams.get("section");
  try {
    let result;
    if (section === "surge") result = await volumeDeliverySurge();
    else if (section === "stage2") result = await enteringStage2WithAccumulation();
    else if (section === "picks") result = await getPicks();
    else if (section === "highs") result = await fiftyTwoWeekHighs();
    else return Response.json({ error: "Expected ?section=surge, stage2, picks or highs" }, { status: 400 });

    if (result.error) return Response.json(result, { status: 503 });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: "Failed to build this section", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
