export type ContextObservationOperation = "upsert" | "delete";

export type ContextObservationInput = {
  id: string;
  operation: ContextObservationOperation;
  sourceSystem: string;
  observationID: string;
  metricKey: string;
  observedStart: string | null;
  observedEnd: string | null;
  numericValue: number | null;
  unit: string | null;
  textValue: string | null;
  metadata: Record<string, string>;
};

export type ContextBatchInput = {
  batchId: string;
  deviceId: string;
  sentAt: string;
  observations: ContextObservationInput[];
};

const maximumBatchSize = 250;

export function parseContextBatch(value: unknown): ContextBatchInput {
  const record = objectRecord(value, "batch");
  if (!Array.isArray(record.observations)
      || record.observations.length === 0
      || record.observations.length > maximumBatchSize) {
    throw new Error(`observations must contain between 1 and ${maximumBatchSize} items`);
  }
  return {
    batchId: requiredString(record.batchId, "batchId", 128),
    deviceId: requiredString(record.deviceId, "deviceId", 128),
    sentAt: isoDate(record.sentAt, "sentAt"),
    observations: record.observations.map(parseObservation),
  };
}

function parseObservation(value: unknown): ContextObservationInput {
  const record = objectRecord(value, "observation");
  if (record.operation !== "upsert" && record.operation !== "delete") {
    throw new Error("operation must be upsert or delete");
  }
  return {
    id: requiredString(record.id, "id", 180),
    operation: record.operation,
    sourceSystem: requiredString(record.sourceSystem, "sourceSystem", 80),
    observationID: requiredString(record.observationID, "observationID", 180),
    metricKey: requiredString(record.metricKey, "metricKey", 160),
    observedStart: optionalIsoDate(record.observedStart, "observedStart"),
    observedEnd: optionalIsoDate(record.observedEnd, "observedEnd"),
    numericValue: optionalFiniteNumber(record.numericValue, "numericValue"),
    unit: optionalString(record.unit, "unit", 40),
    textValue: optionalString(record.textValue, "textValue", 500),
    metadata: stringRecord(record.metadata, "metadata"),
  };
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${field} must be a non-empty string up to ${maximumLength} characters`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maximumLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`${field} must be null or a string up to ${maximumLength} characters`);
  }
  return value;
}

function isoDate(value: unknown, field: string): string {
  const result = requiredString(value, field, 40);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO-8601 date`);
  return result;
}

function optionalIsoDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return isoDate(value, field);
}

function optionalFiniteNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be null or a finite number`);
  }
  return value;
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  const record = objectRecord(value, field);
  const entries = Object.entries(record);
  if (entries.length > 32) throw new Error(`${field} has too many entries`);
  return Object.fromEntries(entries.map(([key, entryValue]) => {
    if (key.length > 120 || typeof entryValue !== "string" || entryValue.length > 1_000) {
      throw new Error(`${field} contains an invalid entry`);
    }
    return [key, entryValue];
  }));
}
