import { getDB } from '../db.js';
const utcDay = () => new Date().toISOString().slice(0, 10);
const utcEnd = () => { const d = new Date(); d.setUTCHours(23, 59, 59, 999); return d; };

export async function reserveModelCall(model, cap) {
  const { db, mem } = await getDB();
  const dateKey = utcDay();
  if (mem) {
    const key = `${model}:${dateKey}`;
    const count = mem.llmUsage.get(key) || 0;
    if (count >= cap) return false;
    mem.llmUsage.set(key, count + 1);
    return true;
  }
  const col = db.collection('llmUsage');
  await col.updateOne({ model, dateKey }, { $setOnInsert: { model, dateKey, count: 0 } }, { upsert: true });
  return Boolean(await col.findOneAndUpdate(
    { model, dateKey, count: { $lt: cap } }, { $inc: { count: 1 } }, { returnDocument: 'after' }
  ));
}

export async function modelIsBlocked(model) {
  const { db, mem } = await getDB();
  const record = mem ? mem.llmBreakers.get(model) : await db.collection('llmBreakers').findOne({ model });
  if (!record?.blockedUntil) return false;
  if (new Date(record.blockedUntil).getTime() > Date.now()) return true;
  if (mem) mem.llmBreakers.delete(model);
  else await db.collection('llmBreakers').deleteOne({ model, blockedUntil: record.blockedUntil });
  return false;
}

export async function recordModelQuotaFailure(model) {
  const { db, mem } = await getDB();
  const now = Date.now();
  const failures = mem
    ? (mem.llmBreakers.get(model)?.failures || [])
    : ((await db.collection('llmBreakers').findOne({ model }))?.failures || []);
  const recent = failures.map((v) => new Date(v).getTime()).filter((v) => v >= now - 600000);
  recent.push(now);
  const update = { model, failures: recent.map((v) => new Date(v)), blockedUntil: recent.length >= 3 ? utcEnd() : new Date(now + 60000) };
  if (mem) mem.llmBreakers.set(model, update);
  else await db.collection('llmBreakers').updateOne({ model }, { $set: update }, { upsert: true });
}

export async function getModelChainState(models, caps) {
  const { db, mem } = await getDB();
  const dateKey = utcDay();
  const states = [];
  for (const model of models) {
    const used = mem ? (mem.llmUsage.get(`${model}:${dateKey}`) || 0)
      : ((await db.collection('llmUsage').findOne({ model, dateKey }))?.count || 0);
    const breaker = mem ? mem.llmBreakers.get(model) : await db.collection('llmBreakers').findOne({ model });
    const tripped = breaker?.blockedUntil && new Date(breaker.blockedUntil).getTime() > Date.now();
    states.push({ model, status: tripped ? 'tripped' : used >= caps[model] ? 'capped' : 'available', used, cap: caps[model], blockedUntil: tripped ? breaker.blockedUntil : null });
  }
  return states;
}
