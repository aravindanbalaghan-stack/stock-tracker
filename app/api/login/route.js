import { signIn, signUp, setSessionCookies, sessionSecret, MIN_PASSWORD } from "@/lib/auth";
import { kvConfigured, kvHealthy } from "@/lib/kv";
import { recordLogin } from "@/lib/loginLog";

export const dynamic = "force-dynamic";

// GET — what the login screen needs to know before showing the form:
// whether this deployment is set up for sign-in at all, and whether new
// accounts need an invite code.
export async function GET() {
  const storage = kvConfigured ? ((await kvHealthy()) ? "ok" : "unreachable") : "missing";
  return Response.json({
    storage,
    secret: sessionSecret() ? "ok" : "missing",
    inviteCodeRequired: !!process.env.SIGNUP_CODE,
    minPassword: MIN_PASSWORD,
  });
}

// POST { mode: "signin" | "signup", username, password, inviteCode? }
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const mode = body?.mode === "signup" ? "signup" : "signin";

  if (!sessionSecret()) {
    return Response.json(
      { error: "Sign-in isn't set up on this deployment: SESSION_SECRET is missing. See README → \"Set up storage and sign-in\"." },
      { status: 503 }
    );
  }
  if (!kvConfigured) {
    return Response.json(
      { error: "Sign-in isn't set up on this deployment: no Upstash Redis database is connected. See README → \"Set up storage and sign-in\"." },
      { status: 503 }
    );
  }

  try {
    const result =
      mode === "signup"
        ? await signUp(body?.username, body?.password, body?.inviteCode)
        : await signIn(body?.username, body?.password);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

    await setSessionCookies(result.username);
    await recordLogin(result.username);
    return Response.json({ ok: true, username: result.username, created: mode === "signup" });
  } catch (err) {
    return Response.json(
      { error: "Couldn't reach the database — check the Upstash connection.", detail: String(err?.message || err) },
      { status: 503 }
    );
  }
}
