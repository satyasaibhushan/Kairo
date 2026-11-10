import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { testDatabase } from "./helpers/database.mjs";

const source = await readFile(new URL("../lib/context-materialization.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { materializeContextDates } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("Screen Time uses the reporting-zone start date while other context retains end dates", async () => {
  const db = await testDatabase();
  try {
    for (const [source, metric] of [["apple_screen_time", "attention.screen_time_minutes"], ["apple_music", "story.music_listening_minutes"]]) {
      await db.query(`INSERT INTO context_observations
        (owner_id, device_id, source_system, observation_id, operation, metric_key, observed_start, observed_end, numeric_value, unit)
        VALUES ('test', 'phone', $1, $1, 'upsert', $2, '2026-10-29T18:30:00Z', '2026-10-30T18:30:00Z', 120, 'min')`, [source, metric]);
    }
    const sql = async (parts, ...values) => (await db.query(parts.reduce((query, part, index) => query + (index ? `$${index}::text` : "") + part, ""), values)).rows;
    await materializeContextDates(sql, "test", "Asia/Kolkata", "2026-10-30", "2026-10-31");
    const { rows } = await db.query(`SELECT feature_date::text AS day, feature_key AS key, numeric_value AS value FROM context_daily_features ORDER BY feature_key`);
    assert.deepEqual(rows, [
      { day: "2026-10-30", key: "attention.screen_time_minutes", value: 120 },
      { day: "2026-10-31", key: "story.music_listening_minutes", value: 120 },
    ]);
    // A one-day rebuild must filter by the same date it writes.
    await materializeContextDates(sql, "test", "Asia/Kolkata", "2026-10-30", "2026-10-30");
    assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM context_daily_features WHERE feature_date = '2026-10-30'`)).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
