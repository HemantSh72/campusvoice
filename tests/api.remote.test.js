import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) throw new Error('BASE_URL is required. Set it to your deployed CampusVoice URL before running npm run test:remote.');
const remote = (name, fn) => test(name, { skip: !BASE_URL }, fn);
async function call(path, options = {}) {
  const response = await fetch(BASE_URL + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const makeId = () => globalThis.crypto?.randomUUID?.() || `cv-remote-${Date.now()}-${Math.random()}`;

describe('Remote CampusVoice API', () => {
  remote('health endpoint reports integration state', async () => {
    const { status, body } = await call('/api/health');
    assert.equal(status, 200);
    assert.ok(['mongo', 'memory', 'down'].includes(body.db));
    assert.equal(body.ok, true, 'remote service should have a usable database');
    assert.ok(body.llm);
    assert.ok(body.telegram);
  });
  remote('rejects an empty transcript', async () => {
    const { status, body } = await call('/api/voice', { method: 'POST', body: JSON.stringify({ transcript: '' }) });
    assert.equal(status, 400);
    assert.ok(body.error);
  });
  remote('creates a ticket and returns the same ticket for a duplicate requestId', async () => {
    const payload = { transcript: 'WiFi is not working in hostel block B', requestId: makeId() };
    const first = await call('/api/voice', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(first.status, 200, first.body.error);
    assert.ok(first.body.ticket?.ticketNumber);
    const second = await call('/api/voice', { method: 'POST', body: JSON.stringify(payload) });
    assert.equal(second.status, 200, second.body.error);
    assert.equal(second.body.ticket.ticketNumber, first.body.ticket.ticketNumber);
    const status = await call('/api/voice', {
      method: 'POST',
      body: JSON.stringify({ transcript: 'what is the status of ticket ' + first.body.ticket.ticketNumber, requestId: makeId() }),
    });
    assert.equal(status.status, 200, status.body.error);
    assert.match(status.body.reply, /ticket/i);
  });
  remote('ticket list excludes requestId and transcript', async () => {
    const { status, body } = await call('/api/tickets');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.tickets));
    assert.ok(body.tickets.every((ticket) => !('requestId' in ticket) && !('transcript' in ticket)));
  });
});
