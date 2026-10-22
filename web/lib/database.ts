import "server-only";

import { neon, neonConfig } from "@neondatabase/serverless";

let database: ReturnType<typeof neon> | null = null;

export function getDatabase(): ReturnType<typeof neon> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }

  // Local demo only: route the Neon HTTP driver at a local Neon-compatible proxy in front of plain Postgres
  // (README, "Local web demo"). Unset in every deployed environment, so Neon stays the default.
  const localEndpoint = process.env.KAIRO_DATABASE_HTTP_ENDPOINT;
  if (localEndpoint) neonConfig.fetchEndpoint = localEndpoint;

  database ??= neon(databaseUrl);
  return database;
}
