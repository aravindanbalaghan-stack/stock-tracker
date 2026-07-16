import { cookies } from "next/headers";
import { IDENTITY_COOKIE } from "@/lib/identity";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.delete(IDENTITY_COOKIE);
  return Response.json({ ok: true });
}
