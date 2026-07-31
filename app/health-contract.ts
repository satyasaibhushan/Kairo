export type HealthChangeOperation = "upsert" | "delete";

export type HealthChangeInput = {
  id: string;
  operation: HealthChangeOperation;
  sampleID: string;
  typeIdentifier: string;
  startDate: string | null;
  endDate: string | null;
  numericValue: number | null;
  unit: string | null;
  categoryValue: number | null;
  sourceName: string | null;
  sourceBundleIdentifier: string | null;
  sourceVersion: string | null;
  deviceName: string | null;
  deviceModel: string | null;
  deviceManufacturer: string | null;
  metadata: Record<string, string>;
};

export type HealthBatchInput = {
  batchId: string;
  deviceId: string;
  sentAt: string;
  changes: HealthChangeInput[];
};

const maximumBatchSize = 250;

export function parseHealthBatch(value: unknown): HealthBatchInput {
  const record = objectRecord(value, "batch");
  const changes = record.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > maximumBatchSize) {
    throw new Error(`changes must contain between 1 and ${maximumBatchSize} items`);
  }

  return {
    batchId: requiredString(record.batchId, "batchId", 128),
    deviceId: requiredString(record.deviceId, "deviceId", 128),
    sentAt: isoDate(record.sentAt, "sentAt"),
    changes: changes.map(parseHealthChange),
  };
}

function parseHealthChange(value: unknown): HealthChangeInput {
  const record = objectRecord(value, "change");
  const operation = record.operation;
  if (operation !== "upsert" && operation !== "delete") {
    throw new Error("operation must be upsert or delete");
  }

  return {
    id: requiredString(record.id, "id", 160),
    operation,
    sampleID: requiredString(record.sampleID, "sampleID", 64),
    typeIdentifier: requiredString(record.typeIdentifier, "typeIdentifier", 180),
    startDate: optionalIsoDate(record.startDate, "startDate"),
    endDate: optionalIsoDate(record.endDate, "endDate"),
    numericValue: optionalFiniteNumber(record.numericValue, "numericValue"),
    unit: optionalString(record.unit, "unit", 80),
    categoryValue: optionalInteger(record.categoryValue, "categoryValue"),
    sourceName: optionalString(record.sourceName, "sourceName", 180),
    sourceBundleIdentifier: optionalString(
      record.sourceBundleIdentifier,
      "sourceBundleIdentifier",
      240,
    ),
    sourceVersion: optionalString(record.sourceVersion, "sourceVersion", 80),
    deviceName: optionalString(record.deviceName, "deviceName", 180),
    deviceModel: optionalString(record.deviceModel, "deviceModel", 180),
    deviceManufacturer: optionalString(record.deviceManufacturer, "deviceManufacturer", 180),
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

function optionalInteger(value: unknown, field: string): number | null {
  const result = optionalFiniteNumber(value, field);
  if (result !== null && !Number.isInteger(result)) throw new Error(`${field} must be an integer`);
  return result;
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  const record = objectRecord(value, field);
  const entries = Object.entries(record);
  if (entries.length > 64) throw new Error(`${field} has too many entries`);

  return Object.fromEntries(
    entries.map(([key, entryValue]) => {
      if (key.length > 180 || typeof entryValue !== "string" || entryValue.length > 2_000) {
        throw new Error(`${field} contains an invalid entry`);
      }
      return [key, entryValue];
    }),
  );
}
