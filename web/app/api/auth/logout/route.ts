import { NextResponse } from "next/server";
import { destroyOwnerSession } from "../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  await destroyOwnerSession();
  return NextResponse.json({ authenticated: false });
}
