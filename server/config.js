/**
 * server/config.js
 * Central config object — reads env vars, provides typed defaults.
 * All env vars are optional locally. This module never throws.
 */

// Load .env.local in development (Vite handles this for the frontend;
// we do it manually for the Express server process).
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadDotEnvLocal() {
  try {
    const filePath = resolve(process.cwd(), '.env.local');
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      // Don't overwrite vars already set in the process environment
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local is optional
  }
}

loadDotEnvLocal();

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const config = Object.freeze({
  isProduction,

  // LLM
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  geminiFallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash',
  llmDailyBudget: parseInt(process.env.LLM_DAILY_BUDGET || '150', 10),

  // Database
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'campusvoice',

  // Telegram
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',

  // Admin
  adminPin: process.env.ADMIN_PIN || '',

  // Rate limiting
  rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '40', 10),
  rateLimitPerDay: parseInt(process.env.RATE_LIMIT_PER_DAY || '1000', 10),

  // Server
  port: parseInt(process.env.PORT || '5000', 10),
});

export default config;
