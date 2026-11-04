import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.GEMINI_API_KEY = '';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;

let resetMemStore;
let reserveModelCall;
let modelIsBlocked;
let recordModelQuotaFailure;
let getModelChainState;

beforeEach(async () => {
  ({ resetMemStore } = await import('../server/db.js'));
  ({ reserveModelCall, modelIsBlocked, recordModelQuotaFailure, getModelChainState } = await import('../server/services/llmState.js'));
  resetMemStore();
});

describe('per-model LLM quota and circuit breaker', () => {
  test('caps a model at its configured request count', async () => {
    assert.equal(await reserveModelCall('fake-flash-lite', 2), true);
    assert.equal(await reserveModelCall('fake-flash-lite', 2), true);
    assert.equal(await reserveModelCall('fake-flash-lite', 2), false);
  });
  test('trips after three quota failures within ten minutes', async () => {
    await recordModelQuotaFailure('fake-flash-lite');
    assert.equal(await modelIsBlocked('fake-flash-lite'), true);
    await recordModelQuotaFailure('fake-flash-lite');
    await recordModelQuotaFailure('fake-flash-lite');
    assert.equal(await modelIsBlocked('fake-flash-lite'), true);
  });
  test('health reports capped model state', async () => {
    await reserveModelCall('cap-health-model', 1);
    const [state] = await getModelChainState(['cap-health-model'], { 'cap-health-model': 1 });
    assert.equal(state.status, 'capped');
    assert.equal(state.used, 1);
  });
});
