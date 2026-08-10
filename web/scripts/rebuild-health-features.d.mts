import type { NeonQueryFunction } from "@neondatabase/serverless";

export type HealthFeatureSqlClient = Pick<NeonQueryFunction<boolean, boolean>, "query">;

export type HealthFeatureRebuildOptions = {
  sqlClient: HealthFeatureSqlClient;
  ownerId?: string;
  timeZone?: string;
  featureVersion?: string;
  from?: string;
  through?: string;
  chunkDays?: number;
};

export type HealthFeatureRebuildResult = {
  runId: string;
  featureCount: number;
  minimumDate: string;
  maximumDate: string;
};

export function rebuildHealthFeatures(
  options: HealthFeatureRebuildOptions,
): Promise<HealthFeatureRebuildResult>;
