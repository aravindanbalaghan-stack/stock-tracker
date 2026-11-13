import { after } from "next/server";
import { kv } from "@/lib/kv";
import { getSessionUser } from "@/lib/auth";
import { precomputeJobs } from "@/lib/precomputeJobs";
import { STATUS_KEY, expectedSession } from "@/lib/precompute";

// Nightly precompute (Vercel Cron, see vercel.json) — and the "Run now"
// button in the header's data-status popover.
//
// Calls every latest-session view once with a header that forces a fresh
// compute, so each one lands in the cache (lib/precompute.js). Each call
// is its own function invocation with its own time limit. Jobs run a few
// at a time; if this invocation's own time runs low, it hands the rest to
// a fresh invocation of itself (?resume=N) and returns.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 4;

async function authorised(request) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  if (process.env.SESSION_SECRET && request.headers.get("x-panel-internal") === process.env.SESSION_SECRET) return true;
  return !!(await getSessionUser());
}

export async function GET(request) {
  if (!(await authorised(request))) return Response.json({ error: "Not allowed" }, { status: 401 });
  const url = new URL(request.url);
  const origin = url.origin;
  const jobs = precomputeJobs();
  const resume = Math.max(0, Number(url.searchParams.get("resume")) || 0);
  const started = Date.now();
  // Leave headroom under this function's own limit (Vercel may cap it
  // below maxDuration on some plans — 50s is safe everywhere).
  const budgetMs = Number(process.env.PRECOMPUTE_BUDGET_MS) || 50_000;

  let status = (await kv.get(STATUS_KEY).catch(() => null)) ?? {};
  if (resume === 0) {
    status = { runId: new Date().toISOString(), startedAt: new Date().toISOString(), session: await expectedSession(), total: jobs.length, results: {} };
    await kv.set(STATUS_KEY, status);
  }

  const headers = { "x-panel-refresh": "1" };
  if (process.env.SESSION_SECRET) headers["x-panel-internal"] = process.env.SESSION_SECRET;

  let next = resume;
  const runOne = async (job) => {
    const t0 = Date.now();
    let ok = false;
    let error = null;
    try {
      const res = await fetch(`${origin}${job.path}`, { headers, cache: "no-store" });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
      await res.arrayBuffer().catch(() => null);
    } catch (err) {
      error = String(err?.message || err);
    }
    status.results[job.id] = { ok, ms: Date.now() - t0, at: new Date().toISOString(), ...(error ? { error } : {}) };
    await kv.set(STATUS_KEY, status).catch(() => {});
  };

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length && Date.now() - started < budgetMs) {
      const job = jobs[next++];
      await runOne(job);
    }
  });
  await Promise.all(workers);

  if (next < jobs.length) {
    // Out of time — continue in a fresh invocation after responding.
    const resumeUrl = `${origin}/api/cron/precompute?resume=${next}`;
    after(async () => {
      await fetch(resumeUrl, { headers: process.env.SESSION_SECRET ? { "x-panel-internal": process.env.SESSION_SECRET } : {}, cache: "no-store" }).catch(() => {});
    });
    return Response.json({ continuing: true, done: next, total: jobs.length });
  }

  status.finishedAt = new Date().toISOString();
  await kv.set(STATUS_KEY, status).catch(() => {});
  const failed = Object.entries(status.results).filter(([, r]) => !r.ok).map(([id]) => id);
  return Response.json({ finished: true, total: jobs.length, failed });
}
