import { NextResponse } from "next/server";
import { getOwner } from "../../../auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const owner = await getOwner();
  return NextResponse.json(
    owner ? { authenticated: true, owner } : { authenticated: false },
    { headers: { "cache-control": "private, no-store" } },
  );
}
