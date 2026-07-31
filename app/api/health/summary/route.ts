import { NextResponse } from "next/server";
import { getOwner } from "../../../auth";
import { loadHealthSummary } from "../../../health/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!(await getOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadHealthSummary());
}
