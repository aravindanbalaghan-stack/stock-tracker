import { getSessionUser, changePassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST { currentPassword, newPassword } — change the signed-in user's password.
export async function POST(request) {
  const username = await getSessionUser();
  if (!username) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const res = await changePassword(username, body?.currentPassword, body?.newPassword);
    if (!res.ok) return Response.json({ error: res.error }, { status: res.status });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: "Couldn't reach the database", detail: String(err?.message || err) }, { status: 503 });
  }
}
