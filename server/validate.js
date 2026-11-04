/**
 * server/validate.js
 * Input sanitization and validation helpers.
 * All functions are pure — no side effects, no DB access.
 */

import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_INTENTS = ['report_issue', 'check_status', 'cancel', 'unknown'];

export const VALID_CATEGORIES = [
  'it', 'hostel', 'mess', 'academics', 'transport',
  'maintenance', 'library', 'safety', 'other',
];

export const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];

export const VALID_STATUSES = ['open', 'resolved'];

export const CATEGORY_TO_DEPARTMENT = {
  it: 'IT & Network',
  hostel: 'Hostel Warden',
  mess: 'Mess & Canteen',
  academics: 'Academic Office',
  transport: 'Transport',
  maintenance: 'Electrical & Maintenance',
  library: 'Library',
  safety: 'Security & Safety',
  other: 'Administration',
};

export const PRIORITY_TO_SLA = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 72,
};

// ─── Sanitizers ───────────────────────────────────────────────────────────────

/**
 * Strip control characters (except newline/tab), truncate to 500 chars.
 * Returns sanitized string or null if result is empty.
 */
export function sanitizeTranscript(raw) {
  if (typeof raw !== 'string') return null;
  // Strip control chars except \n and \t
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 500);
}

/**
 * Clamp all string fields in an object to their maximum lengths.
 */
export function clampStrings(obj) {
  const result = { ...obj };
  if (typeof result.summary === 'string') result.summary = result.summary.slice(0, 200);
  if (typeof result.location === 'string') result.location = result.location.slice(0, 100);
  if (typeof result.reporterName === 'string') result.reporterName = result.reporterName.slice(0, 60);
  return result;
}

/**
 * Validate and normalize enum fields.
 * Invalid values are replaced with safe defaults.
 */
export function validateEnums(parsed) {
  const result = { ...parsed };

  if (!VALID_INTENTS.includes(result.intent)) {
    result.intent = 'unknown';
  }

  if (result.draft) {
    result.draft = { ...result.draft };
    if (!VALID_CATEGORIES.includes(result.draft.category)) {
      result.draft.category = 'other';
    }
    if (!VALID_PRIORITIES.includes(result.draft.priority)) {
      result.draft.priority = 'medium';
    }
  }

  return result;
}

/**
 * Map category to department name.
 */
export function getDepartment(category) {
  return CATEGORY_TO_DEPARTMENT[category] || CATEGORY_TO_DEPARTMENT.other;
}

/**
 * Map priority to SLA hours.
 */
export function getSlaHours(priority) {
  return PRIORITY_TO_SLA[priority] ?? PRIORITY_TO_SLA.medium;
}

/**
 * Validate a draft object — ensure it has the right shape.
 * Returns a cleaned draft (never throws).
 */
export function sanitizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const draft = {};
  if (typeof raw.summary === 'string') draft.summary = raw.summary.slice(0, 200);
  if (typeof raw.location === 'string') draft.location = raw.location.slice(0, 100);
  if (typeof raw.category === 'string' && VALID_CATEGORIES.includes(raw.category)) {
    draft.category = raw.category;
  }
  if (typeof raw.priority === 'string' && VALID_PRIORITIES.includes(raw.priority)) {
    draft.priority = raw.priority;
  }
  if (typeof raw.reporterName === 'string') draft.reporterName = raw.reporterName.slice(0, 60);
  if (typeof raw.followUpCount === 'number') {
    draft.followUpCount = Math.max(0, Math.min(10, Math.floor(raw.followUpCount)));
  }

  return draft;
}

/**
 * Constant-time PIN comparison using Node's crypto.timingSafeEqual.
 * Pads both sides to the same length to prevent length-based timing leaks.
 * Returns true if submitted === stored, false otherwise.
 */
export function comparePin(submitted, stored) {
  if (!stored) return false;
  if (typeof submitted !== 'string') return false;

  const digestA = createHash('sha256').update(submitted, 'utf8').digest();
  const digestB = createHash('sha256').update(stored, 'utf8').digest();
  return cryptoTimingSafeEqual(digestA, digestB);
}
