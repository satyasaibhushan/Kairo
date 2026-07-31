export type HealthSummary = {
  totalSamples: number;
  trackedTypes: number;
  batchesReceived: number;
  latestReceivedAt: string | null;
  latest: Array<{
    typeIdentifier: string;
    numericValue: number | null;
    unit: string | null;
    categoryValue: number | null;
    startDate: string | null;
    sourceName: string | null;
  }>;
  days: Array<{ day: string; value: number }>;
};

export const emptyHealthSummary: HealthSummary = {
  totalSamples: 0,
  trackedTypes: 0,
  batchesReceived: 0,
  latestReceivedAt: null,
  latest: [],
  days: [],
};
