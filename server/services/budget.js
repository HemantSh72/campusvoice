/**
 * Per-model daily quota and circuit-breaker state.
 */
import config from '../config.js';
import { getModelState, incrementModelCount, recordModelQuotaFailure } from '../db.js';

const utcDate = () => new Date().toISOString().slice(0, 10);

export function capForModel(model) {
  return model.toLowerCase().includes('gemma') ? config.gemmaDailyCap : config.llmDailyCapPerModel;
}

export async function modelAvailability(model, now = Date.now()) {
  const state = await getModelState(model);
  const date = utcDate();
  const count = state?.dailyDate === date ? state.dailyCount || 0 : 0;
  const blockedUntil = state?.dailyDate === date ? state.blockedUntil || 0 : 0;
  const blockedForDay = state?.dailyDate === date && Boolean(state.blockedForDay);
  const cap = capForModel(model);
  if (blockedForDay || blockedUntil > now) return { available: false, reason: blockedForDay ? 'quota breaker tripped for today' : 'temporarily unavailable', count, cap, blockedUntil };
  if (cap <= 0 || count >= cap) return { available: false, reason: 'daily cap reached', count, cap, blockedUntil: 0 };
  return { available: true, reason: 'available', count, cap, blockedUntil: 0 };
}

export async function recordModelSuccess(model) {
  return incrementModelCount(model, utcDate());
}

export async function recordQuotaFailure(model) {
  return recordModelQuotaFailure(model);
}

export async function getModelChainHealth(models) {
  const result = {};
  for (const model of models) result[model] = await modelAvailability(model);
  return result;
}
