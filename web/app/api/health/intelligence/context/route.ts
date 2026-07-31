import { NextRequest, NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { loadAIContext } from "../../../../health/intelligence/data";
import { isISODate } from "../../../../health/intelligence/date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await getOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = request.nextUrl.searchParams.get("date") ?? undefined;
  const lookback = Number(request.nextUrl.searchParams.get("days") ?? "28");
  if (date && !isISODate(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 365) {
    return NextResponse.json({ error: "days must be between 1 and 365" }, { status: 400 });
  }
  return NextResponse.json(await loadAIContext(date, lookback));
}
