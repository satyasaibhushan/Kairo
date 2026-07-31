CREATE INDEX IF NOT EXISTS idx_health_changes_owner_sample_received
  ON health_changes (owner_id, sample_id, received_at DESC);

CREATE OR REPLACE VIEW health_current_observations AS
  SELECT DISTINCT ON (owner_id, sample_id)
    owner_id,
    device_id,
    sample_id,
    source_event_id,
    operation,
    type_identifier,
    start_date,
    end_date,
    numeric_value,
    unit,
    category_value,
    source_name,
    source_bundle_identifier,
    source_version,
    device_name,
    device_model,
    device_manufacturer,
    metadata_json,
    received_at
  FROM health_changes
  ORDER BY owner_id, sample_id, received_at DESC, device_id DESC;

CREATE TABLE IF NOT EXISTS health_owner_settings (
  owner_id text PRIMARY KEY,
  home_time_zone text NOT NULL DEFAULT 'Asia/Kolkata',
  day_boundary_hour smallint NOT NULL DEFAULT 0 CHECK (day_boundary_hour BETWEEN 0 AND 12),
  feature_version text NOT NULL DEFAULT 'health-v1',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS health_signal_definitions (
  source_system text NOT NULL,
  source_type_identifier text NOT NULL,
  signal_key text NOT NULL,
  domain text NOT NULL,
  display_name text NOT NULL,
  value_kind text NOT NULL CHECK (value_kind IN ('quantity', 'category', 'interval', 'event', 'score')),
  canonical_unit text,
  storage_grain text NOT NULL CHECK (storage_grain IN ('raw_event', 'daily_summary', 'source_native')),
  day_assignment text NOT NULL CHECK (day_assignment IN ('calendar_day', 'wake_day', 'event_start', 'event_end')),
  default_statistics text[] NOT NULL DEFAULT '{}',
  is_mood_target boolean NOT NULL DEFAULT false,
  ai_description text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_type_identifier)
);

CREATE INDEX IF NOT EXISTS idx_health_signal_definitions_key
  ON health_signal_definitions (signal_key);

