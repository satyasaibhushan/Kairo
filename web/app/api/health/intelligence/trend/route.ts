import { NextRequest, NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { loadFeatureTrend } from "../../../../health/intelligence/data";
import { isISODate } from "../../../../health/intelligence/date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await getOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const feature = request.nextUrl.searchParams.get("feature") ?? "";
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const through = request.nextUrl.searchParams.get("through") ?? "";
  if (!/^[a-z][a-z0-9_.]{2,119}$/.test(feature)) {
    return NextResponse.json({ error: "feature is invalid" }, { status: 400 });
  }
  if (!isISODate(from) || !isISODate(through) || from > through) {
    return NextResponse.json({ error: "from and through must be ordered YYYY-MM-DD dates" }, { status: 400 });
  }
  const days = (new Date(`${through}T00:00:00Z`).valueOf() - new Date(`${from}T00:00:00Z`).valueOf()) / 86_400_000;
  if (days > 3_660) {
    return NextResponse.json({ error: "trend range cannot exceed ten years" }, { status: 400 });
  }
  return NextResponse.json({ feature, from, through, points: await loadFeatureTrend(feature, from, through) });
}
