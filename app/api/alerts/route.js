import { cookies } from "next/headers";
import { listAlerts, addAlert, removeAlert } from "@/lib/alertsStore";
import { IDENTITY_COOKIE } from "@/lib/identity";

export const dynamic = "force-dynamic";

async function getOwner() {
  const cookieStore = await cookies();
  return cookieStore.get(IDENTITY_COOKIE)?.value || null;
}

export async function GET() {
  try {
    const owner = await getOwner();
    // Proxy already blocks unauthenticated requests to /api/*, so owner
    // should always be set here — this is just a defensive fallback.
    const alerts = await listAlerts(owner || undefined);
    return Response.json({ alerts });
  } catch (err) {
    return Response.json(
      { error: "Failed to load alerts — is Vercel KV set up? See README.", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const owner = await getOwner();
    if (!owner) {
      return Response.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = await request.json();
    const { symbol, targetPrice, direction, phone } = body;

    if (!symbol || !targetPrice || !phone) {
      return Response.json({ error: "symbol, targetPrice and phone are required" }, { status: 400 });
    }
    if (!/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s-]/g, ""))) {
      return Response.json({ error: "Phone number doesn't look valid — include country code, e.g. +91XXXXXXXXXX" }, { status: 400 });
    }

    const alert = await addAlert({ symbol, targetPrice, direction, phone, owner });
    return Response.json({ alert });
  } catch (err) {
    return Response.json(
      { error: "Failed to create alert", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const owner = await getOwner();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });

    const result = await removeAlert(id, owner || undefined);
    if (!result.removed) {
      const status = result.reason === "forbidden" ? 403 : 404;
      const message = result.reason === "forbidden" ? "That alert belongs to someone else" : "Alert not found";
      return Response.json({ error: message }, { status });
    }
    return Response.json({ alerts: result.alerts });
  } catch (err) {
    return Response.json(
      { error: "Failed to delete alert", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