CREATE TABLE IF NOT EXISTS health_feature_runs (
  run_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  feature_version text NOT NULL,
  requested_from date,
  requested_through date,
  time_zone text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  feature_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_health_feature_runs_owner_started
  ON health_feature_runs (owner_id, started_at DESC);

CREATE TABLE IF NOT EXISTS health_daily_features (
  owner_id text NOT NULL,
  feature_date date NOT NULL,
  feature_key text NOT NULL,
  numeric_value double precision,
  text_value text,
  unit text,
  sample_count integer NOT NULL DEFAULT 0,
  coverage_ratio double precision CHECK (coverage_ratio IS NULL OR coverage_ratio BETWEEN 0 AND 1),
  quality text NOT NULL CHECK (quality IN ('observed', 'derived', 'partial', 'insufficient', 'suspect')),
  window_start timestamptz,
  window_end timestamptz,
  source_types text[] NOT NULL DEFAULT '{}',
  provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, feature_date, feature_key, feature_version),
  CHECK (numeric_value IS NOT NULL OR text_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_health_daily_features_owner_key_date
  ON health_daily_features (owner_id, feature_key, feature_date DESC);

CREATE TABLE IF NOT EXISTS health_daily_profiles (
  owner_id text NOT NULL,
  profile_date date NOT NULL,
  profile_json jsonb NOT NULL,
  domain_coverage_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_version text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, profile_date, profile_version)
);

CREATE INDEX IF NOT EXISTS idx_health_daily_profiles_owner_date
  ON health_daily_profiles (owner_id, profile_date DESC);

CREATE TABLE IF NOT EXISTS health_factor_scores (
  owner_id text NOT NULL,
  target_key text NOT NULL,
  prediction_horizon_days smallint NOT NULL,
  feature_key text NOT NULL,
  lag_days smallint NOT NULL,
  sample_size integer NOT NULL,
  coverage_ratio double precision NOT NULL,
  direction smallint NOT NULL CHECK (direction IN (-1, 0, 1)),
  standardized_effect double precision,
  out_of_sample_gain double precision,
  stability double precision,
  k_score double precision,
  model_type text NOT NULL,
  model_version text NOT NULL,
  trained_from date NOT NULL,
  trained_through date NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (
    owner_id,
    target_key,
    prediction_horizon_days,
    feature_key,
    lag_days,
    model_version
  )
);

CREATE INDEX IF NOT EXISTS idx_health_factor_scores_owner_target_k
  ON health_factor_scores (owner_id, target_key, ABS(k_score) DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS health_insights (
  insight_id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  insight_type text NOT NULL,
  title text NOT NULL,
  narrative text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status text NOT NULL CHECK (status IN ('hypothesis', 'observed', 'validated', 'dismissed')),
  evidence_json jsonb NOT NULL,
  generated_by text NOT NULL,
  model_version text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE health_insights
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_health_insights_owner_created
  ON health_insights (owner_id, created_at DESC);

INSERT INTO health_signal_definitions (
  source_system,
  source_type_identifier,
  signal_key,
  domain,
  display_name,
  value_kind,
  canonical_unit,
  storage_grain,
  day_assignment,
  default_statistics,
  is_mood_target,
  ai_description
) VALUES
  ('apple_health', 'HKStateOfMindTypeIdentifier', 'mind.valence', 'mind', 'State of mind valence', 'score', 'valence', 'raw_event', 'event_start', ARRAY['mean', 'minimum', 'maximum', 'latest', 'count'], true, 'Self-reported momentary emotion or daily mood; this is ground truth, not a passive inference.'),
  ('apple_health', 'HKCategoryTypeIdentifierMoodChanges', 'mind.mood_change', 'mind', 'Mood change', 'event', NULL, 'raw_event', 'event_start', ARRAY['count'], false, 'A source-recorded mood-change event.'),
  ('apple_health', 'HKCategoryTypeIdentifierMindfulSession', 'mind.mindful_session', 'mind', 'Mindful session', 'interval', 'min', 'raw_event', 'event_start', ARRAY['duration', 'count'], false, 'Time spent in a recorded mindful session.'),
  ('apple_health', 'HKScoredAssessmentTypeIdentifierGAD7', 'mind.gad7', 'mind', 'GAD-7 score', 'score', 'score', 'raw_event', 'event_start', ARRAY['latest'], false, 'A scored anxiety screening assessment; not a diagnosis.'),
  ('apple_health', 'HKScoredAssessmentTypeIdentifierPHQ9', 'mind.phq9', 'mind', 'PHQ-9 score', 'score', 'score', 'raw_event', 'event_start', ARRAY['latest'], false, 'A scored depression screening assessment; not a diagnosis.'),
  ('apple_health', 'HKCategoryTypeIdentifierSleepAnalysis', 'sleep.stage', 'sleep', 'Sleep analysis', 'interval', 'h', 'raw_event', 'wake_day', ARRAY['duration'], false, 'Sleep intervals and stages assigned to the date on which the person woke.'),
  ('apple_health', 'HKQuantityTypeIdentifierAppleSleepingWristTemperature', 'sleep.wrist_temperature', 'sleep', 'Sleeping wrist temperature', 'quantity', 'degC', 'raw_event', 'wake_day', ARRAY['mean', 'minimum', 'maximum'], false, 'Wrist temperature measured during sleep; interpret relative to the personal baseline.'),
  ('apple_health', 'HKQuantityTypeIdentifierAppleSleepingBreathingDisturbances', 'sleep.breathing_disturbances', 'sleep', 'Sleeping breathing disturbances', 'quantity', NULL, 'raw_event', 'wake_day', ARRAY['mean', 'maximum'], false, 'Apple-derived breathing disturbance measurement during sleep.'),
  ('apple_health', 'HKQuantityTypeIdentifierRespiratoryRate', 'recovery.respiratory_rate', 'recovery', 'Respiratory rate', 'quantity', 'count/min', 'raw_event', 'calendar_day', ARRAY['mean', 'minimum', 'maximum', 'median'], false, 'Respiratory rate summarized within the personal day.'),
  ('apple_health', 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'recovery.hrv_sdnn', 'recovery', 'Heart-rate variability', 'quantity', 'ms', 'raw_event', 'calendar_day', ARRAY['mean', 'minimum', 'maximum', 'median'], false, 'SDNN heart-rate variability; compare primarily with this person’s own history.'),
  ('apple_health', 'HKQuantityTypeIdentifierRestingHeartRate', 'recovery.resting_heart_rate', 'recovery', 'Resting heart rate', 'quantity', 'count/min', 'raw_event', 'calendar_day', ARRAY['mean', 'minimum', 'maximum', 'latest'], false, 'Resting heart rate; compare primarily with the personal baseline.'),
  ('apple_health', 'HKQuantityTypeIdentifierOxygenSaturation', 'recovery.oxygen_saturation', 'recovery', 'Oxygen saturation', 'quantity', '%', 'raw_event', 'calendar_day', ARRAY['mean', 'minimum', 'p10'], false, 'Peripheral oxygen saturation; consumer wearable readings can be sparse or noisy.'),
  ('apple_health', 'HKQuantityTypeIdentifierHeartRateRecoveryOneMinute', 'recovery.heart_rate_recovery_1m', 'recovery', 'One-minute heart-rate recovery', 'quantity', 'count/min', 'raw_event', 'event_end', ARRAY['latest', 'mean'], false, 'Heart-rate drop one minute after exercise.'),
  ('apple_health', 'HKQuantityTypeIdentifierVO2Max', 'recovery.vo2_max', 'recovery', 'VO2 max', 'quantity', 'mL/kg*min', 'raw_event', 'event_end', ARRAY['latest', 'mean'], false, 'Estimated cardiorespiratory fitness.'),
  ('apple_health', 'HKQuantityTypeIdentifierHeartRate', 'heart.rate', 'heart', 'Heart rate', 'quantity', 'count/min', 'daily_summary', 'calendar_day', ARRAY['average', 'minimum', 'maximum'], false, 'Daily heart-rate statistics produced on device.'),
  ('apple_health', 'HKQuantityTypeIdentifierWalkingHeartRateAverage', 'heart.walking_rate', 'heart', 'Walking heart rate', 'quantity', 'count/min', 'raw_event', 'calendar_day', ARRAY['mean', 'latest'], false, 'Average heart rate recorded while walking.'),
  ('apple_health', 'HKQuantityTypeIdentifierStepCount', 'activity.steps', 'activity', 'Steps', 'quantity', 'count', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Total steps for the personal calendar day.'),
  ('apple_health', 'HKQuantityTypeIdentifierActiveEnergyBurned', 'activity.active_energy', 'activity', 'Active energy', 'quantity', 'kcal', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Active energy burned during the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierBasalEnergyBurned', 'activity.basal_energy', 'activity', 'Basal energy', 'quantity', 'kcal', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Estimated basal energy burned during the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierAppleExerciseTime', 'activity.exercise_time', 'activity', 'Exercise time', 'quantity', 'min', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Minutes credited to the Exercise ring.'),
  ('apple_health', 'HKQuantityTypeIdentifierAppleMoveTime', 'activity.move_time', 'activity', 'Move time', 'quantity', 'min', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Minutes of movement recorded by Apple Health.'),
  ('apple_health', 'HKQuantityTypeIdentifierAppleStandTime', 'activity.stand_time', 'activity', 'Stand time', 'quantity', 'min', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Minutes spent standing.'),
  ('apple_health', 'HKCategoryTypeIdentifierAppleStandHour', 'activity.stand_hour', 'activity', 'Stand-hour result', 'category', 'count', 'raw_event', 'calendar_day', ARRAY['count'], false, 'Hourly stand-goal result; derive successful stand hours per day.'),
  ('apple_health', 'HKQuantityTypeIdentifierDistanceWalkingRunning', 'activity.walk_run_distance', 'activity', 'Walking and running distance', 'quantity', 'm', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Combined walking and running distance.'),
  ('apple_health', 'HKQuantityTypeIdentifierFlightsClimbed', 'activity.flights_climbed', 'activity', 'Flights climbed', 'quantity', 'count', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Flights of stairs climbed.'),
  ('apple_health', 'HKQuantityTypeIdentifierPhysicalEffort', 'activity.physical_effort', 'activity', 'Physical effort', 'quantity', 'kcal/hr*kg', 'daily_summary', 'calendar_day', ARRAY['average', 'minimum', 'maximum'], false, 'Apple physical-effort estimate.'),
  ('apple_health', 'HKWorkoutTypeIdentifier', 'workout.session', 'workout', 'Workout', 'interval', 's', 'raw_event', 'event_start', ARRAY['duration', 'count'], false, 'An intentional workout session with activity type and optional energy or distance metadata.'),
  ('apple_health', 'HKQuantityTypeIdentifierWorkoutEffortScore', 'workout.effort_score', 'workout', 'Workout effort score', 'score', 'score', 'raw_event', 'event_end', ARRAY['mean', 'latest'], false, 'Recorded or estimated workout effort.'),
  ('apple_health', 'HKQuantityTypeIdentifierBodyMass', 'body.weight', 'body', 'Body weight', 'quantity', 'kg', 'raw_event', 'calendar_day', ARRAY['latest'], false, 'Latest body weight recorded on the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierBodyFatPercentage', 'body.fat_percentage', 'body', 'Body-fat percentage', 'quantity', '%', 'raw_event', 'calendar_day', ARRAY['latest'], false, 'Latest body-fat estimate recorded on the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierLeanBodyMass', 'body.lean_mass', 'body', 'Lean body mass', 'quantity', 'kg', 'raw_event', 'calendar_day', ARRAY['latest'], false, 'Latest lean-body-mass estimate recorded on the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierInhalerUsage', 'respiratory.inhaler_usage', 'respiratory', 'Inhaler usage', 'quantity', 'count', 'raw_event', 'event_start', ARRAY['sum', 'count'], false, 'Recorded inhaler puffs; preserve event timing for trigger analysis.'),
  ('apple_health', 'HKQuantityTypeIdentifierPeakExpiratoryFlowRate', 'respiratory.peak_flow', 'respiratory', 'Peak expiratory flow', 'quantity', 'L/min', 'raw_event', 'calendar_day', ARRAY['mean', 'minimum', 'maximum', 'latest'], false, 'Peak expiratory flow reading.'),
  ('apple_health', 'HKQuantityTypeIdentifierForcedExpiratoryVolume1', 'respiratory.fev1', 'respiratory', 'FEV1', 'quantity', 'L', 'raw_event', 'calendar_day', ARRAY['latest', 'mean'], false, 'Forced expiratory volume in one second.'),
  ('apple_health', 'HKQuantityTypeIdentifierForcedVitalCapacity', 'respiratory.fvc', 'respiratory', 'Forced vital capacity', 'quantity', 'L', 'raw_event', 'calendar_day', ARRAY['latest', 'mean'], false, 'Forced vital capacity.'),
  ('apple_health', 'HKQuantityTypeIdentifierDietaryCaffeine', 'nutrition.caffeine', 'nutrition', 'Caffeine', 'quantity', 'mg', 'raw_event', 'event_start', ARRAY['sum', 'count'], false, 'Caffeine intake with event timing retained for sleep and mood analysis.'),
  ('apple_health', 'HKQuantityTypeIdentifierNumberOfAlcoholicBeverages', 'nutrition.alcohol_drinks', 'nutrition', 'Alcoholic drinks', 'quantity', 'count', 'raw_event', 'event_start', ARRAY['sum', 'count'], false, 'Alcoholic drinks recorded during the day.'),
  ('apple_health', 'HKQuantityTypeIdentifierTimeInDaylight', 'environment.daylight_time', 'environment', 'Time in daylight', 'quantity', 'min', 'daily_summary', 'calendar_day', ARRAY['sum'], false, 'Time spent in daylight; relevant to circadian context.'),
  ('apple_health', 'HKQuantityTypeIdentifierEnvironmentalAudioExposure', 'environment.audio_exposure', 'environment', 'Environmental audio exposure', 'quantity', 'dBASPL', 'daily_summary', 'calendar_day', ARRAY['average'], false, 'Equivalent daily environmental sound exposure.'),
  ('apple_health', 'HKQuantityTypeIdentifierHeadphoneAudioExposure', 'environment.headphone_exposure', 'environment', 'Headphone audio exposure', 'quantity', 'dBASPL', 'daily_summary', 'calendar_day', ARRAY['average'], false, 'Equivalent daily headphone sound exposure.')
ON CONFLICT (source_system, source_type_identifier) DO UPDATE SET
  signal_key = EXCLUDED.signal_key,
  domain = EXCLUDED.domain,
  display_name = EXCLUDED.display_name,
  value_kind = EXCLUDED.value_kind,
  canonical_unit = EXCLUDED.canonical_unit,
  storage_grain = EXCLUDED.storage_grain,
  day_assignment = EXCLUDED.day_assignment,
  default_statistics = EXCLUDED.default_statistics,
  is_mood_target = EXCLUDED.is_mood_target,
  ai_description = EXCLUDED.ai_description,
  updated_at = now();
