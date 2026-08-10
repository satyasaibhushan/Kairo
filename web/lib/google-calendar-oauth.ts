const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
const googleRevocationEndpoint = "https://oauth2.googleapis.com/revoke";
const calendarReadonlyScope = "https://www.googleapis.com/auth/calendar.readonly";
const stateLifetimeMilliseconds = 10 * 60 * 1_000;

type OAuthState = {
  expiresAt: number;
  nonce: string;
  ownerId: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
};

export type GoogleCalendarOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function getGoogleCalendarOAuthConfiguration(): GoogleCalendarOAuthConfiguration {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google Calendar OAuth is not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

export async function createGoogleCalendarAuthorization(
  ownerId: string,
): Promise<{ authorizationUrl: URL; state: string }> {
  const configuration = getGoogleCalendarOAuthConfiguration();
  const payload: OAuthState = {
    expiresAt: Date.now() + stateLifetimeMilliseconds,
    nonce: crypto.randomUUID(),
    ownerId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await signState(encodedPayload);
  const state = `${encodedPayload}.${signature}`;
  const authorizationUrl = new URL(googleAuthorizationEndpoint);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("client_id", configuration.clientId);
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("redirect_uri", configuration.redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", calendarReadonlyScope);
  authorizationUrl.searchParams.set("state", state);
  return { authorizationUrl, state };
}

export async function verifyGoogleCalendarState(state: string): Promise<OAuthState | null> {
  const separator = state.lastIndexOf(".");
  if (separator < 1) return null;
  const encodedPayload = state.slice(0, separator);
  const suppliedSignature = state.slice(separator + 1);
  const expectedSignature = await signState(encodedPayload);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<OAuthState>;
    if (
      typeof payload.expiresAt !== "number"
      || payload.expiresAt <= Date.now()
      || typeof payload.nonce !== "string"
      || payload.nonce.length < 16
      || typeof payload.ownerId !== "string"
      || !payload.ownerId
    ) {
      return null;
    }
    return payload as OAuthState;
  } catch {
    return null;
  }
}

export async function exchangeGoogleCalendarCode(code: string): Promise<string> {
  const configuration = getGoogleCalendarOAuthConfiguration();
  const response = await fetch(googleTokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: configuration.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Google OAuth returned ${response.status}`);
  const payload = (await response.json()) as GoogleTokenResponse;
  if (!payload.refresh_token) {
    throw new Error("Google OAuth did not return a refresh token");
  }
  return payload.refresh_token;
}

export async function encryptGoogleCalendarRefreshToken(refreshToken: string): Promise<string> {
  const key = await importEncryptionKey(["encrypt"]);
  const initializationVector = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: initializationVector },
    key,
    new TextEncoder().encode(refreshToken),
  );
  return [
    "v1",
    Buffer.from(initializationVector).toString("base64url"),
    Buffer.from(encrypted).toString("base64url"),
  ].join(".");
}

export async function decryptGoogleCalendarRefreshToken(encryptedToken: string): Promise<string> {
  const [version, encodedInitializationVector, encodedCiphertext] = encryptedToken.split(".");
  if (version !== "v1" || !encodedInitializationVector || !encodedCiphertext) {
    throw new Error("Stored Google Calendar token has an unsupported format");
  }
  const key = await importEncryptionKey(["decrypt"]);
  const initializationVector = Buffer.from(encodedInitializationVector, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: initializationVector },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

export async function revokeGoogleCalendarRefreshToken(refreshToken: string): Promise<boolean> {
  const response = await fetch(googleRevocationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

async function signState(payload: string): Promise<string> {
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
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return Buffer.from(signature).toString("base64url");
}

async function importEncryptionKey(
  usages: Array<"decrypt" | "encrypt">,
): Promise<CryptoKey> {
  const encodedKey = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encodedKey) throw new Error("Google Calendar token encryption is not configured");
  const keyBytes = Buffer.from(encodedKey, "base64");
  if (keyBytes.byteLength !== 32) {
    throw new Error("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, usages);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}
