/**
 * server/services/rateLimit.js
 * Per-IP rate limiting backed by MongoDB (or in-memory in dev/test).
 * Fixed window per-minute and per-day limits.
 * Serverless-safe: no shared in-process memory for rate state.
 */

import { getDB } from '../db.js';
import config from '../config.js';

/**
 * Extract client IP from request.
 * Uses x-forwarded-for first hop (Vercel/Cloudflare convention).
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * Check and increment rate limits for a given IP.
 * Returns { allowed: boolean, retryAfter?: number (seconds), message?: string }
 */
export async function checkRateLimit(ip) {
  const { db, mem } = await getDB();
  const now = Date.now();

  // Window start times (UTC)
  const minWindowStart = now - 60_000;    // 1 minute ago
  const dayWindowStart = now - 86_400_000; // 24 hours ago

  const keyMin = `rl:${ip}:min`;
  const keyDay = `rl:${ip}:day`;

  if (mem) {
    return checkMemRateLimit(mem, ip, now, minWindowStart, dayWindowStart);
  }

  return checkMongoRateLimit(db, ip, now, keyMin, keyDay, minWindowStart, dayWindowStart);
}

// ─── In-memory rate limit ─────────────────────────────────────────────────────

function checkMemRateLimit(mem, ip, now, minWindowStart, dayWindowStart) {
  const keyMin = `${ip}:min`;
  const keyDay = `${ip}:day`;

  // Per-minute
  let minEntry = mem.rateLimits.get(keyMin);
  if (!minEntry || minEntry.windowStart < minWindowStart) {
    minEntry = { count: 0, windowStart: now };
    mem.rateLimits.set(keyMin, minEntry);
  }

  // Per-day
  let dayEntry = mem.rateLimits.get(keyDay);
  if (!dayEntry || dayEntry.windowStart < dayWindowStart) {
    dayEntry = { count: 0, windowStart: now };
    mem.rateLimits.set(keyDay, dayEntry);
  }

  if (minEntry.count >= config.rateLimitPerMin) {
    const retryAfter = Math.ceil((minEntry.windowStart + 60_000 - now) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(1, retryAfter),
      message: `Too many requests. Please wait ${Math.max(1, retryAfter)} seconds before trying again.`,
    };
  }

  if (dayEntry.count >= config.rateLimitPerDay) {
    return {
      allowed: false,
      retryAfter: 3600,
      message: 'Daily limit reached. Please try again tomorrow.',
    };
  }

  minEntry.count++;
  dayEntry.count++;
  return { allowed: true };
}

// ─── MongoDB rate limit ───────────────────────────────────────────────────────

async function checkMongoRateLimit(db, ip, now, keyMin, keyDay, minWindowStart, dayWindowStart) {
  const col = db.collection('rateLimits');

  // Fetch both windows in parallel
  const [minDoc, dayDoc] = await Promise.all([
    col.findOne({ key: keyMin, windowStart: { $gte: minWindowStart } }),
    col.findOne({ key: keyDay, windowStart: { $gte: dayWindowStart } }),
  ]);

  const minCount = minDoc?.count || 0;
  const dayCount = dayDoc?.count || 0;

  if (minCount >= config.rateLimitPerMin) {
    const retryAfter = Math.ceil(((minDoc?.windowStart || now) + 60_000 - now) / 1000);
    return {
      allowed: false,
      retryAfter: Math.max(1, retryAfter),
      message: `Too many requests. Please wait ${Math.max(1, retryAfter)} seconds before trying again.`,
    };
  }

  if (dayCount >= config.rateLimitPerDay) {
    return {
      allowed: false,
      retryAfter: 3600,
      message: 'Daily limit reached. Please try again tomorrow.',
    };
  }

  // Increment both counters
  const expiresAtMin = new Date(now + 60_000);
  const expiresAtDay = new Date(now + 86_400_000);

  await Promise.all([
    col.updateOne(
      { key: keyMin, windowStart: { $gte: minWindowStart } },
      {
        $inc: { count: 1 },
        $setOnInsert: { key: keyMin, windowStart: now, expiresAt: expiresAtMin },
      },
      { upsert: true }
    ),
    col.updateOne(
      { key: keyDay, windowStart: { $gte: dayWindowStart } },
      {
        $inc: { count: 1 },
        $setOnInsert: { key: keyDay, windowStart: now, expiresAt: expiresAtDay },
      },
      { upsert: true }
    ),
  ]);

  return { allowed: true };
}
