CREATE TABLE IF NOT EXISTS context_ingest_batches (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  batch_id text NOT NULL,
  accepted_count integer NOT NULL CHECK (accepted_count >= 0),
  device_sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, batch_id)
);

CREATE TABLE IF NOT EXISTS context_observations (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  source_system text NOT NULL,
  observation_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  metric_key text NOT NULL,
  observed_start timestamptz,
  observed_end timestamptz,
  numeric_value double precision,
  unit text,
  text_value text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, source_system, observation_id)
);

CREATE INDEX IF NOT EXISTS context_observations_owner_time_idx
  ON context_observations (owner_id, observed_start DESC);

CREATE INDEX IF NOT EXISTS context_observations_owner_metric_idx
  ON context_observations (owner_id, metric_key, observed_start DESC);

CREATE OR REPLACE VIEW context_current_observations AS
SELECT owner_id, device_id, source_system, observation_id, operation, metric_key,
       observed_start, observed_end, numeric_value, unit, text_value,
       metadata_json, received_at
FROM (
  SELECT observations.*,
         ROW_NUMBER() OVER (
           PARTITION BY owner_id, source_system, observation_id
           ORDER BY received_at DESC, device_id DESC
         ) AS version_rank
  FROM context_observations observations
) ranked
WHERE version_rank = 1;

CREATE TABLE IF NOT EXISTS context_daily_features (
  owner_id text NOT NULL,
  feature_date date NOT NULL,
  feature_key text NOT NULL,
  numeric_value double precision,
  unit text,
  text_value text,
  sample_count integer NOT NULL DEFAULT 0,
  source_systems text[] NOT NULL DEFAULT ARRAY[]::text[],
  quality text NOT NULL DEFAULT 'trusted' CHECK (quality IN ('trusted', 'partial', 'suspect')),
  feature_version text NOT NULL DEFAULT 'context-v1',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, feature_date, feature_key, feature_version)
);

CREATE TABLE IF NOT EXISTS context_daily_profiles (
  owner_id text NOT NULL,
  profile_date date NOT NULL,
  profile_json jsonb NOT NULL,
  profile_version text NOT NULL DEFAULT 'context-v1',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, profile_date, profile_version)
);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  owner_id text PRIMARY KEY,
  encrypted_refresh_token text,
  sync_token text,
  token_updated_at timestamptz,
  last_synced_at timestamptz,
  last_error text
);
