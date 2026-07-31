import { NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { loadSignalCatalog } from "../../../../health/intelligence/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ schema: "kairo.health.signal-catalog.v1", signals: await loadSignalCatalog() });
}
