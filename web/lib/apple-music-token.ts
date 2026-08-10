import { createPrivateKey, sign } from "node:crypto";

const tokenLifetimeSeconds = 30 * 24 * 60 * 60;

export function createAppleMusicDeveloperToken(now = new Date()): string {
  const teamId = requiredEnvironmentValue("APPLE_MUSIC_TEAM_ID");
  const keyId = requiredEnvironmentValue("APPLE_MUSIC_KEY_ID");
  const encodedPrivateKey = requiredEnvironmentValue("APPLE_MUSIC_PRIVATE_KEY_BASE64");
  const privateKey = Buffer.from(encodedPrivateKey, "base64").toString("utf8");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("APPLE_MUSIC_PRIVATE_KEY_BASE64 must encode an Apple .p8 private key");
  }

  const issuedAt = Math.floor(now.getTime() / 1_000);
  const header = encodeJson({ alg: "ES256", kid: keyId });
  const payload = encodeJson({
    iss: teamId,
    iat: issuedAt,
    exp: issuedAt + tokenLifetimeSeconds,
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${signingInput}.${signature}`;
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}
