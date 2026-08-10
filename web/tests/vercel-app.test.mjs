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
    "KAIRO_PUBLIC_URL",
    "GOOGLE_CALENDAR_REDIRECT_URI",
    "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
    "APPLE_MUSIC_TEAM_ID",
    "APPLE_MUSIC_KEY_ID",
    "APPLE_MUSIC_PRIVATE_KEY_BASE64",
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
  await access(new URL("../app/api/context/apple-music/developer-token/route.ts", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await access(root);
});

test("publishes an OAuth-verifiable Kairo homepage and privacy policy", async () => {
  const [home, privacy, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /const title = "Kairo"/);
  assert.match(layout, /applicationName: "Kairo"/);
  assert.match(layout, /siteName: "Kairo"/);
  assert.match(home, /<h1>Kairo<\/h1>/);
  assert.match(home, /Kairo connects consented health, attention, schedule, and location signals/);
  assert.match(home, /GOOGLE DATA ACCESS \/ READ ONLY/);
  assert.match(home, /href="\/privacy"/);
  assert.match(privacy, /Google API Services User Data Policy/);
  assert.match(privacy, /Kairo does not sell Google user data/);
  assert.match(privacy, /AES-256-GCM/);
  assert.match(privacy, /Disconnect/);
  assert.doesNotMatch(privacy, /getOwner|requireOwner/);
  await access(new URL("../app/privacy/page.tsx", import.meta.url));
});

test("defines the rebuildable health intelligence layer", async () => {
  const [migration, migrateScript, dataMigrations, buildScript, featureBuilder, factorTrainer, packageJson] = await Promise.all([
    readFile(new URL("../db/002_health_intelligence.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/migrate.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-data-migrations.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/rebuild-health-features.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/train-health-factors.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const relation of [
    "health_current_observations",
    "health_signal_definitions",
    "health_feature_runs",
    "health_daily_features",
    "health_daily_profiles",
    "health_factor_scores",
    "health_insights",
  ]) {
    assert.match(migration, new RegExp(relation));
  }
  assert.match(migrateScript, /readdir\(migrationsDirectory\)/);
  assert.match(migrateScript, /kairo_schema_migrations/);
  assert.match(dataMigrations, /kairo_data_migrations/);
  assert.match(dataMigrations, /001_health_v1_features_and_factors/);
  assert.match(dataMigrations, /rebuild-health-features\.mjs/);
  assert.match(dataMigrations, /train-health-factors\.mjs/);
  assert.match(buildScript, /VERCEL_ENV === "production"/);
  assert.match(buildScript, /await import\("\.\/migrate\.mjs"\)/);
  assert.match(buildScript, /await import\("\.\/run-data-migrations\.mjs"\)/);
  assert.match(featureBuilder, /sourceSelection', 'greatest_specific_stage_coverage'/);
  assert.match(featureBuilder, /leakageBoundary', 'strictly_before_feature_date'/);
  assert.match(featureBuilder, /partitionDateRange\(minimumDate, maximumDate, chunkDays\)/);
  assert.match(featureBuilder, /KAIRO_BACKFILL_CHUNK_DAYS/);
  assert.match(factorTrainer, /expanding-window walk-forward/);
  assert.match(factorTrainer, /baselineMeanAbsoluteError/);
  assert.match(packageJson, /"features:rebuild"/);
  assert.match(packageJson, /"factors:train"/);
});

test("keeps assistant health access bounded and owner authenticated", async () => {
  const routes = await Promise.all([
    "day",
    "trend",
    "context",
    "catalog",
  ].map((route) => readFile(
    new URL(`../app/api/health/intelligence/${route}/route.ts`, import.meta.url),
    "utf8",
  )));
  for (const route of routes) {
    assert.match(route, /await getOwner\(\)/);
    assert.match(route, /export async function GET/);
    assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  }

  const data = await readFile(new URL("../app/health/intelligence/data.ts", import.meta.url), "utf8");
  assert.match(data, /Factor scores are predictive associations/);
  assert.match(data, /Missing data means unknown, not zero/);
  assert.match(data, /kairo\.jarvis\.health-view\.v1/);
  assert.match(data, /notablePersonalDeviations/);
  assert.match(data, /context_daily_profiles/);
  assert.match(data, /context_current_observations/);
  assert.match(data, /LIMIT 12/);
  assert.match(data, /LIMIT 10/);
});

test("materializes acknowledged health changes and keeps context sources separate", async () => {
  const [healthRoute, contextRoute, contextSchema, contextMaterializer, weather, calendar, oauth, calendarSync, calendarConnection, calendarCallback, dashboard, config] = await Promise.all([
    readFile(new URL("../app/api/health/changes/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/context/observations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/003_context_sources.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/context-materialization.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/weather-enrichment.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/google-calendar-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/google-calendar-oauth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/context/google-calendar/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/context/google-calendar/connection/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/context/google-calendar/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/health/HealthLiveDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);

  assert.match(healthRoute, /after\(async \(\) =>/);
  assert.match(healthRoute, /rebuildHealthFeatures/);
  assert.match(contextRoute, /enrichCurrentWeather/);
  assert.match(contextRoute, /materializeContextDates/);
  assert.match(contextSchema, /CREATE TABLE IF NOT EXISTS context_observations/);
  assert.match(contextSchema, /CREATE TABLE IF NOT EXISTS google_calendar_connections/);
  assert.match(contextMaterializer, /location\.commute_minutes/);
  assert.match(contextMaterializer, /routine_departure_deviation_minutes/);
  assert.match(weather, /api\.open-meteo\.com/);
  assert.match(calendar, /syncToken/);
  assert.match(calendar, /Google Calendar returned/);
  assert.match(oauth, /AES-GCM/);
  assert.match(oauth, /calendar\.readonly/);
  assert.match(oauth, /expiresAt: Date\.now\(\) \+ stateLifetimeMilliseconds/);
  assert.match(calendarSync, /decryptGoogleCalendarRefreshToken/);
  assert.doesNotMatch(calendarSync, /GOOGLE_CALENDAR_REFRESH_TOKEN/);
  assert.match(calendarConnection, /revokeGoogleCalendarRefreshToken/);
  assert.match(calendarConnection, /DELETE FROM context_observations/);
  assert.match(calendarCallback, /encryptGoogleCalendarRefreshToken/);
  assert.match(dashboard, /CONNECT GOOGLE CALENDAR/);
  assert.match(dashboard, /DISCONNECT/);
  assert.match(config, /api\/context\/google-calendar\/sync/);
});
