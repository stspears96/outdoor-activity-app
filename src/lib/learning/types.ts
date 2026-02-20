import type { ActivityId, Conditions } from "@/lib/types";

export type { ActivityId, Conditions };

export type AB = { alpha: number; beta: number };

export type ActivityBetaParams = {
  temp: Record<string, AB>;
  wind: Record<string, AB>;
  windDir: Record<string, AB>;
  rain: Record<string, AB>;
  cloud: Record<string, AB>;
  humidity: Record<string, AB>;
  recentRain: Record<string, AB>;
  aqi: Record<string, AB>;
  lightning: Record<string, AB>;
  precipType: Record<string, AB>;
  precipIntensity: Record<string, AB>;
  visibility: Record<string, AB>;
  windRain: Record<string, AB>;
  tempWind: Record<string, AB>;
  daylight: Record<string, AB>;
  // Surf-specific — optional so old localStorage data stays compatible
  swellHeight?: Record<string, AB>;
  swellPeakPeriod?: Record<string, AB>;
  swellAvgPeriod?: Record<string, AB>;
  swellPeriodDiff?: Record<string, AB>;
  windOffshore?: Record<string, AB>;
};

export type BetaParams = Record<ActivityId, ActivityBetaParams>;

export type LinearParams = {
  weights: number[]; // 20 values
  updateCount: number;
};

export type GpObservation = {
  features: number[]; // 20 values
  rating: number;     // 0–1
  activityId: ActivityId;
};

export type GpConfig = {
  observations: GpObservation[];
  lengthScales: number[]; // 20 values
};

export type Observation = {
  id: string;
  timestamp: number;
  activityId: ActivityId;
  conditions: Conditions;
  userRating: number; // 0–100
};

export type PendingSession = {
  timestamp: number;
  conditions: Conditions;
  top3Activities: ActivityId[];
};

export type LearningState = {
  version: 1;
  observations: Observation[];
  betaParams: BetaParams;
  linearParams: Record<ActivityId, LinearParams>;
  gpConfig: GpConfig;
  pendingSession: PendingSession | null;
};
