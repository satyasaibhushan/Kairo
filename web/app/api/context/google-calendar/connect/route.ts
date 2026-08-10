import { NextResponse } from "next/server";
import { getOwner } from "../../../../auth";
import { createGoogleCalendarAuthorization } from "../../../../../lib/google-calendar-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const stateCookie = "kairo_google_calendar_oauth_state";

export async function GET(request: Request) {
  const owner = await getOwner();
  if (!owner) return NextResponse.redirect(new URL("/login?returnTo=%2Fhealth", request.url));

  try {
    const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
    const { authorizationUrl, state } = await createGoogleCalendarAuthorization(ownerId);
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(stateCookie, state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: "/api/context/google-calendar/callback",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/health?calendar=configuration_error", publicBaseUrl()));
  }
}

function publicBaseUrl(): string {
  return process.env.KAIRO_PUBLIC_URL?.trim() || "http://localhost:3000";
}
