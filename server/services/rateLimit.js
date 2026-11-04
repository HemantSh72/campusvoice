/**
 * Atomic fixed-window IP rate limiter. MongoDB is the shared production store;
 * memory is used only for local development/tests.
 */
import { getDB } from '../db.js';
import config from '../config.js';

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    // Vercel appends the connecting address; the left-most value is the client.
    return forwarded.split(',')[0].trim().slice(0, 100);
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export async function checkRateLimit(ip) {
  const { db, mem } = await getDB();
  const now = Date.now();
  const minuteWindow = Math.floor(now / 60_000);
  const dayWindow = Math.floor(now / 86_400_000);
  const windows = [
    { key: `rl:${ip}:m:${minuteWindow}`, limit: config.rateLimitPerMin, retryAfter: Math.ceil(((minuteWindow + 1) * 60_000 - now) / 1000), ttl: 120_000 },
    { key: `rl:${ip}:d:${dayWindow}`, limit: config.rateLimitPerDay, retryAfter: Math.ceil(((dayWindow + 1) * 86_400_000 - now) / 1000), ttl: 172_800_000 },
  ];

  for (const window of windows) {
    let count;
    if (mem) {
      count = (mem.rateLimits.get(window.key) || 0) + 1;
      mem.rateLimits.set(window.key, count);
    } else {
      const col = db.collection('rateLimits');
      let result;
      try {
        result = await col.findOneAndUpdate(
          { key: window.key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now + window.ttl) } },
          { upsert: true, returnDocument: 'after' },
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        result = await col.findOneAndUpdate(
          { key: window.key },
          { $inc: { count: 1 } },
          { returnDocument: 'after' },
        );
      }
      count = result?.count ?? result?.value?.count ?? 1;
    }
    if (count > window.limit) {
      const seconds = Math.max(1, window.retryAfter);
      return {
        allowed: false,
        retryAfter: seconds,
        message: window.ttl < 86_400_000
          ? `Too many requests. Please wait ${seconds} seconds before trying again.`
          : 'Daily request limit reached. Please try again tomorrow.',
      };
    }
  }
  return { allowed: true };
}
