/**
 * server/index.js
 * Local development server entry point.
 * Starts Express on PORT (default 5000).
 */

import app from './app.js';
import config from './config.js';

const port = config.port;

app.listen(port, () => {
  console.log(`\n🎙️  CampusVoice API running on http://localhost:${port}`);
  if (!config.mongoUri) {
    console.warn('⚠️  MONGODB_URI not set — using in-memory store (data will not persist between restarts)');
  }
  if (!config.geminiApiKey) {
    console.warn('⚠️  GEMINI_API_KEY not set — using rule-based parser only');
  }
  if (!config.telegramBotToken) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — Telegram alerts disabled');
  }
  if (!config.adminPin) {
    console.warn('⚠️  ADMIN_PIN not set — resolve endpoint disabled');
  }
  console.log('');
});
