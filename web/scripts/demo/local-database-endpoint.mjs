// KAIRO_DATABASE_HTTP_ENDPOINT routes the Neon HTTP driver, and with it the DATABASE_URL credentials sent on every
// query, to another host. It exists only for the local demo proxy (README, "Local web demo"), so it is honoured
// only as a loopback URL outside Vercel; anything else fails closed instead of sending queries elsewhere.
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function localDatabaseEndpoint(env = process.env) {
  const endpoint = env.KAIRO_DATABASE_HTTP_ENDPOINT;
  if (endpoint === undefined || endpoint === "") return undefined;
  if (env.VERCEL) throw new Error("KAIRO_DATABASE_HTTP_ENDPOINT is local-demo only and must not be set on Vercel");

  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("KAIRO_DATABASE_HTTP_ENDPOINT must be a loopback http(s) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    throw new Error("KAIRO_DATABASE_HTTP_ENDPOINT must be a loopback http(s) URL");
  }
  return endpoint;
}
