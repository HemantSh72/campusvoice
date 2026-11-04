/**
 * server/db.js
 * MongoDB client with globalThis caching for serverless reuse.
 * Falls back to in-memory store when MONGODB_URI is absent AND not production.
 * In production, throws if MongoDB is unreachable.
 */

import { MongoClient } from 'mongodb';
import config from './config.js';

// ─── In-memory store (dev/test only) ─────────────────────────────────────────

class MemoryStore {
  constructor() {
    this.tickets = new Map();        // requestId -> ticket doc
    this.ticketsByNumber = new Map(); // ticketNumber -> ticket doc
    this.counter = 0;
    this.rateLimits = new Map();     // key -> {count, windowStart}
    this.budgets = new Map();        // dateKey -> count
  }
}

// Module-level singleton for in-memory store
let memStore = null;

function getMemStore() {
  if (!memStore) memStore = new MemoryStore();
  return memStore;
}

// Allow tests to reset the memory store
export function resetMemStore() {
  memStore = new MemoryStore();
}

// ─── MongoDB client (cached on globalThis for serverless) ─────────────────────

async function connectMongo() {
  // Use cached client if available and connected
  if (globalThis.__mongoClient) {
    try {
      await globalThis.__mongoClient.db('admin').command({ ping: 1 });
      return globalThis.__mongoClient;
    } catch {
      globalThis.__mongoClient = null;
    }
  }

  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  await client.connect();
  globalThis.__mongoClient = client;
  return client;
}

// ─── Index creation (idempotent) ─────────────────────────────────────────────

let indexesCreated = false;

async function ensureIndexes(db) {
  if (indexesCreated) return;
  indexesCreated = true;

  try {
    // tickets: unique ticketNumber, unique requestId
    await db.collection('tickets').createIndex({ ticketNumber: 1 }, { unique: true });
    await db.collection('tickets').createIndex({ requestId: 1 }, { unique: true, sparse: true });
    await db.collection('tickets').createIndex({ createdAt: -1 });

    // counters: used for atomic ticketNumber generation
    await db.collection('counters').createIndex({ _id: 1 }, { unique: true });

    // rateLimits: TTL index — documents expire automatically
    await db.collection('rateLimits').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );
    await db.collection('rateLimits').createIndex({ key: 1 });

    // budgets: keyed by date string
    await db.collection('budgets').createIndex({ dateKey: 1 }, { unique: true });
  } catch (err) {
    // Index creation errors are non-fatal (may already exist)
    console.warn('[db] Index creation warning:', err.message);
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

/**
 * Returns { db, type } where type is "mongo" | "memory".
 * Throws in production if MongoDB is unavailable.
 */
export async function getDB() {
  if (!config.mongoUri) {
    if (config.isProduction) {
      throw new Error('MONGODB_URI is required in production');
    }
    // Dev/test: use in-memory store
    return { db: null, mem: getMemStore(), type: 'memory' };
  }

  try {
    const client = await connectMongo();
    const db = client.db(config.mongoDb);
    await ensureIndexes(db);
    return { db, mem: null, type: 'mongo' };
  } catch (err) {
    if (config.isProduction) {
      throw err; // propagate so route can return 503
    }
    console.warn('[db] MongoDB unavailable, using in-memory store:', err.message);
    return { db: null, mem: getMemStore(), type: 'memory' };
  }
}

/**
 * Quick health check: returns "mongo" | "memory" | "down"
 */
export async function dbHealthCheck() {
  if (!config.mongoUri) {
    if (config.isProduction) return 'down';
    return 'memory';
  }
  try {
    const client = await connectMongo();
    await client.db('admin').command({ ping: 1 });
    return 'mongo';
  } catch {
    return config.isProduction ? 'down' : 'memory';
  }
}
