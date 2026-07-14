import { listAlerts, addAlert, removeAlert } from "@/lib/alertsStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const alerts = await listAlerts();
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
    const body = await request.json();
    const { symbol, targetPrice, direction, phone } = body;

    if (!symbol || !targetPrice || !phone) {
      return Response.json({ error: "symbol, targetPrice and phone are required" }, { status: 400 });
    }
    if (!/^\+?[0-9]{10,15}$/.test(phone.replace(/[\s-]/g, ""))) {
      return Response.json({ error: "Phone number doesn't look valid — include country code, e.g. +91XXXXXXXXXX" }, { status: 400 });
    }

    const alert = await addAlert({ symbol, targetPrice, direction, phone });
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
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return Response.json({ error: "Missing ?id=" }, { status: 400 });
    const alerts = await removeAlert(id);
    return Response.json({ alerts });
  } catch (err) {
    return Response.json(
      { error: "Failed to delete alert", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}
