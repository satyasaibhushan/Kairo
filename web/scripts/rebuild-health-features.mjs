import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL before rebuilding health features");

const argumentsByName = parseArguments(process.argv.slice(2));
const ownerId = argumentsByName.owner ?? process.env.KAIRO_OWNER_ID ?? "primary";
const timeZone = argumentsByName.timezone ?? process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata";
const featureVersion = "health-v1";
const chunkDays = validatePositiveInteger(
  argumentsByName["chunk-days"] ?? process.env.KAIRO_BACKFILL_CHUNK_DAYS ?? "180",
  "chunk-days",
);
const sql = neon(databaseUrl);

const bounds = await sql.query(
  `SELECT
      COALESCE((MIN(start_date) AT TIME ZONE $2)::date, CURRENT_DATE)::text AS "minimumDate",
      COALESCE((MAX(COALESCE(end_date, start_date)) AT TIME ZONE $2)::date, CURRENT_DATE)::text AS "maximumDate"
    FROM health_current_observations
    WHERE owner_id = $1 AND operation = 'upsert'`,
  [ownerId, timeZone],
);
const minimumDate = validateDate(argumentsByName.from ?? bounds[0]?.minimumDate, "from");
const maximumDate = validateDate(argumentsByName.through ?? bounds[0]?.maximumDate, "through");
if (minimumDate > maximumDate) throw new Error("--from must not be after --through");

