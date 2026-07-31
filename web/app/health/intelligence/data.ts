import "server-only";

import { getDatabase } from "../../../lib/database";
import type {
  DailyHealthProfile,
  FactorScore,
  IntelligenceEvidence,
  MoodEvidence,
  SignalDefinition,
  TrendPoint,
} from "./types";

type SettingsRow = { homeTimeZone: string; featureVersion: string };
type FreshnessRow = { lastReceivedAt: string | null; latestEffectiveAt: string | null };
type ProfileRow = {
  profileDate: string;
  profile: DailyHealthProfile;
  domainCoverage: IntelligenceEvidence["domainCoverage"];
};

export async function loadIntelligenceDay(requestedDate?: string): Promise<IntelligenceEvidence> {
  const sql = getDatabase();
  const ownerId = ownerIdentifier();
  const settings = await loadSettings();
  const profileRows = requestedDate
    ? await sql`SELECT
          profile_date::text AS "profileDate",
          profile_json AS profile,
          domain_coverage_json AS "domainCoverage"
        FROM health_daily_profiles
        WHERE owner_id = ${ownerId}
          AND profile_version = ${settings.featureVersion}
          AND profile_date = ${requestedDate}::date
        LIMIT 1`
    : await sql`SELECT
          profile_date::text AS "profileDate",
          profile_json AS profile,
          domain_coverage_json AS "domainCoverage"
        FROM health_daily_profiles
        WHERE owner_id = ${ownerId}
          AND profile_version = ${settings.featureVersion}
        ORDER BY profile_date DESC
        LIMIT 1`;
  const profiles = profileRows as unknown as ProfileRow[];
  const selectedDate = profiles[0]?.profileDate ?? requestedDate ?? localDate(new Date(), settings.homeTimeZone);

  const [moodRows, factorRows] = await Promise.all([
    sql`SELECT
          start_date::text AS "observedAt",
          numeric_value AS valence,
          metadata_json->>'kind' AS kind,
          metadata_json->>'valenceClassification' AS classification,
          CASE
            WHEN COALESCE(metadata_json->>'labels', '') = '' THEN ARRAY[]::text[]
            ELSE string_to_array(metadata_json->>'labels', ',')
          END AS labels,
          CASE
            WHEN COALESCE(metadata_json->>'associations', '') = '' THEN ARRAY[]::text[]
            ELSE string_to_array(metadata_json->>'associations', ',')
          END AS associations,
          source_name AS "sourceName"
        FROM health_current_observations
        WHERE owner_id = ${ownerId}
          AND operation = 'upsert'
          AND type_identifier = 'HKStateOfMindTypeIdentifier'
          AND (start_date AT TIME ZONE ${settings.homeTimeZone})::date = ${selectedDate}::date
        ORDER BY start_date`,
    sql`SELECT
          feature_key AS "featureKey",
          lag_days AS "lagDays",
          prediction_horizon_days AS "horizonDays",
          sample_size AS "sampleSize",
          coverage_ratio AS coverage,
          direction,
          standardized_effect AS "standardizedEffect",
          out_of_sample_gain AS "predictiveGain",
          stability,
          k_score AS "kScore",
          model_version AS "modelVersion"
        FROM health_factor_scores
        WHERE owner_id = ${ownerId} AND target_key = 'mind.valence'
        ORDER BY ABS(k_score) DESC NULLS LAST
        LIMIT 12`,
  ]);

  return {
    date: selectedDate,
    profile: profiles[0]?.profile ?? null,
    domainCoverage: profiles[0]?.domainCoverage ?? {},
    mood: moodRows as unknown as MoodEvidence[],
    factors: factorRows as unknown as FactorScore[],
    caveats: [
      "Derived features are personal measurements and estimates, not diagnoses.",
      "Missing data means unknown, not zero.",
      "Factor scores are predictive associations and must not be described as causal effects.",
      `Calendar-day features use ${settings.homeTimeZone}; sleep is assigned to the wake date.`,
    ],
  };
}

export async function loadFeatureTrend(
  featureKey: string,
  fromDate: string,
  throughDate: string,
): Promise<TrendPoint[]> {
  const sql = getDatabase();
  const settings = await loadSettings();
  const rows = await sql`SELECT
      feature_date::text AS date,
      numeric_value AS value,
      unit,
      quality,
      coverage_ratio AS coverage
    FROM health_daily_features
    WHERE owner_id = ${ownerIdentifier()}
      AND feature_version = ${settings.featureVersion}
      AND feature_key = ${featureKey}
      AND numeric_value IS NOT NULL
      AND feature_date BETWEEN ${fromDate}::date AND ${throughDate}::date
    ORDER BY feature_date`;
  return rows as unknown as TrendPoint[];
}

export async function loadSignalCatalog(): Promise<SignalDefinition[]> {
  const sql = getDatabase();
  const rows = await sql`SELECT
      source_type_identifier AS "sourceTypeIdentifier",
      signal_key AS "signalKey",
      domain,
      display_name AS "displayName",
      value_kind AS "valueKind",
      canonical_unit AS "canonicalUnit",
      storage_grain AS "storageGrain",
      day_assignment AS "dayAssignment",
      default_statistics AS "defaultStatistics",
      is_mood_target AS "isMoodTarget",
      ai_description AS description
    FROM health_signal_definitions
    WHERE source_system = 'apple_health'
    ORDER BY domain, signal_key`;
  return rows as unknown as SignalDefinition[];
}

