export type DailyFeatureValue = {
  value?: number;
  text?: string;
  unit?: string;
  quality: "observed" | "derived" | "partial" | "insufficient" | "suspect";
  coverage?: number;
  samples: number;
};

export type DailyHealthProfile = {
  date: string;
  timeZone: string;
  featureVersion: string;
  features: Record<string, DailyFeatureValue>;
};

export type MoodEvidence = {
  observedAt: string;
  valence: number;
  kind: string | null;
  classification: string | null;
  labels: string[];
  associations: string[];
  sourceName: string | null;
};

export type FactorScore = {
  featureKey: string;
  lagDays: number;
  horizonDays: number;
  sampleSize: number;
  coverage: number;
  direction: -1 | 0 | 1;
  standardizedEffect: number | null;
  predictiveGain: number | null;
  stability: number | null;
  kScore: number | null;
  modelVersion: string;
};

export type IntelligenceEvidence = {
  date: string;
  profile: DailyHealthProfile | null;
  domainCoverage: Record<string, { features: number; trusted: number }>;
  mood: MoodEvidence[];
  factors: FactorScore[];
  caveats: string[];
};

export type TrendPoint = {
  date: string;
  value: number;
  unit: string | null;
  quality: DailyFeatureValue["quality"];
  coverage: number | null;
};

export type SignalDefinition = {
  sourceTypeIdentifier: string;
  signalKey: string;
  domain: string;
  displayName: string;
  valueKind: string;
  canonicalUnit: string | null;
  storageGrain: string;
  dayAssignment: string;
  defaultStatistics: string[];
  isMoodTarget: boolean;
  description: string;
};
