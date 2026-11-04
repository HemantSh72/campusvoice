/** Compatibility wrapper: quota is reserved atomically per model before a request. */
import { reserveModelCall } from './llmState.js';
import config from '../config.js';
export async function checkBudget(model = config.geminiModelChain[0]) {
  return reserveModelCall(model, model === config.gemmaModel ? config.gemmaDailyCap : config.llmDailyCapPerModel);
}
export async function incrementBudget() { /* reservation occurs in checkBudget */ }