export async function loadAIContext(
  requestedDate: string | undefined,
  lookbackDays: number,
): Promise<Record<string, unknown>> {
  const day = await loadIntelligenceDay(requestedDate);
  const sql = getDatabase();
  const ownerId = ownerIdentifier();
  const settings = await loadSettings();
  const [recentMood, insights, freshnessRows] = await Promise.all([
    sql`SELECT
        (start_date AT TIME ZONE ${settings.homeTimeZone})::date::text AS date,
        AVG(numeric_value) AS valence,
        COUNT(*)::int AS "sampleCount"
      FROM health_current_observations
      WHERE owner_id = ${ownerId}
        AND operation = 'upsert'
        AND type_identifier = 'HKStateOfMindTypeIdentifier'
        AND numeric_value IS NOT NULL
        AND (start_date AT TIME ZONE ${settings.homeTimeZone})::date
          BETWEEN (${day.date}::date - ${lookbackDays}::int) AND ${day.date}::date
      GROUP BY (start_date AT TIME ZONE ${settings.homeTimeZone})::date
      ORDER BY date`,
    sql`SELECT
        insight_type AS "insightType",
        title,
        narrative,
        period_start::text AS "periodStart",
        period_end::text AS "periodEnd",
        confidence,
        status,
        evidence_json AS evidence
      FROM health_insights
      WHERE owner_id = ${ownerId}
        AND period_end >= (${day.date}::date - ${lookbackDays}::int)
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC
      LIMIT 10`,
    sql`SELECT
        MAX(received_at)::text AS "lastReceivedAt",
        MAX(COALESCE(end_date, start_date))::text AS "latestEffectiveAt"
      FROM health_current_observations
      WHERE owner_id = ${ownerId}`,
  ]);
  const freshness = (freshnessRows as unknown as FreshnessRow[])[0]
    ?? { lastReceivedAt: null, latestEffectiveAt: null };
  const recentMoodEvidence = recentMood as unknown as Record<string, unknown>[];
  const activeInsights = insights as unknown as Record<string, unknown>[];

  return {
    schema: "kairo.health.ai-context.v1",
    generatedAt: new Date().toISOString(),
    intendedUse: "Personal reflection, longitudinal pattern finding, and evidence retrieval",
    prohibitedClaims: [
      "diagnosis",
      "causation from association alone",
      "certainty when data is missing or low quality",
    ],
    day,
    recentMood: recentMoodEvidence,
    insights: activeInsights,
    jarvis: buildJarvisHealthView(day, recentMoodEvidence, activeInsights, freshness),
  };
}

function buildJarvisHealthView(
  day: IntelligenceEvidence,
  recentMood: readonly Record<string, unknown>[],
  insights: readonly Record<string, unknown>[],
  freshness: Record<string, unknown>,
): Record<string, unknown> {
  const features = day.profile?.features ?? {};
  const deviations = Object.entries(features)
    .filter(([featureKey, feature]) => featureKey.endsWith(".zscore_28d")
      && typeof feature.value === "number"
      && Math.abs(feature.value) >= 0.75)
    .sort((left, right) => Math.abs(right[1].value ?? 0) - Math.abs(left[1].value ?? 0))
    .slice(0, 12)
    .map(([featureKey, feature]) => ({
      featureKey: featureKey.slice(0, -".zscore_28d".length),
      direction: (feature.value ?? 0) > 0 ? "above_personal_baseline" : "below_personal_baseline",
      standardDeviations: feature.value,
      quality: feature.quality,
      coverage: feature.coverage ?? null,
    }));
  const patterns = day.factors
    .filter((factor) => factor.kScore !== null
      && factor.predictiveGain !== null
      && factor.predictiveGain > 0)
    .slice(0, 8);

  return {
    schema: "kairo.jarvis.health-view.v1",
    now: {
      date: day.date,
      freshness,
      coverage: day.domainCoverage,
      notablePersonalDeviations: deviations,
    },
    patterns,
    memory: {
      recentDeclaredMood: recentMood,
      activeInsights: insights,
    },
    needsAttention: [
      ...(day.mood.length === 0
        ? ["No State of Mind entry exists for this day; mood prediction has no same-day ground truth."]
        : []),
      ...(patterns.length === 0
        ? ["No health factor has yet beaten the temporal personal-baseline model with sufficient evidence."]
        : []),
    ],
    responseRules: [
      "Lead with what changed relative to the owner, not a generic population average.",
      "Separate observed facts, predictive patterns, and hypotheses.",
      "Include freshness, coverage, target horizon, and uncertainty.",
      "Prefer one useful follow-up or low-risk experiment over a long list of correlations.",
    ],
  };
}

async function loadSettings(): Promise<SettingsRow> {
  const sql = getDatabase();
  const rows = await sql`SELECT
      home_time_zone AS "homeTimeZone",
      feature_version AS "featureVersion"
    FROM health_owner_settings
    WHERE owner_id = ${ownerIdentifier()}
    LIMIT 1`;
  const settings = rows as unknown as SettingsRow[];
  return settings[0] ?? {
    homeTimeZone: process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata",
    featureVersion: "health-v1",
  };
}

function ownerIdentifier(): string {
  return process.env.KAIRO_OWNER_ID ?? "primary";
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
