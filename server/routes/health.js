/**
 * server/routes/health.js
 * GET /api/health — system health check.
 * Never reveals secret values.
 */

import { Router } from 'express';
import { dbHealthCheck } from '../db.js';
import config from '../config.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const router = Router();

// Read version from package.json (cached)
let _version = null;
function getVersion() {
  if (_version) return _version;
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    _version = pkg.version || '1.0.0';
  } catch {
    _version = '1.0.0';
  }
  return _version;
}

router.get('/', async (req, res) => {
  const dbStatus = await dbHealthCheck();
  const llmStatus = config.geminiApiKey ? 'configured' : 'fallback-only';
  const telegramStatus = (config.telegramBotToken && config.telegramChatId)
    ? 'configured'
    : 'not_configured';

  res.json({
    ok: dbStatus !== 'down',
    db: dbStatus,
    llm: llmStatus,
    telegram: telegramStatus,
    adminPin: config.adminPin ? 'configured' : 'not_configured',
    version: getVersion(),
  });
});

export default router;
