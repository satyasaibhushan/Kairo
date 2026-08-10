import { NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { materializeContextDates } from "../../../../../lib/context-materialization";
import { getDatabase } from "../../../../../lib/database";
import {
  decryptGoogleCalendarRefreshToken,
  revokeGoogleCalendarRefreshToken,
} from "../../../../../lib/google-calendar-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type ConnectionRow = {
  connected: boolean;
  encryptedRefreshToken: string | null;
  lastError: string | null;
  lastSyncedAt: Date | string | null;
};

export async function GET() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }
  const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
  const sql = getDatabase();
  const result = await sql`SELECT encrypted_refresh_token IS NOT NULL AS connected,
      last_synced_at AS "lastSyncedAt", last_error AS "lastError"
    FROM google_calendar_connections WHERE owner_id = ${ownerId}`;
  const row = (result as unknown as ConnectionRow[])[0];
  return NextResponse.json({
    connected: row?.connected ?? false,
    lastError: row?.lastError ?? null,
    lastSyncedAt: row?.lastSyncedAt
      ? new Date(row.lastSyncedAt).toISOString()
      : null,
  });
}

export async function DELETE() {
  const owner = await getOwner();
  if (!owner) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  }

  const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
  const sql = getDatabase();
  const connectionResult = await sql`SELECT encrypted_refresh_token AS "encryptedRefreshToken"
    FROM google_calendar_connections WHERE owner_id = ${ownerId}`;
  const connection = (connectionResult as unknown as ConnectionRow[])[0];
  let revoked = false;
  if (connection?.encryptedRefreshToken) {
    try {
      const refreshToken = await decryptGoogleCalendarRefreshToken(connection.encryptedRefreshToken);
      revoked = await revokeGoogleCalendarRefreshToken(refreshToken);
    } catch {
      revoked = false;
    }
  }

  const rangeResult = await sql`SELECT MIN(observed_start) AS "minimumDate",
      MAX(COALESCE(observed_end, observed_start)) AS "maximumDate"
    FROM context_observations
    WHERE owner_id = ${ownerId} AND source_system = 'google_calendar'`;
  const range = (rangeResult as unknown as Array<{
    minimumDate: Date | string | null;
    maximumDate: Date | string | null;
  }>)[0];
  await sql`DELETE FROM context_observations
    WHERE owner_id = ${ownerId} AND source_system = 'google_calendar'`;
  await sql`DELETE FROM google_calendar_connections WHERE owner_id = ${ownerId}`;

  if (range?.minimumDate && range.maximumDate) {
    const timeZone = process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata";
    await materializeContextDates(
      sql,
      ownerId,
      timeZone,
      localDate(range.minimumDate, timeZone),
      localDate(range.maximumDate, timeZone),
    );
  }
  return NextResponse.json({ disconnected: true, revoked });
}

function localDate(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
