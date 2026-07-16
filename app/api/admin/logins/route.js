import { listLogins } from "@/lib/loginLog";

export const dynamic = "force-dynamic";

// Deliberately a SEPARATE secret from the casual friend-identity cookie —
// anyone can set that to anything, so it can't be the thing that decides
// who's allowed to see everyone else's login history. This key is meant
// to be known only to you (the deployer). See README "Checking who's
// logged in".
export async function GET(request) {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    return Response.json(
      { error: "ADMIN_KEY isn't set — see README \"Checking who's logged in\" to enable this." },
      { status: 501 }
    );
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (key !== adminKey) {
    return Response.json({ error: "Invalid or missing key" }, { status: 401 });
  }

  try {
    const logins = await listLogins();
    return Response.json({ logins });
  } catch (err) {
    return Response.json(
      { error: "Failed to load login log — is Vercel KV set up? See README.", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
