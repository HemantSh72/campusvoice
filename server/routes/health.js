/**
 * GET /api/health — public, secret-free status of configured integrations.
 */
import { Router } from 'express';
import { dbHealthCheck } from '../db.js';
import { getModelChainHealth } from '../services/budget.js';
import config from '../config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const router = Router();
let version = '1.0.0';
try { version = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version || version; } catch {}

router.get('/', async (req, res, next) => {
  try {
    const db = await dbHealthCheck();
    const models = [...config.geminiModelChain, ...(config.gemmaModel ? [config.gemmaModel] : [])];
    let modelChain = {};
    if (config.geminiApiKey && models.length) {
      try { modelChain = await getModelChainHealth(models); }
      catch { modelChain = Object.fromEntries(models.map((model) => [model, { available: false, reason: 'state unavailable' }])); }
    }
    res.json({
      ok: db !== 'down',
      db,
      llm: config.geminiApiKey ? 'configured' : 'fallback-only',
      modelChain,
      telegram: config.telegramBotToken && config.telegramChatId ? 'configured' : 'not_configured',
      adminPin: config.adminPin ? 'configured' : 'not_configured',
      version,
    });
  } catch (error) { next(error); }
});

export default router;
