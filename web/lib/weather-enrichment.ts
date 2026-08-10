import type { NeonQueryFunction } from "@neondatabase/serverless";

type LocationObservation = {
  metricKey: string;
  observedStart: string | null;
  metadata: Record<string, string>;
};

type OpenMeteoCurrent = {
  time?: string;
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  uv_index?: number;
  us_aqi?: number;
  pm2_5?: number;
};

type WeatherMetric = {
  key: string;
  value: number | undefined;
  unit: string;
  aggregation: "latest" | "sum" | "maximum";
};

export async function enrichCurrentWeather(
  sql: NeonQueryFunction<boolean, boolean>,
  ownerId: string,
  observations: LocationObservation[],
): Promise<string | null> {
  const location = [...observations]
    .filter((observation) => observation.metricKey.startsWith("location."))
    .sort((left, right) => (right.observedStart ?? "").localeCompare(left.observedStart ?? ""))
    .find((observation) => validCoordinate(observation.metadata));
  if (!location?.observedStart) return null;

  const observedAt = new Date(location.observedStart);
  if (!Number.isFinite(observedAt.getTime()) || Date.now() - observedAt.getTime() > 86_400_000) {
    return null;
  }

  const latitude = Number(location.metadata.latitude);
  const longitude = Number(location.metadata.longitude);
  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "uv_index",
    ].join(","),
    timezone: "UTC",
  }).toString();
  const airUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  airUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "us_aqi,pm2_5",
    timezone: "UTC",
  }).toString();

  const [forecastResponse, airResponse] = await Promise.all([
    fetch(forecastUrl, { signal: AbortSignal.timeout(8_000) }),
    fetch(airUrl, { signal: AbortSignal.timeout(8_000) }),
  ]);
  if (!forecastResponse.ok || !airResponse.ok) {
    throw new Error(`Open-Meteo returned ${forecastResponse.status}/${airResponse.status}`);
  }
  const forecast = (await forecastResponse.json()) as { current?: OpenMeteoCurrent };
  const air = (await airResponse.json()) as { current?: OpenMeteoCurrent };
  const current = { ...forecast.current, ...air.current };
  if (!current.time) return null;

  const currentAt = new Date(`${current.time}Z`);
  if (!Number.isFinite(currentAt.getTime())) return null;
  const hourKey = currentAt.toISOString().slice(0, 13);
  const placeCell = location.metadata.placeCell ?? `${latitude},${longitude}`;
  const candidates: WeatherMetric[] = [
    { key: "environment.temperature_c", value: current.temperature_2m, unit: "degC", aggregation: "latest" },
    { key: "environment.relative_humidity_percent", value: current.relative_humidity_2m, unit: "%", aggregation: "latest" },
    { key: "environment.apparent_temperature_c", value: current.apparent_temperature, unit: "degC", aggregation: "latest" },
    { key: "environment.precipitation_mm", value: current.precipitation, unit: "mm", aggregation: "sum" },
    { key: "environment.uv_index", value: current.uv_index, unit: "index", aggregation: "maximum" },
    { key: "environment.us_aqi", value: current.us_aqi, unit: "index", aggregation: "latest" },
    { key: "environment.pm2_5", value: current.pm2_5, unit: "ug/m3", aggregation: "latest" },
  ];
  const metrics = candidates.filter((metric) => Number.isFinite(metric.value));
  if (metrics.length === 0) return null;

  const rows = metrics.map((metric) => ({
    observation_id: `${hourKey}:${placeCell}:${metric.key}`,
    metric_key: metric.key,
    observed_start: currentAt.toISOString(),
    numeric_value: metric.value,
    unit: metric.unit,
    metadata_json: {
      aggregation: metric.aggregation,
      provider: "open_meteo",
      placeCell,
      coordinatePrecision: location.metadata.coordinatePrecision ?? "approximately_1km",
    },
  }));
  await sql`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS entry(
        observation_id text, metric_key text, observed_start timestamptz,
        numeric_value double precision, unit text, metadata_json jsonb
      )
    )
    INSERT INTO context_observations (
      owner_id, device_id, source_system, observation_id, operation, metric_key,
      observed_start, numeric_value, unit, metadata_json
    )
    SELECT ${ownerId}, 'server-weather', 'open_meteo', observation_id, 'upsert', metric_key,
           observed_start, numeric_value, unit, metadata_json
    FROM incoming
    ON CONFLICT (owner_id, device_id, source_system, observation_id) DO UPDATE SET
      numeric_value = EXCLUDED.numeric_value,
      unit = EXCLUDED.unit,
      metadata_json = EXCLUDED.metadata_json,
      received_at = now()`;
  return currentAt.toISOString();
}

function validCoordinate(metadata: Record<string, string>): boolean {
  const latitude = Number(metadata.latitude);
  const longitude = Number(metadata.longitude);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}
