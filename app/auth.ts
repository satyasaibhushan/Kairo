import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const sessionCookie = "kairo_owner_session";
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

export type KairoOwner = {
  displayName: string;
};

export async function authenticateOwner(password: string): Promise<boolean> {
  const expected = process.env.KAIRO_DASHBOARD_PASSWORD;
  if (!expected || expected.length < 12) {
    throw new Error("KAIRO_DASHBOARD_PASSWORD must contain at least 12 characters");
  }
  return constantTimeEqual(password, expected);
}

export async function createOwnerSession(): Promise<void> {
  const expiresAt = Date.now() + sessionLifetimeSeconds * 1_000;
  const payload = String(expiresAt);
  const signature = await sign(payload);
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie, `${payload}.${signature}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: sessionLifetimeSeconds,
    path: "/",
  });
}

export async function destroyOwnerSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookie);
}

export async function getOwner(): Promise<KairoOwner | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookie)?.value;
  if (!token) return null;

  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const expectedSignature = await sign(payload);
  if (!(await constantTimeEqual(suppliedSignature, expectedSignature))) return null;

  return { displayName: process.env.KAIRO_OWNER_NAME?.trim() || "Bhushan" };
}

export async function requireOwner(returnTo: string): Promise<KairoOwner> {
  const owner = await getOwner();
  if (owner) return owner;
  redirect(`/login?returnTo=${encodeURIComponent(safeReturnPath(returnTo))}`);
}

export function safeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/health";
  try {
    const url = new URL(value, "https://kairo.local");
    if (url.origin !== "https://kairo.local" || url.pathname === "/login") return "/health";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/health";
  }
}

async function sign(payload: string): Promise<string> {
  const secret = process.env.KAIRO_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("KAIRO_SESSION_SECRET must contain at least 32 characters");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64url");
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < Math.min(leftBytes.length, rightBytes.length); index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}
