import { cookies } from "next/headers";
import { IDENTITY_COOKIE } from "@/lib/identity";
import { recordLogin } from "@/lib/loginLog";

const MAX_LENGTH = 100;

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const raw = typeof body?.identity === "string" ? body.identity.trim() : "";

  if (!raw) {
    return Response.json({ error: "Enter your email or name" }, { status: 400 });
  }

  const identity = raw.slice(0, MAX_LENGTH);
  const cookieStore = await cookies();
  cookieStore.set(IDENTITY_COOKIE, identity, {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  await recordLogin(identity);

  return Response.json({ ok: true, identity });
}
