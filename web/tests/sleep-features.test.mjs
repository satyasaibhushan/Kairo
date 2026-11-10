import assert from "node:assert/strict";
import test from "node:test";
import { rebuildSleepFeatures } from "../scripts/rebuild-health-features.mjs";
import { testDatabase } from "./helpers/database.mjs";

test("sleep episodes keep pre-midnight stages on the wake day and union overlapping coverage", async () => {
  const db = await testDatabase();
  try {
    let id = 0;
    const sample = async (start, end, category = 3, source = "watch") => {
      id += 1;
      await db.query(`INSERT INTO health_changes
        (owner_id, device_id, sample_id, source_event_id, operation, type_identifier,
          start_date, end_date, category_value, source_bundle_identifier)
        VALUES ('test', 'phone', $1, $1, 'upsert', 'HKCategoryTypeIdentifierSleepAnalysis', $2, $3, $4, $5)`,
      [String(id), start + "+05:30", end + "+05:30", category, source]);
    };
    await sample("2026-10-29T23:00", "2026-10-29T23:30");
    await sample("2026-10-29T23:00", "2026-10-29T23:30"); // Exact duplicate, with a distinct sample ID.
    await sample("2026-10-29T23:30", "2026-10-30T03:00");
    await sample("2026-10-30T00:00", "2026-10-30T01:00"); // Nested duplicate must not split an episode.
    await sample("2026-10-30T02:30", "2026-10-30T06:00");
    await sample("2026-10-30T06:00", "2026-10-30T07:00", 5);
    await sample("2026-10-29T23:00", "2026-10-30T07:00", 1); // Unspecified overlaps specific stages.
    await sample("2026-10-29T23:00", "2026-10-30T07:00", 1, "other-source");
    // A short wake gap stays in the same episode; the daytime nap stays separate.
    await sample("2026-10-30T07:15", "2026-10-30T07:30", 5);
    await sample("2026-10-30T14:00", "2026-10-30T14:30", 1);
    await sample("2026-10-30T23:00", "2026-10-31T07:00");
    await sample("2026-10-31T23:00", "2026-10-31T23:30", 0);
    const sqlClient = { query: async (query, values) => (await db.query(query, values)).rows };
    const parameters = { ownerId: "test", timeZone: "Asia/Kolkata", minimumDate: "2026-10-29", maximumDate: "2026-10-31", featureVersion: "test" };
    await rebuildSleepFeatures(parameters, sqlClient);
    const features = async () => (await db.query(`SELECT feature_date::text AS day, feature_key AS key, numeric_value AS value FROM health_daily_features ORDER BY feature_date, feature_key`)).rows;
    const all = await features();
    const value = (day, key) => all.find(row => row.day === day && row.key === key)?.value;
    assert.equal(value("2026-10-29", "sleep.duration.asleep_hours"), undefined);
    assert.equal(value("2026-10-30", "sleep.duration.asleep_hours"), 8.75);
    assert.equal(value("2026-10-30", "sleep.stage.core_hours"), 7);
    assert.equal(value("2026-10-30", "sleep.stage.rem_hours"), 1.25);
    assert.equal(value("2026-10-31", "sleep.duration.asleep_hours"), 8);
    // One-day rebuilds must match the same wake date in a wider rebuild.
    await db.exec("DELETE FROM health_daily_features");
    await rebuildSleepFeatures({ ...parameters, minimumDate: "2026-10-30", maximumDate: "2026-10-30" }, sqlClient);
    assert.deepEqual(await features(), all.filter(row => row.day === "2026-10-30"));
  } finally {
    await db.close();
  }
});
