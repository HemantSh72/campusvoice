import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutput, parseRulesFollowup } from '../server/services/llm.js';

describe('Gemini/Gemma output validation', () => {
  test('parses strict Gemini JSON', () => {
    const parsed = parseOutput(JSON.stringify({
      intent: 'report_issue',
      draft: { summary: 'WiFi is down', location: 'Block B', category: 'it', priority: 'high' },
      ticketNumber: null,
    }));
    assert.equal(parsed.intent, 'report_issue');
    assert.equal(parsed.draft.category, 'it');
    assert.equal(parsed.draft.priority, 'high');
  });

  test('extracts first JSON object from Gemma prose', () => {
    const parsed = parseOutput('Here is the result:\n{"intent":"report_issue","draft":{"summary":"WiFi down","location":"Block B","category":"it","priority":"high"},"ticketNumber":null}\nDone.', true);
    assert.equal(parsed.draft.location, 'Block B');
  });

  test('rejects non-JSON Gemini output', () => {
    assert.throws(() => parseOutput('The answer is a complaint.'), /Invalid JSON/);
  });

  test('sanitizes invalid enums and clamps model fields', () => {
    const parsed = parseOutput(JSON.stringify({
      intent: 'run_shell',
      draft: { summary: 'x'.repeat(300), location: 'A', category: 'unknown', priority: 'urgent' },
      ticketNumber: 'not-a-number',
    }), true);
    assert.equal(parsed.intent, 'unknown');
    assert.equal(parsed.draft.category, 'other');
    assert.equal(parsed.draft.priority, 'medium');
    assert.equal(parsed.draft.summary.length, 200);
    assert.equal(parsed.ticketNumber, null);
  });
});

describe('Deterministic location follow-up', () => {
  const draft = { summary: 'WiFi is not working', category: 'it', priority: 'medium' };
  test('uses short follow-up as location without an LLM request', () => {
    const parsed = parseRulesFollowup('in hostel block B', draft);
    assert.equal(parsed.parsedBy, 'rules-followup');
    assert.equal(parsed.draft.location, 'hostel block B');
  });
  test('does not consume a status query as a location', () => {
    assert.equal(parseRulesFollowup('status of ticket 7', draft), null);
  });
  test('does not consume a cancellation as a location', () => {
    assert.equal(parseRulesFollowup('cancel', draft), null);
  });
  test('does not treat a long utterance as a location', () => {
    assert.equal(parseRulesFollowup('the whole hostel building near the back gate is affected by this issue', draft), null);
  });
});
