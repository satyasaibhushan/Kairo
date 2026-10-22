import assert from "node:assert/strict";
import test from "node:test";

import { localDatabaseEndpoint } from "../scripts/demo/local-database-endpoint.mjs";

test("leaves the Neon endpoint alone when the demo override is unset", () => {
  assert.equal(localDatabaseEndpoint({}), undefined);
  assert.equal(localDatabaseEndpoint({ KAIRO_DATABASE_HTTP_ENDPOINT: "", VERCEL: "1" }), undefined);
});

test("honours only loopback demo proxies", () => {
  for (const endpoint of ["http://127.0.0.1:4444/sql", "http://localhost:4444/sql", "http://[::1]:4444/sql"]) {
    assert.equal(localDatabaseEndpoint({ KAIRO_DATABASE_HTTP_ENDPOINT: endpoint }), endpoint);
  }
});

test("refuses to send queries and credentials to any other host", () => {
  for (const endpoint of [
    "https://proxy.example.com/sql",
    "http://localhost.example.com/sql",
    "http://127.0.0.1.nip.io/sql",
    "http://localhost:4444@example.com/sql",
    "http://user:pass@127.0.0.1:4444/sql",
    "file:///tmp/sql",
    "127.0.0.1:4444",
  ]) {
    assert.throws(() => localDatabaseEndpoint({ KAIRO_DATABASE_HTTP_ENDPOINT: endpoint }), /loopback/, endpoint);
  }
});

test("refuses the demo override on Vercel even when it is loopback", () => {
  assert.throws(
    () => localDatabaseEndpoint({ KAIRO_DATABASE_HTTP_ENDPOINT: "http://127.0.0.1:4444/sql", VERCEL: "1" }),
    /must not be set on Vercel/,
  );
});
