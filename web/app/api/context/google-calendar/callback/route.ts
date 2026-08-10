import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../lib/database";
import {
  encryptGoogleCalendarRefreshToken,
  exchangeGoogleCalendarCode,
  verifyGoogleCalendarState,
} from "../../../../../lib/google-calendar-oauth";
import { syncGoogleCalendar } from "../../../../../lib/google-calendar-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const stateCookie = "kairo_google_calendar_oauth_state";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const cookieState = readCookie(request.headers.get("cookie"), stateCookie);
  const verifiedState = cookieState === state
    ? await verifyGoogleCalendarState(state)
    : null;
  if (!verifiedState) return redirectToHealth("invalid_state");
  if (url.searchParams.has("error")) return redirectToHealth("denied");

  const code = url.searchParams.get("code");
  if (!code || !process.env.DATABASE_URL) return redirectToHealth("callback_error");

  try {
    const refreshToken = await exchangeGoogleCalendarCode(code);
    const encryptedRefreshToken = await encryptGoogleCalendarRefreshToken(refreshToken);
    const sql = getDatabase();
    await sql`INSERT INTO google_calendar_connections (
        owner_id, encrypted_refresh_token, sync_token, token_updated_at,
        last_synced_at, last_error
      ) VALUES (${verifiedState.ownerId}, ${encryptedRefreshToken}, NULL, now(), NULL, NULL)
      ON CONFLICT (owner_id) DO UPDATE SET
        encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
        sync_token = NULL,
        token_updated_at = now(),
        last_synced_at = NULL,
        last_error = NULL`;

    const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google Calendar OAuth is not configured");
    await syncGoogleCalendar(
      sql,
      verifiedState.ownerId,
      process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata",
      { clientId, clientSecret, refreshToken },
    );
    return redirectToHealth("connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar connection failed";
    if (process.env.DATABASE_URL) {
      const sql = getDatabase();
      await sql`INSERT INTO google_calendar_connections (owner_id, last_error)
        VALUES (${verifiedState.ownerId}, ${message})
        ON CONFLICT (owner_id) DO UPDATE SET last_error = EXCLUDED.last_error`;
    }
    return redirectToHealth("connection_error");
  }
}

function redirectToHealth(result: string) {
  const response = NextResponse.redirect(
    new URL(`/health?calendar=${encodeURIComponent(result)}`, publicBaseUrl()),
  );
  response.cookies.set(stateCookie, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/api/context/google-calendar/callback",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

function publicBaseUrl(): string {
  return process.env.KAIRO_PUBLIC_URL?.trim() || "http://localhost:3000";
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [cookieName, ...cookieValue] = part.trim().split("=");
    if (cookieName === name) {
      try {
        return decodeURIComponent(cookieValue.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
