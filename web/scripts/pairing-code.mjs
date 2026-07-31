const endpoint = process.env.KAIRO_ENDPOINT ?? "https://kairo.bhushan.fun/api/health/changes";
const ingestToken = process.env.KAIRO_INGEST_TOKEN;

if (!ingestToken) {
  throw new Error("Set KAIRO_INGEST_TOKEN before running npm run pairing-code");
}

const configuration = {
  endpoint,
  ingestToken,
  siteAccessToken: "vercel",
};

console.log(Buffer.from(JSON.stringify(configuration)).toString("base64url"));
