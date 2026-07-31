import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses the standard Next.js runtime and Neon ledger", async () => {
  const [packageJson, data, ingestion, auth, layout, loginPage, healthPage] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/health/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/changes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/health/page.tsx", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(packageJson);
  const installedPackages = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };

  assert.match(packageJson, /"dev": "next dev"/);
  assert.match(packageJson, /@neondatabase\/serverless/);
  for (const packageName of Object.keys(installedPackages)) {
    assert.doesNotMatch(packageName, /vinext|wrangler|cloudflare/i);
  }
  assert.doesNotMatch(data, /cloudflare:workers|D1Database/);
  assert.match(ingestion, /jsonb_to_recordset/);
  assert.match(ingestion, /ON CONFLICT \(owner_id, device_id, sample_id\)/);
  assert.match(auth, /httpOnly: true/);
  assert.match(auth, /sameSite: "strict"/);
  assert.match(auth, /expected\.length < 8/);
  assert.match(loginPage, /minLength=\{8\}/);
  assert.doesNotMatch(layout, /next\/headers|generateMetadata/);
  assert.doesNotMatch(loginPage, /force-dynamic|use server|next\/headers/);
  assert.doesNotMatch(healthPage, /force-dynamic|loadHealthSummary|requireOwner/);
});

test("contains the complete Vercel deployment handoff", async () => {
  const [environment, schema, pairing, config] = await Promise.all([
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/pairing-code.mjs", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  for (const name of [
    "DATABASE_URL",
    "KAIRO_INGEST_TOKEN",
    "KAIRO_DASHBOARD_PASSWORD",
    "KAIRO_SESSION_SECRET",
  ]) {
    assert.match(environment, new RegExp(name));
  }
  assert.match(schema, /CREATE TABLE IF NOT EXISTS health_changes/);
  assert.match(pairing, /kairo\.bhushan\.fun\/api\/health\/changes/);
  assert.match(config, /"framework": "nextjs"/);
  await access(new URL("../app/login/page.tsx", import.meta.url));
  await access(new URL("../app/api/auth/login/route.ts", import.meta.url));
  await access(new URL("../app/api/auth/logout/route.ts", import.meta.url));
  await access(new URL("../app/api/auth/session/route.ts", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await access(root);
});
