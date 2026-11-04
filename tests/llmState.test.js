import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = '';
process.env.GEMINI_API_KEY = '';
process.env.NODE_ENV = 'test';

let resetMemStore;
let reserveModelCall;
let modelIsBlocked;
let recordModelQuotaFailure;
let parseWithLLM;
let parseModelOutput;

beforeEach(async () => {
  ({ resetMemStore } = await import('../server/db.js'));
  ({ reserveModelCall, modelIsBlocked, recordModelQuotaFailure } = await import('../server/services/llmState.js'));
  ({ parseWithLLM, parseModelOutput } = await import('../server/services/llm.js'));
  resetMemStore();
});

describe('per-model LLM quota', () => {
  test('caps a model at its configured request count', async () => {
    assert.equal(await reserveModelCall('fake-flash-lite', 2), true);
    assert.equal(await reserveModelCall('fake-flash-lite', 2), true);
    assert.equal(await reserveModelCall('fake-flash-lite', 2), false);
  });
  test('trips after three quota failures in ten minutes', async () => {
    await recordModelQuotaFailure('fake-flash-lite');
    assert.equal(await modelIsBlocked('fake-flash-lite'), true);
    await recordModelQuotaFailure('fake-flash-lite');
    await recordModelQuotaFailure('fake-flash-lite');
    assert.equal(await modelIsBlocked('fake-flash-lite'), true);
  });
});

describe('Addendum 2 parsing', () => {
  test('uses rules-followup for a short location answer', async () => {
    const result = await parseWithLLM('Hostel block B', { summary: 'WiFi is not working', category: 'it', priority: 'medium' });
    assert.equal(result.parsedBy, 'rules-followup');
    assert.equal(result.draft.location, 'Hostel block B');
  });
  test('defaults after two failed location follow-ups', async () => {
    const first = await parseWithLLM('idk', { summary: 'WiFi is not working', category: 'it', followUpCount: 0 });
    assert.equal(first.awaiting, true);
    const second = await parseWithLLM('dunno', first.draft);
    assert.equal(second.draft.location, 'Not specified');
  });
  test('leniently extracts a JSON object from Gemma output', () => {
    const parsed = parseModelOutput('Here is the result:\n{"intent":"report_issue","draft":{"summary":"WiFi is down","location":"Block B","category":"it","priority":"high"},"ticketNumber":null}\nThanks.', 'gemma-4-26b');
    assert.equal(parsed.intent, 'report_issue');
    assert.equal(parsed.draft.location, 'Block B');
    assert.equal(parsed.draft.priority, 'high');
  });
  test('rejects malformed Gemma JSON', () => {
    assert.throws(() => parseModelOutput('not json at all', 'gemma-4-26b'));
  });
});
