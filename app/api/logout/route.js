import { clearSessionCookies } from "@/lib/auth";

export async function POST() {
  await clearSessionCookies();
  return Response.json({ ok: true });
}
