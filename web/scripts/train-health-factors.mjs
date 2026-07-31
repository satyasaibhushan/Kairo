import { neon } from "@neondatabase/serverless";
import { addDays, evaluateWalkForward } from "./health-factor-model.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL before training health factors");

const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
const featureVersion = "health-v1";
const modelVersion = "univariate-walk-forward-v1";
const minimumPairs = 20;
const sql = neon(databaseUrl);

const settingsRows = await sql.query(
  `SELECT home_time_zone AS "timeZone"
   FROM health_owner_settings
   WHERE owner_id = $1
   LIMIT 1`,
  [ownerId],
);
const timeZone = settingsRows[0]?.timeZone ?? process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata";

const [moodRows, featureRows] = await Promise.all([
  sql.query(
    `SELECT
       (start_date AT TIME ZONE $2)::date::text AS date,
       AVG(numeric_value)::double precision AS value
     FROM health_current_observations
     WHERE owner_id = $1
       AND operation = 'upsert'
       AND type_identifier = 'HKStateOfMindTypeIdentifier'
       AND numeric_value IS NOT NULL
     GROUP BY (start_date AT TIME ZONE $2)::date
     ORDER BY date`,
    [ownerId, timeZone],
  ),
  sql.query(
    `SELECT
       feature_date::text AS date,
       feature_key AS "featureKey",
       numeric_value::double precision AS value
     FROM health_daily_features
     WHERE owner_id = $1
       AND feature_version = $2
       AND numeric_value IS NOT NULL
       AND quality IN ('observed', 'derived')
       AND feature_key NOT LIKE 'mind.valence.%'
       AND provenance_json->>'kind' NOT IN ('personal_baseline', 'personal_deviation')
     ORDER BY feature_key, feature_date`,
    [ownerId, featureVersion],
  ),
]);

const targetByDate = new Map(moodRows.map((row) => [row.date, Number(row.value)]));
const valuesByFeature = new Map();
for (const row of featureRows) {
  const values = valuesByFeature.get(row.featureKey) ?? new Map();
  values.set(row.date, Number(row.value));
  valuesByFeature.set(row.featureKey, values);
}

const scores = [];
for (const [featureKey, valuesByDate] of valuesByFeature) {
  for (const horizonDays of [0, 1]) {
    for (const lagDays of [0, 1, 2]) {
      if (horizonDays === 0 && lagDays > 0) continue;
      const offsetDays = horizonDays + lagDays;
      const pairs = moodRows
        .map((mood) => ({
          date: mood.date,
          x: valuesByDate.get(addDays(mood.date, -offsetDays)),
          y: Number(mood.value),
        }))
        .filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y));
      if (pairs.length < minimumPairs) continue;

      const result = evaluateWalkForward(pairs);
      if (!result) continue;
      const coverage = Math.min(1, pairs.length / Math.max(1, targetByDate.size));
      const direction = Math.sign(result.correlation);
      const kScore = direction
        * Math.max(0, Math.min(1, result.predictiveGain))
        * result.stability
        * Math.sqrt(coverage);

      scores.push({
        owner_id: ownerId,
        target_key: "mind.valence",
        prediction_horizon_days: horizonDays,
        feature_key: featureKey,
        lag_days: lagDays,
        sample_size: pairs.length,
        coverage_ratio: coverage,
        direction,
        standardized_effect: result.correlation,
        out_of_sample_gain: result.predictiveGain,
        stability: result.stability,
        k_score: kScore,
        model_type: "univariate_linear_regression",
        model_version: modelVersion,
        trained_from: pairs[0].date,
        trained_through: pairs.at(-1).date,
        evidence_json: {
          target: "Mean self-reported State of Mind valence on the target personal day",
          horizon: horizonDays === 0 ? "same-day association" : "next-day prediction",
          featureDateRule: `target date minus ${offsetDays} day(s)`,
          validation: "expanding-window walk-forward",
          baseline: "prior training-target mean",
          modelMeanAbsoluteError: result.modelMeanAbsoluteError,
          baselineMeanAbsoluteError: result.baselineMeanAbsoluteError,
          evaluatedDays: result.evaluatedDays,
          minimumPairs,
          interpretation: "Predictive ranking only; not causal or diagnostic",
        },
      });
    }
  }
}

await sql.query(
  `DELETE FROM health_factor_scores
   WHERE owner_id = $1 AND model_version = $2`,
  [ownerId, modelVersion],
);

for (let index = 0; index < scores.length; index += 200) {
  const batch = scores.slice(index, index + 200);
  await sql.query(
    `INSERT INTO health_factor_scores (
       owner_id, target_key, prediction_horizon_days, feature_key, lag_days,
       sample_size, coverage_ratio, direction, standardized_effect,
       out_of_sample_gain, stability, k_score, model_type, model_version,
       trained_from, trained_through, evidence_json
     )
     SELECT
       record.owner_id, record.target_key, record.prediction_horizon_days,
       record.feature_key, record.lag_days, record.sample_size,
       record.coverage_ratio, record.direction, record.standardized_effect,
       record.out_of_sample_gain, record.stability, record.k_score,
       record.model_type, record.model_version, record.trained_from::date,
       record.trained_through::date, record.evidence_json
     FROM jsonb_to_recordset($1::jsonb) AS record(
       owner_id text,
       target_key text,
       prediction_horizon_days smallint,
       feature_key text,
       lag_days smallint,
       sample_size integer,
       coverage_ratio double precision,
       direction smallint,
       standardized_effect double precision,
       out_of_sample_gain double precision,
       stability double precision,
       k_score double precision,
       model_type text,
       model_version text,
       trained_from text,
       trained_through text,
       evidence_json jsonb
     )`,
    [JSON.stringify(batch)],
  );
}

const positiveScores = scores.filter((score) => score.k_score !== 0).length;
console.log(
  `Trained ${scores.length.toLocaleString("en-IN")} factors; ${positiveScores.toLocaleString("en-IN")} improved on the walk-forward baseline.`,
);
