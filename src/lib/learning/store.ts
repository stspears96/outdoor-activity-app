import type { ActivityId, Conditions } from "@/lib/types";
import type { LearningState, Observation, PendingSession } from "./types";
import { initBetaParams, updateBeta } from "./betaModel";
import { initAllLinearParams, updateLinear } from "./linearModel";
import { initGpConfig, addGpObservation } from "./gpModel";
import { predictBeta } from "./betaModel";

const STORAGE_KEY = "outdoor-app-learning";
const FEEDBACK_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

const ACTIVITY_IDS: ActivityId[] = ["walk", "run", "hike", "bike", "mtb", "picnic", "cafe", "surf"];

// ─── Default / initial state ──────────────────────────────────────────────────

export function defaultState(): LearningState {
  return {
    version: 1,
    observations: [],
    betaParams: initBetaParams(),
    linearParams: initAllLinearParams(ACTIVITY_IDS),
    gpConfig: initGpConfig(),
    pendingSession: null,
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export function loadState(): LearningState {
  if (typeof window === "undefined") return defaultState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const state = defaultState();
      saveState(state);
      return state;
    }
    const parsed = JSON.parse(raw) as LearningState;
    // Version migration placeholder
    if (parsed.version !== 1) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

export function saveState(state: LearningState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota exceeded or other error — silently skip
  }
}

// ─── Observations ─────────────────────────────────────────────────────────────

export function addObservation(
  state: LearningState,
  activityId: ActivityId,
  conditions: Conditions,
  userRating: number // 0–100
): LearningState {
  const rating01 = userRating / 100;

  const obs: Observation = {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    timestamp: Date.now(),
    activityId,
    conditions,
    userRating,
  };

  // Update Beta model (mutates betaParams in place — works on the cloned state)
  updateBeta(state.betaParams, activityId, conditions, rating01);

  // Update linear model
  const linParams = state.linearParams[activityId];
  if (linParams) updateLinear(linParams, conditions, rating01);

  // Update GP model
  addGpObservation(state.gpConfig, activityId, conditions, rating01);

  return {
    ...state,
    observations: [...state.observations, obs],
  };
}

// ─── Pending session ──────────────────────────────────────────────────────────

export function setPendingSession(
  state: LearningState,
  session: PendingSession
): LearningState {
  return { ...state, pendingSession: session };
}

export function clearPendingSession(state: LearningState): LearningState {
  return { ...state, pendingSession: null };
}

export function shouldShowFeedback(state: LearningState): boolean {
  if (!state.pendingSession) return false;
  return Date.now() - state.pendingSession.timestamp >= FEEDBACK_DELAY_MS;
}

// ─── Score blending ───────────────────────────────────────────────────────────

export function activityObsCount(state: LearningState, activityId: ActivityId): number {
  return state.observations.filter(o => o.activityId === activityId).length;
}

export function blendScore(
  serverScore: number,
  betaScore: number,
  obsCount: number
): number {
  const w = Math.min(0.8, obsCount / 20);
  return Math.round((1 - w) * serverScore + w * betaScore);
}

export function getBlendedScore(
  state: LearningState,
  activityId: ActivityId,
  serverScore: number,
  conditions: Conditions
): number {
  const obsCount = activityObsCount(state, activityId);
  const betaScore = predictBeta(state.betaParams, activityId, conditions) * 100;
  return blendScore(serverScore, betaScore, obsCount);
}
