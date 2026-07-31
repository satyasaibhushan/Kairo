CREATE TABLE IF NOT EXISTS health_changes (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  sample_id text NOT NULL,
  source_event_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  type_identifier text NOT NULL,
  start_date timestamptz,
  end_date timestamptz,
  numeric_value double precision,
  unit text,
  category_value integer,
  source_name text,
  source_bundle_identifier text,
  source_version text,
  device_name text,
  device_model text,
  device_manufacturer text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, sample_id)
);

CREATE INDEX IF NOT EXISTS idx_health_changes_owner_start
  ON health_changes (owner_id, start_date);

CREATE INDEX IF NOT EXISTS idx_health_changes_owner_type_start
  ON health_changes (owner_id, type_identifier, start_date);

CREATE TABLE IF NOT EXISTS health_ingest_batches (
  owner_id text NOT NULL,
  device_id text NOT NULL,
  batch_id text NOT NULL,
  accepted_count integer NOT NULL,
  device_sent_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, device_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_health_batches_owner_received
  ON health_ingest_batches (owner_id, received_at);
