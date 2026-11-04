/**
 * Central configuration. Reads .env.local for local development only.
 * Secrets are never exposed to the browser or health endpoint.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnvLocal() {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) return;
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (!process.env[key]?.trim()) process.env[key] = value;
    }
  } catch { /* optional */ }
}
loadDotEnvLocal();

const int = (value, fallback, min = 0) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
};

const modelChain = (process.env.GEMINI_MODEL_CHAIN || 'gemini-3.1-flash-lite,gemini-3.5-flash-lite')
  .split(',').map((model) => model.trim()).filter(Boolean);

const config = Object.freeze({
  isProduction: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModelChain: [...new Set(modelChain)],
  gemmaModel: process.env.GEMMA_MODEL?.trim() || '',
  llmDailyCapPerModel: int(process.env.LLM_DAILY_CAP_PER_MODEL, 450, 0),
  gemmaDailyCap: 5000,
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'campusvoice',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  adminPin: process.env.ADMIN_PIN || '',
  rateLimitPerMin: int(process.env.RATE_LIMIT_PER_MIN, 40, 1),
  rateLimitPerDay: int(process.env.RATE_LIMIT_PER_DAY, 1000, 1),
  port: int(process.env.PORT, 5000, 1),
});
export default config;
