/**
 * Integration smoke checks. Each integration is tested independently.
 * Reads .env.local without ever printing secret values.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index > 0 && !(trimmed.slice(0, index).trim() in process.env)) {
        process.env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  } catch {}
}
loadEnv();

let failureCount = 0;
let failureCount = 0;
const pass = (name, detail = '') => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (name, error) => {
  failureCount += 1;
  let reason = error?.message || String(error);
  for (const key of ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'MONGODB_URI', 'ADMIN_PIN']) {
    const secret = process.env[key];
    if (secret) reason = reason.split(secret).join('[redacted]');
  }
  reason = reason.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[redacted]')
    .replace(/key=[^&\s]+/gi, 'key=[redacted]')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, 'mongodb://[redacted]');
  console.log(`FAIL  ${name} — ${reason.slice(0, 180)}`);
};
const skip = (name, reason) => console.log(`SKIPPED  ${name} — ${reason}`);

async function geminiCheck(model, key) {
  const isGemma = model.toLowerCase().includes('gemma');
  const instruction = 'Return only JSON with keys intent and draft. Utterance: wifi is down in hostel block B. intent must be report_issue. draft must include summary, location, category, priority.';
  const body = {
    contents: [{ role: 'user', parts: [{ text: instruction }] }],
    generationConfig: { temperature: 0 },
  };
  if (!isGemma) body.generationConfig.responseMimeType = 'application/json';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error?.message || 'request rejected'}`);
  const output = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('response did not contain a JSON object');
  const parsed = JSON.parse(output.slice(start, end + 1));
  if (!parsed.intent || !parsed.draft) throw new Error('JSON response missing intent or draft');
}

console.log('\nCampusVoice integration smoke checks\n');
const apiKey = process.env.GEMINI_API_KEY || '';
const chain = (process.env.GEMINI_MODEL_CHAIN || 'gemini-3.1-flash-lite,gemini-3.5-flash-lite').split(',').map((v) => v.trim()).filter(Boolean);
const gemma = process.env.GEMMA_MODEL?.trim() || '';

if (!apiKey) {
  skip('Gemini models.list', 'GEMINI_API_KEY is empty');
  for (const model of [...chain, ...(gemma ? [gemma] : [])]) skip(`Gemini ${model}`, 'GEMINI_API_KEY is empty');
} else {
  try {
    const ids = new Set();
    let pageToken = '';
    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('key', apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(\`HTTP \${response.status}: \${data.error?.message || 'models.list failed'}\`);
      for (const model of data.models || []) {
        const id = model.name?.replace(/^models\//, '');
        if (id && /flash-lite|gemma/i.test(id)) ids.add(id);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    pass('Gemini models.list', \`\${ids.size} matching model(s)\`);
    for (const id of ids) console.log(\`  model: \${id}\`);
  } catch (error) { fail('Gemini models.list', error); }
  for (const model of [...new Set([...chain, ...(gemma ? [gemma] : [])])]) {
    try { await geminiCheck(model, apiKey); pass(`Gemini ${model}`, 'valid JSON response'); }
    catch (error) { fail(`Gemini ${model}`, error); }
  }
}

if (!process.env.MONGODB_URI) {
  skip('MongoDB round-trip and ticket counter', 'MONGODB_URI is empty');
} else {
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 7000 });
    await client.connect();
    try {
      const db = client.db(process.env.MONGODB_DB || 'campusvoice');
      const col = db.collection('campusvoice_smoke');
      const id = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await col.insertOne({ _id: id, createdAt: new Date() });
      try {
        const found = await col.findOne({ _id: id });
        if (!found) throw new Error('inserted document could not be read');
      } finally {
        await col.deleteOne({ _id: id }).catch(() => {});
      }
      await db.collection('counters').findOneAndUpdate({ _id: 'ticketNumber' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false });
      pass('MongoDB insert/read/delete + ticket counter', 'round-trip succeeded');
    } finally { await client.close(); }
  } catch (error) { fail('MongoDB round-trip + ticket counter', error); }
}

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  skip('Telegram test message', 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty');
} else {
  try {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: 'CampusVoice smoke test: Telegram integration is reachable.' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.description || `HTTP ${response.status}`);
    pass('Telegram test message', 'message accepted by Telegram');
  } catch (error) { fail('Telegram test message', error); }
}

if (process.env.ADMIN_PIN) pass('ADMIN_PIN', 'configured (value hidden)');
else skip('ADMIN_PIN', 'ADMIN_PIN is empty');

console.log('\nSmoke checks finished. SKIPPED checks require credentials; FAIL checks need attention.\n');
if (failureCount > 0) process.exitCode = 1;
if (failureCount > 0) process.exitCode = 1;
