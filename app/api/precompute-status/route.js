import { kv } from "@/lib/kv";
import { STATUS_KEY, expectedSession } from "@/lib/precompute";
import { precomputeJobs } from "@/lib/precomputeJobs";

// Header badge: is the data for the latest session ready?
export const dynamic = "force-dynamic";

export async function GET() {
  const [status, session] = await Promise.all([kv.get(STATUS_KEY).catch(() => null), expectedSession()]);
  const jobs = precomputeJobs();
  const results = status?.results ?? {};
  const done = jobs.filter((j) => results[j.id]).length;
  const failed = jobs.filter((j) => results[j.id] && !results[j.id].ok).map((j) => j.id);
  return Response.json({
    session,
    runSession: status?.session ?? null,
    startedAt: status?.startedAt ?? null,
    finishedAt: status?.finishedAt ?? null,
    total: jobs.length,
    done,
    failed,
    // Built before NSE had published this session's files — still showing
    // the previous session until the late retry run (or the next visit).
    behind: jobs.filter((j) => results[j.id]?.ok && results[j.id].dataSession && results[j.id].dataSession < (status?.session ?? session)).map((j) => j.id),
    running: !!status?.startedAt && !status?.finishedAt && Date.now() - new Date(status.startedAt).getTime() < 30 * 60 * 1000,
    cronConfigured: !!process.env.CRON_SECRET,
  });
}
