/**
 * server/services/budget.js
 * Daily LLM call budget tracker.
 * Backed by MongoDB (or in-memory in dev/test).
 * Resets at UTC midnight.
 */

import { getDB } from '../db.js';
import config from '../config.js';

function todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/**
 * Returns true if LLM calls are within daily budget.
 * Returns false if budget exceeded → caller should use fallbackParser.
 */
export async function checkBudget() {
  if (config.llmDailyBudget <= 0) return false; // 0 means disabled
  try {
    const { db, mem } = await getDB();
    const key = todayKey();

    if (mem) {
      return (mem.budgets.get(key) || 0) < config.llmDailyBudget;
    }

    const doc = await db.collection('budgets').findOne({ dateKey: key });
    return (doc?.count || 0) < config.llmDailyBudget;
  } catch {
    // On error, allow LLM usage (fail open)
    return true;
  }
}

/**
 * Increment today's LLM call counter.
 */
export async function incrementBudget() {
  try {
    const { db, mem } = await getDB();
    const key = todayKey();

    if (mem) {
      mem.budgets.set(key, (mem.budgets.get(key) || 0) + 1);
      return;
    }

    await db.collection('budgets').updateOne(
      { dateKey: key },
      { $inc: { count: 1 } },
      { upsert: true }
    );
  } catch {
    // Non-fatal
  }
}