const runId = randomUUID();
await sql.query(
  `INSERT INTO health_owner_settings (owner_id, home_time_zone, feature_version, updated_at)
   VALUES ($1, $2, $3, now())
   ON CONFLICT (owner_id) DO UPDATE SET
     home_time_zone = EXCLUDED.home_time_zone,
     feature_version = EXCLUDED.feature_version,
     updated_at = now()`,
  [ownerId, timeZone, featureVersion],
);
await sql.query(
  `INSERT INTO health_feature_runs (
     run_id, owner_id, feature_version, requested_from, requested_through,
     time_zone, status
   ) VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
  [runId, ownerId, featureVersion, minimumDate, maximumDate, timeZone],
);

try {
  await seedObservedSignalDefinitions({ ownerId });
  await sql.query(
    `DELETE FROM health_daily_profiles
     WHERE owner_id = $1 AND profile_version = $2
       AND profile_date BETWEEN $3::date AND $4::date`,
    [ownerId, featureVersion, minimumDate, maximumDate],
  );
  await sql.query(
    `DELETE FROM health_daily_features
     WHERE owner_id = $1 AND feature_version = $2
       AND feature_date BETWEEN $3::date AND $4::date`,
    [ownerId, featureVersion, minimumDate, maximumDate],
  );

  const chunks = partitionDateRange(minimumDate, maximumDate, chunkDays);
  console.log(
    `Rebuilding ${featureVersion} in ${chunks.length.toLocaleString("en-IN")} date chunks of at most ${chunkDays} days.`,
  );
  for (const [index, chunk] of chunks.entries()) {
    console.log(
      `Starting feature chunk ${index + 1}/${chunks.length}: ${chunk.from} through ${chunk.through}.`,
    );
    const parameters = {
      ownerId,
      timeZone,
      minimumDate: chunk.from,
      maximumDate: chunk.through,
      featureVersion,
    };
    await rebuildNumericFeatures(parameters);
    await rebuildSleepFeatures(parameters);
    await rebuildStandFeatures(parameters);
    await rebuildWorkoutFeatures(parameters);
    await rebuildCategoryFeatures(parameters);
    await rebuildRollingFeatures(parameters);
    await rebuildProfiles(parameters);
    console.log(
      `Completed feature chunk ${index + 1}/${chunks.length}: ${chunk.from} through ${chunk.through}.`,
    );
  }

  const countRows = await sql.query(
    `SELECT COUNT(*)::int AS value
     FROM health_daily_features
     WHERE owner_id = $1 AND feature_version = $2
       AND feature_date BETWEEN $3::date AND $4::date`,
    [ownerId, featureVersion, minimumDate, maximumDate],
  );
  const featureCount = Number(countRows[0]?.value ?? 0);
  await sql.query(
    `UPDATE health_feature_runs
     SET status = 'completed', feature_count = $2, completed_at = now()
     WHERE run_id = $1`,
    [runId, featureCount],
  );
  console.log(
    `Built ${featureCount.toLocaleString("en-IN")} ${featureVersion} features for ${minimumDate} through ${maximumDate}.`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await sql.query(
    `UPDATE health_feature_runs
     SET status = 'failed', error_message = $2, completed_at = now()
     WHERE run_id = $1`,
    [runId, message.slice(0, 2_000)],
  );
  throw error;
}

async function seedObservedSignalDefinitions({ ownerId }) {
  await sql.query(
    `WITH observed AS (
       SELECT
         type_identifier,
         BOOL_OR(numeric_value IS NOT NULL) AS has_numeric,
         BOOL_OR(category_value IS NOT NULL) AS has_category,
         BOOL_OR(metadata_json->>'aggregation' LIKE 'daily.%') AS has_daily_summary,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT REPLACE(metadata_json->>'aggregation', 'daily.', '')),
           NULL) AS observed_statistics
       FROM health_current_observations
       WHERE owner_id = $1 AND operation = 'upsert'
       GROUP BY type_identifier
     )
     INSERT INTO health_signal_definitions (
       source_system, source_type_identifier, signal_key, domain, display_name,
       value_kind, storage_grain, day_assignment, default_statistics,
       is_mood_target, ai_description
     )
     SELECT
       'apple_health',
       type_identifier,
       'healthkit.' || lower(regexp_replace(type_identifier, '^HK|TypeIdentifier', '', 'g')),
       CASE
         WHEN type_identifier LIKE '%Dietary%' OR type_identifier LIKE '%AlcoholicBeverage%' THEN 'nutrition'
         WHEN type_identifier ~ '(Sleep|Respiratory|Inhaler|Expiratory|VitalCapacity|Oxygen)' THEN 'respiratory'
         WHEN type_identifier ~ '(Heart|Atrial|BloodPressure|VO2)' THEN 'heart'
         WHEN type_identifier ~ '(Step|Walking|Running|Cycling|Distance|Exercise|Move|Stand|Flight|Swimming|Workout|PhysicalEffort)' THEN 'activity'
         WHEN type_identifier ~ '(Body|Height|Waist|Temperature)' THEN 'body'
         WHEN type_identifier ~ '(Environmental|Audio|Daylight|UVExposure)' THEN 'environment'
         WHEN type_identifier ~ '(Mood|Mind|GAD7|PHQ9|StateOfMind)' THEN 'mind'
         ELSE 'health'
       END,
       type_identifier,
       CASE WHEN has_numeric THEN 'quantity' WHEN has_category THEN 'category' ELSE 'event' END,
       CASE WHEN has_daily_summary THEN 'daily_summary' ELSE 'raw_event' END,
       'calendar_day',
       CASE
         WHEN has_daily_summary AND CARDINALITY(observed_statistics) > 0 THEN observed_statistics
         WHEN has_numeric THEN ARRAY['mean', 'minimum', 'maximum', 'latest', 'count']
         ELSE ARRAY['count']
       END,
       false,
       'Observed Apple Health signal with generic semantics. Preserve provenance and interpret only after adding a curated definition.'
     FROM observed
     ON CONFLICT (source_system, source_type_identifier) DO NOTHING`,
    [ownerId],
  );
}

async function rebuildNumericFeatures(parameters) {
  await sql.query(
    `WITH base AS (
       SELECT
         o.owner_id,
         o.type_identifier,
         d.signal_key,
         d.default_statistics,
         CASE d.day_assignment
           WHEN 'event_end' THEN COALESCE(o.end_date, o.start_date)
           WHEN 'wake_day' THEN COALESCE(o.end_date, o.start_date)
           ELSE o.start_date
         END AS effective_at,
         o.start_date,
         o.end_date,
         o.numeric_value,
         o.unit,
         NULLIF(o.metadata_json->>'aggregation', '') AS source_aggregation
       FROM health_current_observations o
       JOIN health_signal_definitions d
         ON d.source_system = 'apple_health'
        AND d.source_type_identifier = o.type_identifier
       WHERE o.owner_id = $1
         AND o.operation = 'upsert'
         AND o.numeric_value IS NOT NULL
         AND o.start_date IS NOT NULL
         AND d.value_kind IN ('quantity', 'score')
     ), bounded AS (
       SELECT *, (effective_at AT TIME ZONE $2)::date AS feature_date
       FROM base
       WHERE (effective_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
     ), grouped AS (
       SELECT
         owner_id,
         feature_date,
         type_identifier,
         signal_key,
         default_statistics,
         source_aggregation,
         COUNT(*)::int AS sample_count,
         COUNT(DISTINCT unit)::int AS unit_count,
         MAX(unit) AS unit,
         AVG(numeric_value) AS mean_value,
         SUM(numeric_value) AS sum_value,
         MIN(numeric_value) AS minimum_value,
         MAX(numeric_value) AS maximum_value,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY numeric_value) AS median_value,
         percentile_cont(0.1) WITHIN GROUP (ORDER BY numeric_value) AS p10_value,
         (array_agg(numeric_value ORDER BY start_date DESC))[1] AS latest_value,
         MIN(start_date) AS window_start,
         MAX(COALESCE(end_date, start_date)) AS window_end
       FROM bounded
       GROUP BY
         owner_id, feature_date, type_identifier, signal_key,
         default_statistics, source_aggregation
     ), projected AS (
       SELECT
         grouped.*,
         REPLACE(source_aggregation, 'daily.', '') AS statistic,
         mean_value AS feature_value
       FROM grouped
       WHERE source_aggregation LIKE 'daily.%'
         AND REPLACE(source_aggregation, 'daily.', '') = ANY(default_statistics)
       UNION ALL
       SELECT grouped.*, feature.statistic, feature.feature_value
       FROM grouped
       CROSS JOIN LATERAL (
         VALUES
           ('mean', mean_value),
           ('sum', sum_value),
           ('minimum', minimum_value),
           ('maximum', maximum_value),
           ('median', median_value),
           ('p10', p10_value),
           ('latest', latest_value),
           ('count', sample_count::double precision)
       ) AS feature(statistic, feature_value)
       WHERE source_aggregation IS NULL
         AND feature.statistic = ANY(default_statistics)
         AND NOT EXISTS (
           SELECT 1
           FROM grouped summary
           WHERE summary.owner_id = grouped.owner_id
             AND summary.feature_date = grouped.feature_date
             AND summary.type_identifier = grouped.type_identifier
             AND summary.source_aggregation = 'daily.' || feature.statistic
         )
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, unit, sample_count,
       quality, window_start, window_end, source_types, provenance_json,
       feature_version
     )
     SELECT
       owner_id,
       feature_date,
       signal_key || '.' || statistic,
       feature_value,
       CASE WHEN statistic = 'count' THEN 'count' ELSE unit END,
       sample_count,
       CASE WHEN unit_count > 1 THEN 'suspect' ELSE 'derived' END,
       window_start,
       window_end,
       ARRAY[type_identifier],
       jsonb_build_object(
         'kind', 'daily_numeric_aggregation',
         'statistic', statistic,
         'sourceAggregation', source_aggregation,
         'sourceUnitsObserved', unit_count
       ),
       $5
     FROM projected
     WHERE feature_value IS NOT NULL
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       text_value = NULL,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildSleepFeatures(parameters) {
  await sql.query(
    `WITH sleep_samples AS (
       SELECT
         owner_id,
         (end_date AT TIME ZONE $2)::date AS feature_date,
         COALESCE(source_bundle_identifier, source_name, 'unknown') AS source_key,
         source_name,
         source_bundle_identifier,
         category_value,
         start_date,
         end_date,
         EXTRACT(EPOCH FROM (end_date - start_date)) AS duration_seconds
       FROM health_current_observations
       WHERE owner_id = $1
         AND operation = 'upsert'
         AND type_identifier = 'HKCategoryTypeIdentifierSleepAnalysis'
         AND category_value BETWEEN 0 AND 5
         AND start_date IS NOT NULL
         AND end_date > start_date
         AND end_date - start_date <= INTERVAL '24 hours'
         AND (end_date AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
     ), source_days AS (
       SELECT
         owner_id,
         feature_date,
         source_key,
         MAX(source_name) AS source_name,
         MAX(source_bundle_identifier) AS source_bundle_identifier,
         COUNT(*)::int AS sample_count,
         SUM(duration_seconds) FILTER (WHERE category_value IN (1, 3, 4, 5)) AS asleep_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value IN (3, 4, 5)) AS staged_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value = 0) AS in_bed_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value = 2) AS awake_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value = 3) AS core_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value = 4) AS deep_seconds,
         SUM(duration_seconds) FILTER (WHERE category_value = 5) AS rem_seconds,
         MIN(start_date) FILTER (WHERE category_value IN (1, 3, 4, 5)) AS sleep_start,
         MAX(end_date) FILTER (WHERE category_value IN (1, 3, 4, 5)) AS sleep_end
       FROM sleep_samples
       GROUP BY owner_id, feature_date, source_key
     ), ranked AS (
       SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY owner_id, feature_date
           ORDER BY COALESCE(staged_seconds, 0) DESC, COALESCE(asleep_seconds, 0) DESC, source_key
         ) AS source_rank
       FROM source_days
       WHERE asleep_seconds > 0 AND sleep_end > sleep_start
     ), selected AS (
       SELECT *,
         EXTRACT(EPOCH FROM (sleep_end - sleep_start)) AS window_seconds,
         EXTRACT(EPOCH FROM ((sleep_start AT TIME ZONE $2)::time)) / 3600.0 AS onset_local_hour,
         EXTRACT(EPOCH FROM ((sleep_end AT TIME ZONE $2)::time)) / 3600.0 AS wake_local_hour,
         EXTRACT(EPOCH FROM (((sleep_start + ((sleep_end - sleep_start) / 2)) AT TIME ZONE $2)::time)) / 3600.0 AS midpoint_local_hour
       FROM ranked
       WHERE source_rank = 1
     ), features AS (
       SELECT selected.*, feature.feature_key, feature.numeric_value, feature.unit
       FROM selected
       CROSS JOIN LATERAL (
         VALUES
           ('sleep.duration.asleep_hours', asleep_seconds / 3600.0, 'h'),
           ('sleep.duration.in_bed_hours', COALESCE(in_bed_seconds, 0) / 3600.0, 'h'),
           ('sleep.duration.awake_hours', COALESCE(awake_seconds, 0) / 3600.0, 'h'),
           ('sleep.stage.core_hours', COALESCE(core_seconds, 0) / 3600.0, 'h'),
           ('sleep.stage.deep_hours', COALESCE(deep_seconds, 0) / 3600.0, 'h'),
           ('sleep.stage.rem_hours', COALESCE(rem_seconds, 0) / 3600.0, 'h'),
           ('sleep.window.hours', window_seconds / 3600.0, 'h'),
           ('sleep.efficiency.ratio', LEAST(1.0, asleep_seconds / NULLIF(window_seconds, 0)), 'ratio'),
           ('sleep.stage.core_ratio', COALESCE(core_seconds, 0) / NULLIF(asleep_seconds, 0), 'ratio'),
           ('sleep.stage.deep_ratio', COALESCE(deep_seconds, 0) / NULLIF(asleep_seconds, 0), 'ratio'),
           ('sleep.stage.rem_ratio', COALESCE(rem_seconds, 0) / NULLIF(asleep_seconds, 0), 'ratio'),
           ('sleep.onset.local_hour', onset_local_hour, 'hour'),
           ('sleep.wake.local_hour', wake_local_hour, 'hour'),
           ('sleep.midpoint.local_hour', midpoint_local_hour, 'hour')
       ) AS feature(feature_key, numeric_value, unit)
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, unit, sample_count,
       coverage_ratio, quality, window_start, window_end, source_types,
       provenance_json, feature_version
     )
     SELECT
       owner_id,
       feature_date,
       feature_key,
       numeric_value,
       unit,
       sample_count,
       LEAST(1.0, asleep_seconds / NULLIF(window_seconds, 0)),
       CASE
         WHEN asleep_seconds < 2 * 3600 OR asleep_seconds > 16 * 3600 THEN 'suspect'
         WHEN staged_seconds IS NULL OR staged_seconds = 0 THEN 'partial'
         ELSE 'derived'
       END,
       sleep_start,
       sleep_end,
       ARRAY['HKCategoryTypeIdentifierSleepAnalysis'],
       jsonb_build_object(
         'kind', 'sleep_episode_summary',
         'dayAssignment', 'wake_day',
         'selectedSourceName', source_name,
         'selectedSourceBundle', source_bundle_identifier,
         'sourceSelection', 'greatest_specific_stage_coverage'
       ),
       $5
     FROM features
     WHERE numeric_value IS NOT NULL
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       coverage_ratio = EXCLUDED.coverage_ratio,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildStandFeatures(parameters) {
  await sql.query(
    `WITH daily AS (
       SELECT
         owner_id,
         (start_date AT TIME ZONE $2)::date AS feature_date,
         COUNT(*)::int AS sample_count,
         COUNT(*) FILTER (WHERE category_value = 0)::double precision AS stood_hours,
         COUNT(*) FILTER (WHERE category_value = 1)::double precision AS idle_hours,
         MIN(start_date) AS window_start,
         MAX(end_date) AS window_end
       FROM health_current_observations
       WHERE owner_id = $1
         AND operation = 'upsert'
         AND type_identifier = 'HKCategoryTypeIdentifierAppleStandHour'
         AND start_date IS NOT NULL
         AND (start_date AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
       GROUP BY owner_id, (start_date AT TIME ZONE $2)::date
     ), features AS (
       SELECT daily.*, feature.feature_key, feature.numeric_value
       FROM daily
       CROSS JOIN LATERAL (
         VALUES
           ('activity.stand_hours.successful', stood_hours),
           ('activity.stand_hours.idle', idle_hours),
           ('activity.stand_hours.observed', sample_count::double precision)
       ) AS feature(feature_key, numeric_value)
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, unit, sample_count,
       quality, window_start, window_end, source_types, provenance_json,
       feature_version
     )
     SELECT
       owner_id, feature_date, feature_key, numeric_value, 'count', sample_count,
       'derived', window_start, window_end,
       ARRAY['HKCategoryTypeIdentifierAppleStandHour'],
       jsonb_build_object('kind', 'stand_hour_count', 'stoodCategoryValue', 0),
       $5
     FROM features
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildWorkoutFeatures(parameters) {
  await sql.query(
    `WITH daily AS (
       SELECT
         owner_id,
         (start_date AT TIME ZONE $2)::date AS feature_date,
         COUNT(*)::int AS workout_count,
         SUM(numeric_value) / 60.0 AS workout_minutes,
         SUM(NULLIF(metadata_json->>'totalEnergyKilocalories', '')::double precision) AS total_energy_kilocalories,
         SUM(NULLIF(metadata_json->>'totalDistanceMeters', '')::double precision) AS total_distance_meters,
         STRING_AGG(DISTINCT metadata_json->>'workoutActivityType', ',' ORDER BY metadata_json->>'workoutActivityType') AS activity_types,
         MIN(start_date) AS window_start,
         MAX(end_date) AS window_end
       FROM health_current_observations
       WHERE owner_id = $1
         AND operation = 'upsert'
         AND type_identifier = 'HKWorkoutTypeIdentifier'
         AND start_date IS NOT NULL
         AND (start_date AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
       GROUP BY owner_id, (start_date AT TIME ZONE $2)::date
     ), features AS (
       SELECT
         daily.*,
         feature.feature_key,
         feature.numeric_value,
         feature.text_value,
         feature.unit
       FROM daily
       CROSS JOIN LATERAL (
         VALUES
           ('workout.session.count', workout_count::double precision, NULL::text, 'count'),
           ('workout.duration.total_minutes', workout_minutes, NULL::text, 'min'),
           ('workout.energy.total_kilocalories', total_energy_kilocalories, NULL::text, 'kcal'),
           ('workout.distance.total_meters', total_distance_meters, NULL::text, 'm'),
           ('workout.activity_types', NULL::double precision, activity_types, NULL::text)
       ) AS feature(feature_key, numeric_value, text_value, unit)
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, text_value, unit,
       sample_count, quality, window_start, window_end, source_types,
       provenance_json, feature_version
     )
     SELECT
       owner_id, feature_date, feature_key, numeric_value, text_value, unit,
       workout_count, 'derived', window_start, window_end,
       ARRAY['HKWorkoutTypeIdentifier'],
       jsonb_build_object('kind', 'workout_day_summary'),
       $5
     FROM features
     WHERE numeric_value IS NOT NULL OR text_value IS NOT NULL
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       text_value = EXCLUDED.text_value,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildCategoryFeatures(parameters) {
  await sql.query(
    `WITH base AS (
       SELECT
         o.owner_id,
         (o.start_date AT TIME ZONE $2)::date AS feature_date,
         o.type_identifier,
         d.signal_key,
         o.category_value,
         o.start_date,
         o.end_date
       FROM health_current_observations o
       JOIN health_signal_definitions d
         ON d.source_system = 'apple_health'
        AND d.source_type_identifier = o.type_identifier
       WHERE o.owner_id = $1
         AND o.operation = 'upsert'
         AND o.start_date IS NOT NULL
         AND d.value_kind IN ('category', 'event', 'interval')
         AND o.type_identifier NOT IN (
           'HKCategoryTypeIdentifierSleepAnalysis',
           'HKCategoryTypeIdentifierAppleStandHour',
           'HKWorkoutTypeIdentifier'
         )
         AND (o.start_date AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
     ), daily AS (
       SELECT
         owner_id,
         feature_date,
         type_identifier,
         signal_key,
         COUNT(*)::int AS event_count,
         MAX(category_value)::double precision AS category_maximum,
         (array_agg(category_value ORDER BY start_date DESC))[1]::double precision AS category_latest,
         SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(end_date, start_date) - start_date)))) / 60.0 AS duration_minutes,
         MIN(start_date) AS window_start,
         MAX(COALESCE(end_date, start_date)) AS window_end
       FROM base
       GROUP BY owner_id, feature_date, type_identifier, signal_key
     ), features AS (
       SELECT daily.*, feature.suffix, feature.numeric_value, feature.unit
       FROM daily
       CROSS JOIN LATERAL (
         VALUES
           ('event_count', event_count::double precision, 'count'),
           ('category_maximum', category_maximum, 'category'),
           ('category_latest', category_latest, 'category'),
           ('duration_minutes', NULLIF(duration_minutes, 0), 'min')
       ) AS feature(suffix, numeric_value, unit)
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, unit, sample_count,
       quality, window_start, window_end, source_types, provenance_json,
       feature_version
     )
     SELECT
       owner_id,
       feature_date,
       signal_key || '.' || suffix,
       numeric_value,
       unit,
       event_count,
       'derived',
       window_start,
       window_end,
       ARRAY[type_identifier],
       jsonb_build_object(
         'kind', 'generic_category_summary',
         'interpretation', 'Requires the source category definition before semantic claims'
       ),
       $5
     FROM features
     WHERE numeric_value IS NOT NULL
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildRollingFeatures(parameters) {
  await sql.query(
    `WITH base AS (
       SELECT
         *,
         AVG(numeric_value) OVER (
           PARTITION BY owner_id, feature_key
           ORDER BY feature_date::timestamp
           RANGE BETWEEN INTERVAL '28 days' PRECEDING AND INTERVAL '1 day' PRECEDING
         ) AS baseline_28d,
         STDDEV_SAMP(numeric_value) OVER (
           PARTITION BY owner_id, feature_key
           ORDER BY feature_date::timestamp
           RANGE BETWEEN INTERVAL '28 days' PRECEDING AND INTERVAL '1 day' PRECEDING
         ) AS standard_deviation_28d,
         COUNT(numeric_value) OVER (
           PARTITION BY owner_id, feature_key
           ORDER BY feature_date::timestamp
           RANGE BETWEEN INTERVAL '28 days' PRECEDING AND INTERVAL '1 day' PRECEDING
         ) AS baseline_samples
       FROM health_daily_features
       WHERE owner_id = $1
         AND feature_version = $5
         AND numeric_value IS NOT NULL
         AND provenance_json->>'kind' NOT IN ('personal_baseline', 'personal_deviation')
         AND feature_date BETWEEN ($3::date - INTERVAL '28 days') AND $4::date
     ), features AS (
       SELECT
         base.*,
         feature.suffix,
         feature.feature_value,
         feature.kind
       FROM base
       CROSS JOIN LATERAL (
         VALUES
           ('baseline_28d', baseline_28d, 'personal_baseline'),
           ('delta_28d', numeric_value - baseline_28d, 'personal_deviation'),
           ('zscore_28d', (numeric_value - baseline_28d) / NULLIF(standard_deviation_28d, 0), 'personal_deviation')
       ) AS feature(suffix, feature_value, kind)
       WHERE baseline_samples >= 7
     )
     INSERT INTO health_daily_features (
       owner_id, feature_date, feature_key, numeric_value, unit, sample_count,
       coverage_ratio, quality, window_start, window_end, source_types,
       provenance_json, feature_version
     )
     SELECT
       owner_id,
       feature_date,
       feature_key || '.' || suffix,
       feature_value,
       CASE WHEN suffix = 'zscore_28d' THEN 'z-score' ELSE unit END,
       baseline_samples::int,
       LEAST(1.0, baseline_samples / 28.0),
       'derived',
       feature_date::timestamp - INTERVAL '28 days',
       feature_date::timestamp,
       source_types,
       jsonb_build_object(
         'kind', kind,
         'baseFeature', feature_key,
         'lookbackDays', 28,
         'baselineSamples', baseline_samples,
         'leakageBoundary', 'strictly_before_feature_date'
       ),
       $5
     FROM features
     WHERE feature_value IS NOT NULL
       AND feature_date BETWEEN $3::date AND $4::date
     ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
       numeric_value = EXCLUDED.numeric_value,
       unit = EXCLUDED.unit,
       sample_count = EXCLUDED.sample_count,
       coverage_ratio = EXCLUDED.coverage_ratio,
       quality = EXCLUDED.quality,
       window_start = EXCLUDED.window_start,
       window_end = EXCLUDED.window_end,
       source_types = EXCLUDED.source_types,
       provenance_json = EXCLUDED.provenance_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

async function rebuildProfiles(parameters) {
  await sql.query(
    `WITH domain_counts AS (
       SELECT
         owner_id,
         feature_date,
         split_part(feature_key, '.', 1) AS domain,
         COUNT(*)::int AS feature_count,
         COUNT(*) FILTER (WHERE quality IN ('observed', 'derived'))::int AS trusted_count
       FROM health_daily_features
       WHERE owner_id = $1 AND feature_version = $5
         AND feature_date BETWEEN $3::date AND $4::date
       GROUP BY owner_id, feature_date, split_part(feature_key, '.', 1)
     ), coverage AS (
       SELECT
         owner_id,
         feature_date,
         jsonb_object_agg(
           domain,
           jsonb_build_object('features', feature_count, 'trusted', trusted_count)
           ORDER BY domain
         ) AS domain_coverage_json
       FROM domain_counts
       GROUP BY owner_id, feature_date
     ), profiles AS (
       SELECT
         owner_id,
         feature_date,
         jsonb_object_agg(
           feature_key,
           jsonb_strip_nulls(jsonb_build_object(
             'value', numeric_value,
             'text', text_value,
             'unit', unit,
             'quality', quality,
             'coverage', coverage_ratio,
             'samples', sample_count
           ))
           ORDER BY feature_key
         ) AS features
       FROM health_daily_features
       WHERE owner_id = $1 AND feature_version = $5
         AND feature_date BETWEEN $3::date AND $4::date
       GROUP BY owner_id, feature_date
     )
     INSERT INTO health_daily_profiles (
       owner_id, profile_date, profile_json, domain_coverage_json,
       profile_version
     )
     SELECT
       profiles.owner_id,
       profiles.feature_date,
       jsonb_build_object(
         'date', profiles.feature_date,
         'timeZone', $2,
         'featureVersion', $5,
         'features', profiles.features
       ),
       coverage.domain_coverage_json,
       $5
     FROM profiles
     JOIN coverage USING (owner_id, feature_date)
     ON CONFLICT (owner_id, profile_date, profile_version) DO UPDATE SET
       profile_json = EXCLUDED.profile_json,
       domain_coverage_json = EXCLUDED.domain_coverage_json,
       computed_at = now()`,
    parameterValues(parameters),
  );
}

function parameterValues({ ownerId, timeZone, minimumDate, maximumDate, featureVersion }) {
  return [ownerId, timeZone, minimumDate, maximumDate, featureVersion];
}

function parseArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const name = argument.slice(2);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (!["owner", "timezone", "from", "through", "chunk-days"].includes(name)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    result[name] = value;
    index += 1;
  }
  return result;
}

function partitionDateRange(from, through, maximumDays) {
  const chunks = [];
  const finalDate = parseUtcDate(through);
  let cursor = parseUtcDate(from);
  while (cursor <= finalDate) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maximumDays - 1);
    if (chunkEnd > finalDate) chunkEnd.setTime(finalDate.getTime());
    chunks.push({ from: formatUtcDate(cursor), through: formatUtcDate(chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

function parseUtcDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatUtcDate(value) {
  return value.toISOString().slice(0, 10);
}

function validatePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function validateDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`--${name} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`--${name} is not a valid date`);
  }
  return value;
}
