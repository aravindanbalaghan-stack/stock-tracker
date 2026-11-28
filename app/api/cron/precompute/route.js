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
//
// ?retry=1 (a second, later cron) re-runs only the views that failed or
// were built before NSE had published the session's files — so a late
// NSE file doesn't leave a tab on yesterday's data until the next night.

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
  // Saver mode (env PANEL_SAVER=1): no nightly precompute at all — each view
  // is built the first time it's opened after the close, then cached for the
  // day. Uses the least CPU; the first open of a view each day is slower.
  // Only the scheduled call is skipped — "Prepare now" (a signed-in user) and
  // a run's own continuations still go ahead.
  const scheduled = /vercel-cron/i.test(request.headers.get("user-agent") ?? "");
  if (process.env.PANEL_SAVER === "1" && scheduled) return Response.json({ skipped: "saver mode" });
  const url = new URL(request.url);
  const origin = url.origin;
  const retry = url.searchParams.get("retry") === "1";
  let retryTag = null;
  let jobs = precomputeJobs();
  const resume = Math.max(0, Number(url.searchParams.get("resume")) || 0);
  const started = Date.now();
  // Leave headroom under this function's own limit (Vercel may cap it
  // below maxDuration on some plans — 50s is safe everywhere).
  const budgetMs = Number(process.env.PRECOMPUTE_BUDGET_MS) || 50_000;

  let status = (await kv.get(STATUS_KEY).catch(() => null)) ?? {};
  if (retry) {
    const session = await expectedSession();
    const prev = status?.session === session ? status.results ?? {} : {};
    // One retry pass = one tag; a job already retried in this pass isn't
    // picked again by its continuation, even if NSE still hasn't published.
    retryTag = url.searchParams.get("tag") || new Date().toISOString();
    jobs = jobs.filter((j) => {
      const r = prev[j.id];
      if (r?.retryTag === retryTag) return false;
      return !r || !r.ok || (r.dataSession && r.dataSession < session);
    });
    if (status?.session !== session || !status.results) {
      status = { runId: new Date().toISOString(), startedAt: new Date().toISOString(), session, total: precomputeJobs().length, results: {} };
    } else {
      status.retriedAt = new Date().toISOString();
    }
    if (jobs.length === 0) return Response.json({ finished: true, retried: 0 });
  } else if (resume === 0) {
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
    let dataSession = null;
    try {
      const res = await fetch(`${origin}${job.path}`, { headers, cache: "no-store" });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
      dataSession = res.headers.get("x-panel-session") || null;
      await res.arrayBuffer().catch(() => null);
    } catch (err) {
      error = String(err?.message || err);
    }
    status.results[job.id] = { ok, ms: Date.now() - t0, at: new Date().toISOString(), ...(dataSession ? { dataSession } : {}), ...(retryTag ? { retryTag } : {}), ...(error ? { error } : {}) };
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
    // A retry run works on its own filtered list, so it simply runs again.
    const resumeUrl = retry ? `${origin}/api/cron/precompute?retry=1&tag=${encodeURIComponent(retryTag)}` : `${origin}/api/cron/precompute?resume=${next}`;
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
