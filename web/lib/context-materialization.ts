import type { NeonQueryFunction } from "@neondatabase/serverless";

export async function materializeContextDates(
  sql: NeonQueryFunction<boolean, boolean>,
  ownerId: string,
  timeZone: string,
  from: string,
  through: string,
): Promise<void> {
  const featureVersion = "context-v1";
  await sql`DELETE FROM context_daily_profiles
    WHERE owner_id = ${ownerId} AND profile_version = ${featureVersion}
      AND profile_date BETWEEN ${from}::date AND ${through}::date`;
  await sql`DELETE FROM context_daily_features
    WHERE owner_id = ${ownerId} AND feature_version = ${featureVersion}
      AND feature_date BETWEEN ${from}::date AND ${through}::date`;

  await sql`WITH base AS (
      SELECT
        owner_id,
        (COALESCE(observed_end, observed_start) AT TIME ZONE ${timeZone})::date AS feature_date,
        metric_key,
        source_system,
        numeric_value,
        unit,
        text_value,
        COALESCE(metadata_json->>'aggregation', 'latest') AS aggregation,
        COALESCE(observed_end, observed_start) AS effective_at
      FROM context_current_observations
      WHERE owner_id = ${ownerId}
        AND operation = 'upsert'
        AND observed_start IS NOT NULL
        AND (COALESCE(observed_end, observed_start) AT TIME ZONE ${timeZone})::date
          BETWEEN ${from}::date AND ${through}::date
    ), grouped AS (
      SELECT
        owner_id, feature_date, metric_key,
        CASE
          WHEN BOOL_OR(aggregation = 'sum') THEN SUM(numeric_value)
          WHEN BOOL_OR(aggregation = 'mean') THEN AVG(numeric_value)
          WHEN BOOL_OR(aggregation = 'maximum') THEN MAX(numeric_value)
          ELSE (array_agg(numeric_value ORDER BY effective_at DESC)
            FILTER (WHERE numeric_value IS NOT NULL))[1]
        END AS numeric_value,
        (array_agg(unit ORDER BY effective_at DESC) FILTER (WHERE unit IS NOT NULL))[1] AS unit,
        (array_agg(text_value ORDER BY effective_at DESC)
          FILTER (WHERE text_value IS NOT NULL))[1] AS text_value,
        COUNT(*)::int AS sample_count,
        ARRAY_AGG(DISTINCT source_system ORDER BY source_system) AS source_systems
      FROM base
      GROUP BY owner_id, feature_date, metric_key
    )
    INSERT INTO context_daily_features (
      owner_id, feature_date, feature_key, numeric_value, unit, text_value,
      sample_count, source_systems, quality, feature_version
    )
    SELECT owner_id, feature_date, metric_key, numeric_value, unit, text_value,
           sample_count, source_systems, 'trusted', ${featureVersion}
    FROM grouped`;

  await sql`WITH location_days AS (
      SELECT
        owner_id,
        (COALESCE(observed_end, observed_start) AT TIME ZONE ${timeZone})::date AS feature_date,
        COUNT(*)::double precision AS visit_count,
        COUNT(DISTINCT metadata_json->>'placeCell')::double precision AS distinct_places,
        SUM(EXTRACT(EPOCH FROM (observed_end - observed_start)) / 60.0) AS visited_minutes
      FROM context_current_observations
      WHERE owner_id = ${ownerId}
        AND source_system = 'core_location'
        AND metric_key = 'location.visit'
        AND operation = 'upsert'
        AND observed_start IS NOT NULL
        AND observed_end IS NOT NULL
        AND (observed_end AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${through}::date
      GROUP BY owner_id, feature_date
    ), expanded AS (
      SELECT owner_id, feature_date, feature_key, numeric_value, unit
      FROM location_days
      CROSS JOIN LATERAL (VALUES
        ('location.visit_count', visit_count, 'count'),
        ('location.distinct_places', distinct_places, 'count'),
        ('location.visited_minutes', visited_minutes, 'min')
      ) feature(feature_key, numeric_value, unit)
    )
    INSERT INTO context_daily_features (
      owner_id, feature_date, feature_key, numeric_value, unit,
      sample_count, source_systems, quality, feature_version
    )
    SELECT owner_id, feature_date, feature_key, numeric_value, unit,
           1, ARRAY['core_location'], 'trusted', ${featureVersion}
    FROM expanded
    ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
      numeric_value = EXCLUDED.numeric_value,
      unit = EXCLUDED.unit,
      computed_at = now()`;

  await sql`WITH ordered_visits AS (
      SELECT
        owner_id,
        observed_start AS arrival_at,
        observed_end AS departure_at,
        metadata_json->>'placeCell' AS origin_cell,
        (metadata_json->>'latitude')::double precision AS origin_latitude,
        (metadata_json->>'longitude')::double precision AS origin_longitude,
        LEAD(observed_start) OVER (PARTITION BY owner_id ORDER BY observed_start) AS next_arrival_at,
        LEAD(metadata_json->>'placeCell') OVER (
          PARTITION BY owner_id ORDER BY observed_start
        ) AS destination_cell,
        LEAD((metadata_json->>'latitude')::double precision) OVER (
          PARTITION BY owner_id ORDER BY observed_start
        ) AS destination_latitude,
        LEAD((metadata_json->>'longitude')::double precision) OVER (
          PARTITION BY owner_id ORDER BY observed_start
        ) AS destination_longitude
      FROM context_current_observations
      WHERE owner_id = ${ownerId}
        AND source_system = 'core_location'
        AND metric_key = 'location.visit'
        AND operation = 'upsert'
        AND observed_start IS NOT NULL
        AND observed_end IS NOT NULL
        AND metadata_json->>'latitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
        AND metadata_json->>'longitude' ~ '^-?[0-9]+(\\.[0-9]+)?$'
    ), journeys AS (
      SELECT
        owner_id,
        (departure_at AT TIME ZONE ${timeZone})::date AS feature_date,
        origin_cell || '→' || destination_cell AS route_key,
        EXTRACT(EPOCH FROM (next_arrival_at - departure_at)) / 60.0 AS travel_minutes,
        111.195 * sqrt(
          power(destination_latitude - origin_latitude, 2)
          + power(
            cos(radians((origin_latitude + destination_latitude) / 2.0))
              * (destination_longitude - origin_longitude),
            2
          )
        ) AS travel_distance_km,
        EXTRACT(HOUR FROM departure_at AT TIME ZONE ${timeZone})
          + EXTRACT(MINUTE FROM departure_at AT TIME ZONE ${timeZone}) / 60.0
          AS departure_local_hour
      FROM ordered_visits
      WHERE next_arrival_at IS NOT NULL
        AND destination_cell IS NOT NULL
        AND destination_cell <> origin_cell
        AND next_arrival_at >= departure_at
        AND next_arrival_at - departure_at <= INTERVAL '8 hours'
    ), recurring_routes AS (
      SELECT owner_id, route_key
      FROM journeys
      WHERE feature_date >= ${from}::date - 42
        AND EXTRACT(ISODOW FROM feature_date) BETWEEN 1 AND 5
      GROUP BY owner_id, route_key
      HAVING COUNT(DISTINCT feature_date) >= 3
    ), journey_days AS (
      SELECT
        journeys.owner_id,
        journeys.feature_date,
        SUM(journeys.travel_minutes) AS travel_minutes,
        SUM(journeys.travel_distance_km) AS travel_distance_km,
        MIN(journeys.departure_local_hour) AS first_departure_local_hour,
        SUM(journeys.travel_minutes) FILTER (
          WHERE recurring_routes.route_key IS NOT NULL
        ) AS commute_minutes
      FROM journeys
      LEFT JOIN recurring_routes USING (owner_id, route_key)
      WHERE journeys.feature_date BETWEEN ${from}::date AND ${through}::date
      GROUP BY journeys.owner_id, journeys.feature_date
    ), expanded AS (
      SELECT owner_id, feature_date, feature_key, numeric_value, unit, quality
      FROM journey_days
      CROSS JOIN LATERAL (VALUES
        ('location.travel_minutes', travel_minutes, 'min', 'trusted'),
        ('location.travel_distance_km', travel_distance_km, 'km', 'partial'),
        ('location.first_departure_local_hour', first_departure_local_hour, 'local_hour', 'trusted'),
        ('location.commute_minutes', commute_minutes, 'min', 'partial')
      ) feature(feature_key, numeric_value, unit, quality)
      WHERE numeric_value IS NOT NULL
    )
    INSERT INTO context_daily_features (
      owner_id, feature_date, feature_key, numeric_value, unit,
      sample_count, source_systems, quality, feature_version
    )
    SELECT owner_id, feature_date, feature_key, numeric_value, unit,
           1, ARRAY['core_location'], quality, ${featureVersion}
    FROM expanded
    ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
      numeric_value = EXCLUDED.numeric_value,
      unit = EXCLUDED.unit,
      quality = EXCLUDED.quality,
      computed_at = now()`;

  await sql`WITH departures AS (
      SELECT owner_id, feature_date, numeric_value,
             AVG(numeric_value) OVER (
               PARTITION BY owner_id, EXTRACT(ISODOW FROM feature_date)
               ORDER BY feature_date
               ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING
             ) AS typical_hour,
             COUNT(numeric_value) OVER (
               PARTITION BY owner_id, EXTRACT(ISODOW FROM feature_date)
               ORDER BY feature_date
               ROWS BETWEEN 8 PRECEDING AND 1 PRECEDING
             ) AS baseline_days
      FROM context_daily_features
      WHERE owner_id = ${ownerId}
        AND feature_version = ${featureVersion}
        AND feature_key = 'location.first_departure_local_hour'
        AND feature_date BETWEEN ${from}::date - 70 AND ${through}::date
    )
    INSERT INTO context_daily_features (
      owner_id, feature_date, feature_key, numeric_value, unit,
      sample_count, source_systems, quality, feature_version
    )
    SELECT owner_id, feature_date, 'location.routine_departure_deviation_minutes',
           ABS(numeric_value - typical_hour) * 60.0, 'min', baseline_days,
           ARRAY['core_location'], 'partial', ${featureVersion}
    FROM departures
    WHERE feature_date BETWEEN ${from}::date AND ${through}::date
      AND baseline_days >= 3
      AND typical_hour IS NOT NULL
    ON CONFLICT (owner_id, feature_date, feature_key, feature_version) DO UPDATE SET
      numeric_value = EXCLUDED.numeric_value,
      sample_count = EXCLUDED.sample_count,
      computed_at = now()`;

  await sql`INSERT INTO context_daily_profiles (
      owner_id, profile_date, profile_json, profile_version
    )
    SELECT
      owner_id,
      feature_date,
      jsonb_build_object(
        'date', feature_date,
        'timeZone', ${timeZone},
        'featureVersion', ${featureVersion},
        'features', jsonb_object_agg(
          feature_key,
          jsonb_strip_nulls(jsonb_build_object(
            'value', numeric_value,
            'text', text_value,
            'unit', unit,
            'quality', quality,
            'samples', sample_count
          )) ORDER BY feature_key
        )
      ),
      ${featureVersion}
    FROM context_daily_features
    WHERE owner_id = ${ownerId}
      AND feature_version = ${featureVersion}
      AND feature_date BETWEEN ${from}::date AND ${through}::date
    GROUP BY owner_id, feature_date`;
}
