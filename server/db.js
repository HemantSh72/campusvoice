/**
 * MongoDB access with serverless-safe connection and index initialization.
 * Memory storage is permitted only outside production.
 */
import { MongoClient } from 'mongodb';
import config from './config.js';

class MemoryStore {
  constructor() {
    this.tickets = new Map();
    this.ticketsByNumber = new Map();
    this.counter = 0;
    this.rateLimits = new Map();
    this.llmUsage = new Map();
    this.llmBreakers = new Map();
  }
}
let memStore = new MemoryStore();
export function resetMemStore() { memStore = new MemoryStore(); }
const getMemStore = () => memStore;

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
    const client = new MongoClient(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    globalThis.__campusVoiceMongoPromise = client.connect()
      .then((connected) => {
        globalThis.__campusVoiceMongoClient = connected;
        return connected;
      })
      .catch((error) => {
        globalThis.__campusVoiceMongoPromise = null;
        throw error;
      });
  }
  return globalThis.__campusVoiceMongoPromise;
}

let indexPromise = null;
async function ensureIndexes(db) {
  if (!indexPromise) {
    indexPromise = (async () => {
      await Promise.all([
        db.collection('tickets').createIndex({ ticketNumber: 1 }, { unique: true }),
        db.collection('tickets').createIndex({ requestId: 1 }, { unique: true, sparse: true }),
        db.collection('tickets').createIndex({ createdAt: -1 }),
        db.collection('rateLimits').createIndex({ key: 1 }, { unique: true }),
        db.collection('rateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('llmUsage').createIndex({ model: 1, dateKey: 1 }, { unique: true }),
        db.collection('llmBreakers').createIndex({ model: 1 }, { unique: true }),
      ]);
    })().catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  await indexPromise;
}

export async function getDB() {
  if (!config.mongoUri) {
    if (config.isProduction) throw new Error('DATABASE_UNAVAILABLE: MONGODB_URI is required in production');
    return { db: null, mem: getMemStore(), type: 'memory' };
  }
  try {
    const client = await connectMongo();
    const db = client.db(config.mongoDb);
    await ensureIndexes(db);
    return { db, mem: null, type: 'mongo' };
  } catch (error) {
    if (config.isProduction) {
      const unavailable = new Error('DATABASE_UNAVAILABLE: MongoDB is unavailable');
      unavailable.cause = error;
      throw unavailable;
    }
    console.warn('[db] MongoDB unavailable; using local memory store:', error.message);
    return { db: null, mem: getMemStore(), type: 'memory' };
  }
}

export async function dbHealthCheck() {
  if (!config.mongoUri) return config.isProduction ? 'down' : 'memory';
  try {
    const { type } = await getDB();
    return type;
  } catch { return config.isProduction ? 'down' : 'memory'; }
}
