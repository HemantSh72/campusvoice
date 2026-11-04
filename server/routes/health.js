import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dbHealthCheck } from '../db.js';
import { getModelChainState } from '../services/llmState.js';
import config from '../config.js';

const router = Router();
let version = null;
function getVersion() {
  if (version) return version;
  try { version = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version || '1.0.0'; }
  catch { version = '1.0.0'; }
  return version;
}

router.get('/', async (req, res) => {
  const db = await dbHealthCheck();
  const models = [...config.geminiModelChain, ...(config.gemmaModel ? [config.gemmaModel] : [])];
  const caps = Object.fromEntries(models.map((model) => [
    model, model === config.gemmaModel ? config.gemmaDailyCap : config.llmDailyCapPerModel,
  ]));
  let modelChain = models.map((model) => ({ model, status: config.geminiApiKey ? 'unknown' : 'fallback-only' }));
  if (config.geminiApiKey && db !== 'down') {
    try { modelChain = await getModelChainState(models, caps); }
    catch { modelChain = models.map((model) => ({ model, status: 'state-unavailable' })); }
  }
  res.json({
    ok: db !== 'down',
    db,
    llm: config.geminiApiKey ? 'configured' : 'fallback-only',
    modelChain,
    telegram: config.telegramBotToken && config.telegramChatId ? 'configured' : 'not_configured',
    adminPin: config.adminPin ? 'configured' : 'not_configured',
    microphone: 'browser-dependent',
    version: getVersion(),
  });
});
export default router;
