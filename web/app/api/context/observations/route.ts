import { after, NextResponse } from "next/server";
import { parseContextBatch } from "../../../context-contract";
import { getDatabase } from "../../../../lib/database";
import { materializeContextDates } from "../../../../lib/context-materialization";
import { enrichCurrentWeather } from "../../../../lib/weather-enrichment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const maximumBodyBytes = 750_000;

export async function POST(request: Request) {
  const expectedToken = process.env.KAIRO_INGEST_TOKEN;
  if (!expectedToken || !process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Context ingestion is not configured" }, { status: 503 });
  }
  if (!(await isAuthorized(request, expectedToken))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return NextResponse.json({ error: "Batch is too large" }, { status: 413 });
    }
    const batch = parseContextBatch(JSON.parse(body) as unknown);
    const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
    const timeZone = process.env.KAIRO_TIME_ZONE ?? "Asia/Kolkata";
    const receivedAt = new Date().toISOString();
    const records = batch.observations.map((observation) => ({
      source_event_id: observation.id,
      operation: observation.operation,
      source_system: observation.sourceSystem,
      observation_id: observation.observationID,
      metric_key: observation.metricKey,
      observed_start: observation.observedStart,
      observed_end: observation.observedEnd,
      numeric_value: observation.numericValue,
      unit: observation.unit,
      text_value: observation.textValue,
      metadata_json: observation.metadata,
    }));
    const sql = getDatabase();

    await sql`WITH inserted_batch AS (
        INSERT INTO context_ingest_batches (
          owner_id, device_id, batch_id, accepted_count, device_sent_at, received_at
        ) VALUES (
          ${ownerId}, ${batch.deviceId}, ${batch.batchId}, ${records.length}, ${batch.sentAt}, ${receivedAt}
        )
        ON CONFLICT (owner_id, device_id, batch_id) DO NOTHING
        RETURNING 1
      ), incoming AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS entry(
          source_event_id text, operation text, source_system text, observation_id text,
          metric_key text, observed_start timestamptz, observed_end timestamptz,
          numeric_value double precision, unit text, text_value text, metadata_json jsonb
        )
      )
      INSERT INTO context_observations (
        owner_id, device_id, source_system, observation_id, operation, metric_key,
        observed_start, observed_end, numeric_value, unit, text_value, metadata_json, received_at
      )
      SELECT ${ownerId}, ${batch.deviceId}, source_system, observation_id, operation, metric_key,
             observed_start, observed_end, numeric_value, unit, text_value, metadata_json, ${receivedAt}
      FROM incoming
      WHERE EXISTS (SELECT 1 FROM inserted_batch)
      ON CONFLICT (owner_id, device_id, source_system, observation_id) DO UPDATE SET
        operation = EXCLUDED.operation,
        metric_key = EXCLUDED.metric_key,
        observed_start = EXCLUDED.observed_start,
        observed_end = EXCLUDED.observed_end,
        numeric_value = EXCLUDED.numeric_value,
        unit = EXCLUDED.unit,
        text_value = EXCLUDED.text_value,
        metadata_json = EXCLUDED.metadata_json,
        received_at = EXCLUDED.received_at`;

    const acceptedResult = await sql`SELECT accepted_count AS "acceptedCount"
      FROM context_ingest_batches
      WHERE owner_id = ${ownerId} AND device_id = ${batch.deviceId} AND batch_id = ${batch.batchId}`;
    const acceptedRows = acceptedResult as unknown as Array<{ acceptedCount: number }>;
    if (acceptedRows[0]?.acceptedCount !== records.length) {
      return NextResponse.json({ error: "Batch identifier collision" }, { status: 409 });
    }

    const dates = batch.observations
      .flatMap((observation) => [observation.observedStart, observation.observedEnd])
      .filter((value): value is string => value !== null)
      .map((value) => localDate(value, timeZone));
    if (dates.length > 0) {
      const from = dates.reduce((minimum, value) => value < minimum ? value : minimum);
      const through = dates.reduce((maximum, value) => value > maximum ? value : maximum);
      after(async () => {
        try {
          let weatherAt: string | null = null;
          try {
            weatherAt = await enrichCurrentWeather(sql, ownerId, batch.observations);
          } catch (error) {
            console.error("Weather enrichment failed", error);
          }
          const weatherDate = weatherAt ? localDate(weatherAt, timeZone) : null;
          await materializeContextDates(
            sql,
            ownerId,
            timeZone,
            weatherDate && weatherDate < from ? weatherDate : from,
            weatherDate && weatherDate > through ? weatherDate : through,
          );
        } catch (error) {
          console.error("Context materialization failed", error);
        }
      });
    }

    return NextResponse.json({
      batchId: batch.batchId,
      accepted: records.length,
      acknowledgedIds: batch.observations.map((observation) => observation.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid context batch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function isAuthorized(request: Request, expectedToken: string): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length);
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(suppliedToken)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedToken)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = suppliedBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.min(suppliedBytes.length, expectedBytes.length); index += 1) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}
