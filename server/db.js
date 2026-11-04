/**
 * MongoDB access layer with serverless-safe client and connection-promise caching.
 * In-memory persistence is restricted to local development and tests.
 */
import { MongoClient } from 'mongodb';
import config from './config.js';

class MemoryStore {
  constructor() {
    this.tickets = new Map();
    this.ticketsByNumber = new Map();
    this.counter = 0;
    this.rateLimits = new Map();
    this.modelStates = new Map();
  }
}
let memStore = new MemoryStore();
export function resetMemStore() { memStore = new MemoryStore(); }

async function connectMongo() {
  if (globalThis.__campusVoiceMongoClient) {
    try {
      await globalThis.__campusVoiceMongoClient.db('admin').command({ ping: 1 });
      return globalThis.__campusVoiceMongoClient;
    } catch {
      globalThis.__campusVoiceMongoClient = null;
      globalThis.__campusVoiceMongoPromise = null;
    }
  }
  if (!globalThis.__campusVoiceMongoPromise) {
    globalThis.__campusVoiceMongoPromise = (async () => {
      const client = new MongoClient(config.mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: 10,
      });
      await client.connect();
      globalThis.__campusVoiceMongoClient = client;
      return client;
    })().catch((error) => {
      globalThis.__campusVoiceMongoPromise = null;
      throw error;
    });
  }
  return globalThis.__campusVoiceMongoPromise;
}

let indexesPromise;
async function ensureIndexes(db) {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      await Promise.all([
        db.collection('tickets').createIndex({ ticketNumber: 1 }, { unique: true }),
        db.collection('tickets').createIndex(
          { requestId: 1 },
          { unique: true, partialFilterExpression: { requestId: { $type: 'string' } }, name: 'requestId_unique_string' },
        ),
        db.collection('tickets').createIndex({ createdAt: -1 }),
        db.collection('rateLimits').createIndex({ key: 1 }, { unique: true, name: 'rate_limit_key_unique' }),
        db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('llmState').createIndex({ dailyDate: 1 }),
      ]);
    })().catch((error) => {
      indexesPromise = null;
      throw error;
    });
  }
  return indexesPromise;
}

export async function getDB() {
  if (!config.mongoUri) {
    if (config.isProduction) throw new Error('Production database unavailable: MONGODB_URI is required.');
    return { db: null, mem: memStore, type: 'memory' };
  }
  try {
    const client = await connectMongo();
    const db = client.db(config.mongoDb);
    await ensureIndexes(db);
    return { db, mem: null, type: 'mongo' };
  } catch (error) {
    if (config.isProduction) throw new Error('Production database unavailable.', { cause: error });
    console.warn('[db] MongoDB unavailable; using local in-memory storage:', error.message);
    return { db: null, mem: memStore, type: 'memory' };
  }
}

export async function dbHealthCheck() {
  if (!config.mongoUri) return config.isProduction ? 'down' : 'memory';
  try {
    const client = await connectMongo();
    await client.db('admin').command({ ping: 1 });
    return 'mongo';
  } catch {
    return config.isProduction ? 'down' : 'memory';
  }
}

export async function getModelState(model) {
  const { db, mem } = await getDB();
  if (mem) return mem.modelStates.get(model) || null;
  return db.collection('llmState').findOne({ _id: model });
}

export async function incrementModelCount(model, dateKey) {
  const { db, mem } = await getDB();
  if (mem) {
    const state = mem.modelStates.get(model) || { _id: model, dailyDate: dateKey, dailyCount: 0, quotaFailures: [], blockedUntil: 0, blockedForDay: false };
    if (state.dailyDate !== dateKey) Object.assign(state, { dailyDate: dateKey, dailyCount: 0, quotaFailures: [], blockedUntil: 0, blockedForDay: false });
    state.dailyCount += 1;
    mem.modelStates.set(model, state);
    return state.dailyCount;
  }
  await db.collection('llmState').updateOne(
    { _id: model },
    [{ $set: {
      dailyCount: { $cond: [{ $eq: ['$dailyDate', dateKey] }, { $add: [{ $ifNull: ['$dailyCount', 0] }, 1] }, 1] },
      dailyDate: dateKey,
    } }],
    { upsert: true },
  );
  return (await getModelState(model))?.dailyCount || 0;
}

export async function recordModelQuotaFailure(model, now = Date.now()) {
  const dateKey = new Date(now).toISOString().slice(0, 10);
  const cutoff = now - 10 * 60 * 1000;
  const { db, mem } = await getDB();
  if (mem) {
    const state = mem.modelStates.get(model) || { _id: model, dailyDate: dateKey, dailyCount: 0, quotaFailures: [], blockedUntil: 0, blockedForDay: false };
    if (state.dailyDate !== dateKey) Object.assign(state, { dailyDate: dateKey, dailyCount: 0, quotaFailures: [], blockedUntil: 0, blockedForDay: false });
    state.quotaFailures = (state.quotaFailures || []).filter((time) => time >= cutoff);
    state.quotaFailures.push(now);
    state.blockedUntil = state.quotaFailures.length >= 3
      ? Date.parse(dateKey + 'T23:59:59.999Z')
      : now + 60_000;
    state.blockedForDay = state.quotaFailures.length >= 3;
    mem.modelStates.set(model, state);
    return state;
  }
  const col = db.collection('llmState');
  const state = await col.findOne({ _id: model });
  const failures = (state?.dailyDate === dateKey ? state.quotaFailures || [] : []).filter((time) => time >= cutoff);
  failures.push(now);
  const blockedForDay = failures.length >= 3;
  const blockedUntil = blockedForDay ? Date.parse(dateKey + 'T23:59:59.999Z') : now + 60_000;
  await col.updateOne(
    { _id: model },
    { $set: { dailyDate: dateKey, quotaFailures: failures, blockedUntil, blockedForDay } },
    { upsert: true },
  );
  return { _id: model, dailyDate: dateKey, quotaFailures: failures, blockedUntil, blockedForDay, dailyCount: state?.dailyDate === dateKey ? state.dailyCount || 0 : 0 };
}
