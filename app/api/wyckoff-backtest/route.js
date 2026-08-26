import { getWyckoffBacktest } from "@/lib/wyckoffBacktest";

export const dynamic = "force-dynamic";
// The backtest fetches full daily history for up to SAMPLE_CAP symbols
// (see lib/wyckoffBacktest.js) on a cache miss, same order of cost as the
// live Wyckoff scan.
export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("refresh") === "1";
  try {
    const result = await getWyckoffBacktest({ force });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: "Couldn't compute the backtest", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}
