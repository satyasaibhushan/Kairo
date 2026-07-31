import "server-only";

import { getDatabase } from "../../lib/database";
import type { HealthSummary } from "./health-summary";

type CountRow = { value: string | number };
type LatestRow = {
  typeIdentifier: string;
  numericValue: number | null;
  unit: string | null;
  categoryValue: number | null;
  startDate: string | null;
  sourceName: string | null;
};
type DayRow = { day: string; value: string | number };

export async function loadHealthSummary(): Promise<HealthSummary> {
  const sql = getDatabase();
  const ownerId = process.env.KAIRO_OWNER_ID ?? "primary";

  const [samplesResult, typesResult, batchesResult, receivedResult, latestResult, daysResult] =
    await Promise.all([
      sql`SELECT COUNT(*) AS value FROM health_changes WHERE owner_id = ${ownerId} AND operation = 'upsert'`,
      sql`SELECT COUNT(DISTINCT type_identifier) AS value FROM health_changes WHERE owner_id = ${ownerId} AND operation = 'upsert'`,
      sql`SELECT COUNT(*) AS value FROM health_ingest_batches WHERE owner_id = ${ownerId}`,
      sql`SELECT MAX(received_at)::text AS value FROM health_ingest_batches WHERE owner_id = ${ownerId}`,
      sql`SELECT
            type_identifier AS "typeIdentifier",
            numeric_value AS "numericValue",
            unit,
            category_value AS "categoryValue",
            start_date::text AS "startDate",
            source_name AS "sourceName"
          FROM health_changes
          WHERE owner_id = ${ownerId} AND operation = 'upsert'
          ORDER BY COALESCE(start_date, received_at) DESC
          LIMIT 12`,
      sql`SELECT start_date::date::text AS day, COUNT(*) AS value
          FROM health_changes
          WHERE owner_id = ${ownerId} AND operation = 'upsert' AND start_date IS NOT NULL
          GROUP BY start_date::date
          ORDER BY day DESC
          LIMIT 14`,
    ]);

  const samples = samplesResult as unknown as CountRow[];
  const types = typesResult as unknown as CountRow[];
  const batches = batchesResult as unknown as CountRow[];
  const received = receivedResult as unknown as Array<{ value: string | null }>;
  const latest = latestResult as unknown as LatestRow[];
  const days = daysResult as unknown as DayRow[];

  return {
    totalSamples: Number(samples[0]?.value ?? 0),
    trackedTypes: Number(types[0]?.value ?? 0),
    batchesReceived: Number(batches[0]?.value ?? 0),
    latestReceivedAt: received[0]?.value ?? null,
    latest,
    days: days.reverse().map((day) => ({ day: day.day, value: Number(day.value) })),
  };
}
