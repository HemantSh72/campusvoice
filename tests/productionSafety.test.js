import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('production mode never falls back to memory when MongoDB is missing', async () => {
  const script = [
    "process.env.NODE_ENV = 'production';",
    "process.env.MONGODB_URI = '';",
    "process.env.GEMINI_API_KEY = '';",
    "delete process.env.VERCEL;",
    "const { default: app } = await import('./server/app.js');",
    "const server = app.listen(0, '127.0.0.1', async () => {",
    "  try {",
    "    const base = 'http://127.0.0.1:' + server.address().port;",
    "    const healthResponse = await fetch(base + '/api/health');",
    "    const health = await healthResponse.json();",
    "    const voiceResponse = await fetch(base + '/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: 'WiFi is down in block B' }) });",
    "    const voice = await voiceResponse.json();",
    "    console.log(JSON.stringify({ healthStatus: healthResponse.status, db: health.db, ok: health.ok, voiceStatus: voiceResponse.status, voiceError: voice.error }));",
    "    if (health.db !== 'down' || health.ok !== false || voiceResponse.status !== 503) process.exitCode = 1;",
    "  } catch (error) { console.error(error); process.exitCode = 1; }",
    "  finally { server.close(); }",
    "});",
  ].join('\n');

  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', MONGODB_URI: '', GEMINI_API_KEY: '' },
    timeout: 15000,
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.healthStatus, 200);
  assert.equal(result.db, 'down');
  assert.equal(result.ok, false);
  assert.equal(result.voiceStatus, 503);
  assert.match(result.voiceError, /database/i);
});

test('production mode returns 503 when MongoDB is unreachable', async () => {
  const script = [
    "process.env.NODE_ENV = 'production';",
    "process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/campusvoice';",
    "process.env.GEMINI_API_KEY = '';",
    "delete process.env.VERCEL;",
    "const { default: app } = await import('./server/app.js');",
    "const server = app.listen(0, '127.0.0.1', async () => {",
    "  try {",
    "    const base = 'http://127.0.0.1:' + server.address().port;",
    "    const healthResponse = await fetch(base + '/api/health');",
    "    const health = await healthResponse.json();",
    "    const voiceResponse = await fetch(base + '/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: 'WiFi is down in block B' }) });",
    "    const voice = await voiceResponse.json();",
    "    console.log(JSON.stringify({ db: health.db, voiceStatus: voiceResponse.status, voiceError: voice.error }));",
    "    if (health.db !== 'down' || voiceResponse.status !== 503) process.exitCode = 1;",
    "  } catch (error) { console.error(error); process.exitCode = 1; }",
    "  finally { server.close(); }",
    "});",
  ].join('\n');

  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', MONGODB_URI: 'mongodb://127.0.0.1:1/campusvoice', GEMINI_API_KEY: '' },
    timeout: 15000,
  });
  const result = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(result.db, 'down');
  assert.equal(result.voiceStatus, 503);
  assert.match(result.voiceError, /database/i);
});
