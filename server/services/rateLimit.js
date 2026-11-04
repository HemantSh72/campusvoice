/**
 * Atomic fixed-window per-IP rate limiter with TTL cleanup.
 * IP addresses are hashed before storage.
 */
import { createHash } from 'node:crypto';
import { getDB } from '../db.js';
import config from '../config.js';

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : '';
  return candidate || req.socket?.remoteAddress || req.ip || 'unknown';
}

export async function checkRateLimit(ip) {
  const { db, mem } = await getDB();
  const now = Date.now();
  const hash = createHash('sha256').update(String(ip)).digest('hex').slice(0, 24);
  const minute = Math.floor(now / 60000);
  const day = new Date(now).toISOString().slice(0, 10);
  const minuteKey = `rl:${hash}:m:${minute}`;
  const dayKey = `rl:${hash}:d:${day}`;

  if (mem) {
    const minuteCount = mem.rateLimits.get(minuteKey) || 0;
    const dayCount = mem.rateLimits.get(dayKey) || 0;
    if (minuteCount >= config.rateLimitPerMin) return {
      allowed: false, retryAfter: 60 - Math.floor((now % 60000) / 1000),
      message: 'Too many requests. Please wait a moment before trying again.',
    };
    if (dayCount >= config.rateLimitPerDay) return {
      allowed: false, retryAfter: 3600, message: 'Daily request limit reached. Please try again tomorrow.',
    };
    mem.rateLimits.set(minuteKey, minuteCount + 1);
    mem.rateLimits.set(dayKey, dayCount + 1);
    if (mem.rateLimits.size > 5000) {
      for (const key of mem.rateLimits.keys()) if (!key.includes(`:${minute}`) && !key.includes(`:${day}`)) mem.rateLimits.delete(key);
    }
    return { allowed: true };
  }

  const col = db.collection('rateLimits');
  const [minuteDoc, dayDoc] = await Promise.all([
    col.findOneAndUpdate(
      { key: minuteKey }, { $inc: { count: 1 }, $setOnInsert: { key: minuteKey, expiresAt: new Date((minute + 2) * 60000) } },
      { upsert: true, returnDocument: 'after' }
    ),
    col.findOneAndUpdate(
      { key: dayKey }, { $inc: { count: 1 }, $setOnInsert: { key: dayKey, expiresAt: new Date(Date.now() + 2 * 86400000) } },
      { upsert: true, returnDocument: 'after' }
    ),
  ]);
  const minCount = minuteDoc?.count || 0;
  const dayCount = dayDoc?.count || 0;
  if (minCount > config.rateLimitPerMin) return {
    allowed: false, retryAfter: 60 - Math.floor((now % 60000) / 1000),
    message: 'Too many requests. Please wait a moment before trying again.',
  };
  if (dayCount > config.rateLimitPerDay) return {
    allowed: false, retryAfter: 3600, message: 'Daily request limit reached. Please try again tomorrow.',
  };
  return { allowed: true };
}
