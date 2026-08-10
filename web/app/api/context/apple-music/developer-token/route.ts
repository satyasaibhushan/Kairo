import { NextResponse } from "next/server";
import { createAppleMusicDeveloperToken } from "../../../../../lib/apple-music-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const expectedToken = process.env.KAIRO_INGEST_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: "Apple Music token service is not configured" }, { status: 503 });
  }
  if (!(await isAuthorized(request, expectedToken))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(
      { token: createAppleMusicDeveloperToken() },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple Music token generation failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

async function isAuthorized(request: Request, expectedToken: string): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedToken)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = suppliedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.min(suppliedBytes.length, expectedBytes.length); index += 1) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}
