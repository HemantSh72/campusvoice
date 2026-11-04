/**
 * Ticket CRUD for MongoDB or local memory.
 */
import { getDB } from '../db.js';
import { getDepartment, getSlaHours } from '../validate.js';

const PUBLIC_FIELDS = {
  ticketNumber: 1, summary: 1, category: 1, department: 1, priority: 1,
  slaHours: 1, location: 1, reporterName: 1, status: 1, lang: 1,
  parsedBy: 1, telegramStatus: 1, isSeed: 1, createdAt: 1, resolvedAt: 1, _id: 0,
};

async function nextTicketNumber({ db, mem }) {
  if (mem) return ++mem.counter;
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: 'ticketNumber' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return result?.seq ?? result?.value?.seq;
}

export async function createTicket(data) {
  const { db, mem } = await getDB();
  const requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId : undefined;
  if (requestId) {
    const existing = await findByRequestId({ db, mem }, requestId);
    if (existing) return { ticket: existing, isDuplicate: true };
  }

  const ticket = {
    ticketNumber: await nextTicketNumber({ db, mem }),
    summary: data.summary || 'Issue reported',
    category: data.category || 'other',
    department: getDepartment(data.category),
    priority: data.priority || 'medium',
    slaHours: getSlaHours(data.priority),
    location: data.location || 'Not specified',
    reporterName: data.reporterName || null,
    status: 'open',
    transcript: (data.transcript || '').slice(0, 500),
    lang: data.lang || 'en-IN',
    parsedBy: data.parsedBy || 'fallback',
    telegramStatus: data.telegramStatus || 'not_configured',
    isSeed: Boolean(data.isSeed),
    createdAt: new Date(),
    resolvedAt: null,
  };
  if (requestId) ticket.requestId = requestId;

  if (mem) {
    if (requestId) mem.tickets.set(requestId, ticket);
    mem.ticketsByNumber.set(ticket.ticketNumber, ticket);
    return { ticket, isDuplicate: false };
  }
  try {
    await db.collection('tickets').insertOne(ticket);
    return { ticket, isDuplicate: false };
  } catch (error) {
    if (error.code === 11000 && requestId) {
      const existing = await findByRequestId({ db, mem }, requestId);
      if (existing) return { ticket: existing, isDuplicate: true };
    }
    throw error;
  }
}

async function findByRequestId({ db, mem }, requestId) {
  if (!requestId) return null;
  if (mem) return mem.tickets.get(requestId) || null;
  return db.collection('tickets').findOne({ requestId }, { projection: { ...PUBLIC_FIELDS, transcript: 0 } });
}

export async function getTickets() {
  const { db, mem } = await getDB();
  if (mem) return [...mem.ticketsByNumber.values()].sort((a,b) => b.createdAt - a.createdAt).slice(0,30).map(safeTicket);
  return db.collection('tickets').find({}, { projection: PUBLIC_FIELDS }).sort({ createdAt: -1 }).limit(30).toArray();
}

export async function getTicketByNumber(ticketNumber) {
  const { db, mem } = await getDB();
  const number = Number.parseInt(ticketNumber, 10);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  if (mem) return mem.ticketsByNumber.has(number) ? safeTicket(mem.ticketsByNumber.get(number)) : null;
  return db.collection('tickets').findOne({ ticketNumber: number }, { projection: PUBLIC_FIELDS });
}

export async function resolveTicket(ticketNumber) {
  const { db, mem } = await getDB();
  const number = Number.parseInt(ticketNumber, 10);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  if (mem) {
    const ticket = mem.ticketsByNumber.get(number);
    if (!ticket) return null;
    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    return safeTicket(ticket);
  }
  const result = await db.collection('tickets').findOneAndUpdate(
    { ticketNumber: number },
    { $set: { status: 'resolved', resolvedAt: new Date() } },
    { returnDocument: 'after', projection: PUBLIC_FIELDS },
  );
  return result?.value ?? result ?? null;
}

export async function updateTelegramStatus(ticketNumber, telegramStatus) {
  const { db, mem } = await getDB();
  if (mem) {
    const ticket = mem.ticketsByNumber.get(ticketNumber);
    if (ticket) ticket.telegramStatus = telegramStatus;
    return;
  }
  await db.collection('tickets').updateOne({ ticketNumber }, { $set: { telegramStatus } });
}

function safeTicket(ticket) {
  const result = {};
  for (const key of Object.keys(PUBLIC_FIELDS)) if (PUBLIC_FIELDS[key] === 1 && key in ticket) result[key] = ticket[key];
  return result;
}
