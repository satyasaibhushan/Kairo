import { NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { getDatabase } from "../../../../../lib/database";
import { decryptGoogleCalendarRefreshToken } from "../../../../../lib/google-calendar-oauth";
import { syncGoogleCalendar } from "../../../../../lib/google-calendar-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runSync();
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}

async function runSync() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google Calendar credentials are not configured" }, { status: 503 });
  }

  const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
  const timeZone = process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata";
  const sql = getDatabase();
  try {
    const connectionResult = await sql`SELECT encrypted_refresh_token AS "encryptedRefreshToken"
      FROM google_calendar_connections WHERE owner_id = ${ownerId}`;
    const encryptedRefreshToken = (connectionResult as unknown as Array<{
      encryptedRefreshToken: string | null;
    }>)[0]?.encryptedRefreshToken;
    if (!encryptedRefreshToken) {
      return NextResponse.json({ connected: false, skipped: "not_connected" });
    }
    const refreshToken = await decryptGoogleCalendarRefreshToken(encryptedRefreshToken);
    const result = await syncGoogleCalendar(sql, ownerId, timeZone, {
      clientId,
      clientSecret,
      refreshToken,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar sync failed";
    await sql`INSERT INTO google_calendar_connections (owner_id, last_error)
      VALUES (${ownerId}, ${message})
      ON CONFLICT (owner_id) DO UPDATE SET last_error = EXCLUDED.last_error`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
