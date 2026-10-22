// Preload for the repo's plain Node scripts (migrate, rebuild, train) during the local demo:
//   node --import ./scripts/demo/neon-local.mjs scripts/migrate.mjs
// Points the Neon HTTP driver at KAIRO_DATABASE_HTTP_ENDPOINT, the local Neon-compatible proxy
// in front of plain Postgres, exactly as lib/database.ts does for the app.
import { neonConfig } from "@neondatabase/serverless";

import { localDatabaseEndpoint } from "./local-database-endpoint.mjs";

const endpoint = localDatabaseEndpoint();
if (!endpoint) throw new Error("Set KAIRO_DATABASE_HTTP_ENDPOINT before preloading scripts/demo/neon-local.mjs");
neonConfig.fetchEndpoint = endpoint;
