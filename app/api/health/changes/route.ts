import { NextResponse } from "next/server";
import { getDatabase } from "../../../../lib/database";
import { parseHealthBatch } from "../../../health-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 1_000_000;

export async function POST(request: Request) {
  const expectedToken = process.env.KAIRO_INGEST_TOKEN;
  if (!expectedToken || !process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Health ingestion is not configured" }, { status: 503 });
  }

  if (!(await isAuthorized(request, expectedToken))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBodyBytes) {
    return NextResponse.json({ error: "Batch is too large" }, { status: 413 });
  }

  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumBodyBytes) {
      return NextResponse.json({ error: "Batch is too large" }, { status: 413 });
    }

    const batch = parseHealthBatch(JSON.parse(body) as unknown);
    const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";
    const receivedAt = new Date().toISOString();
    const records = batch.changes.map((change) => ({
      sample_id: change.sampleID,
      source_event_id: change.id,
      operation: change.operation,
      type_identifier: change.typeIdentifier,
      start_date: change.startDate,
      end_date: change.endDate,
      numeric_value: change.numericValue,
      unit: change.unit,
      category_value: change.categoryValue,
      source_name: change.sourceName,
      source_bundle_identifier: change.sourceBundleIdentifier,
      source_version: change.sourceVersion,
      device_name: change.deviceName,
      device_model: change.deviceModel,
      device_manufacturer: change.deviceManufacturer,
      metadata_json: change.metadata,
    }));

    const sql = getDatabase();
    await sql`WITH inserted_batch AS (
        INSERT INTO health_ingest_batches
          (owner_id, device_id, batch_id, accepted_count, device_sent_at, received_at)
        VALUES
          (${ownerId}, ${batch.deviceId}, ${batch.batchId}, ${batch.changes.length}, ${batch.sentAt}, ${receivedAt})
        ON CONFLICT (owner_id, device_id, batch_id) DO NOTHING
        RETURNING 1
      ), incoming AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS entry(
          sample_id text,
          source_event_id text,
          operation text,
          type_identifier text,
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
          metadata_json jsonb
        )
      )
      INSERT INTO health_changes (
        owner_id, device_id, sample_id, source_event_id, operation,
        type_identifier, start_date, end_date, numeric_value, unit,
        category_value, source_name, source_bundle_identifier, source_version,
        device_name, device_model, device_manufacturer, metadata_json, received_at
      )
      SELECT
        ${ownerId}, ${batch.deviceId}, incoming.sample_id, incoming.source_event_id,
        incoming.operation, incoming.type_identifier, incoming.start_date, incoming.end_date,
        incoming.numeric_value, incoming.unit, incoming.category_value, incoming.source_name,
        incoming.source_bundle_identifier, incoming.source_version, incoming.device_name,
        incoming.device_model, incoming.device_manufacturer, incoming.metadata_json, ${receivedAt}
      FROM incoming
      WHERE EXISTS (SELECT 1 FROM inserted_batch)
      ON CONFLICT (owner_id, device_id, sample_id) DO UPDATE SET
        source_event_id = EXCLUDED.source_event_id,
        operation = EXCLUDED.operation,
        type_identifier = EXCLUDED.type_identifier,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        numeric_value = EXCLUDED.numeric_value,
        unit = EXCLUDED.unit,
        category_value = EXCLUDED.category_value,
        source_name = EXCLUDED.source_name,
        source_bundle_identifier = EXCLUDED.source_bundle_identifier,
        source_version = EXCLUDED.source_version,
        device_name = EXCLUDED.device_name,
        device_model = EXCLUDED.device_model,
        device_manufacturer = EXCLUDED.device_manufacturer,
        metadata_json = EXCLUDED.metadata_json,
        received_at = EXCLUDED.received_at`;

    const acceptedResult = await sql`SELECT accepted_count AS "acceptedCount"
      FROM health_ingest_batches
      WHERE owner_id = ${ownerId} AND device_id = ${batch.deviceId} AND batch_id = ${batch.batchId}`;
    const acceptedRows = acceptedResult as unknown as Array<{ acceptedCount: number }>;
    const accepted = acceptedRows[0]?.acceptedCount;
    if (accepted !== batch.changes.length) {
      return NextResponse.json({ error: "Batch identifier collision" }, { status: 409 });
    }

    return NextResponse.json({
      batchId: batch.batchId,
      accepted,
      acknowledgedIds: batch.changes.map((change) => change.id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid health batch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
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
