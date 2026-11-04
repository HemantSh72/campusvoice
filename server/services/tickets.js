/**
 * server/services/tickets.js
 * Ticket CRUD operations against MongoDB or in-memory store.
 */

import { getDB } from '../db.js';
import { getDepartment, getSlaHours } from '../validate.js';

// Fields safe to expose publicly (never raw IP, never requestId)
const PUBLIC_FIELDS = {
  ticketNumber: 1,
  summary: 1,
  category: 1,
  department: 1,
  priority: 1,
  slaHours: 1,
  location: 1,
  reporterName: 1,
  status: 1,
  lang: 1,
  parsedBy: 1,
  telegramStatus: 1,
  isSeed: 1,
  createdAt: 1,
  resolvedAt: 1,
  _id: 0,
};

// ─── Atomic counter ───────────────────────────────────────────────────────────

async function nextTicketNumber({ db, mem }) {
  if (mem) {
    return ++mem.counter;
  }

  const result = await db.collection('counters').findOneAndUpdate(
    { _id: 'ticketNumber' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

// ─── Create ticket ────────────────────────────────────────────────────────────

/**
 * Create a new ticket. Handles idempotency via requestId unique index.
 * Returns { ticket, isDuplicate }.
 */
export async function createTicket(data) {
  const { db, mem } = await getDB();

  const { requestId } = data;

  // Check for existing ticket with this requestId (idempotency)
  if (requestId) {
    const existing = await findByRequestId({ db, mem }, requestId);
    if (existing) {
      return { ticket: existing, isDuplicate: true };
    }
  }

  const ticketNumber = await nextTicketNumber({ db, mem });
  const department = getDepartment(data.category);
  const slaHours = getSlaHours(data.priority);

  const ticket = {
    ticketNumber,
    summary: data.summary || 'Issue reported',
    category: data.category || 'other',
    department,
    priority: data.priority || 'medium',
    slaHours,
    location: data.location || 'Not specified',
    reporterName: data.reporterName || null,
    status: 'open',
    transcript: data.transcript || '',
    lang: data.lang || 'en-IN',
    parsedBy: data.parsedBy || 'fallback',
    telegramStatus: data.telegramStatus || 'not_configured',
    requestId: requestId || null,
    isSeed: data.isSeed || false,
    createdAt: new Date(),
    resolvedAt: null,
  };

  if (mem) {
    mem.tickets.set(requestId || String(ticketNumber), ticket);
    mem.ticketsByNumber.set(ticketNumber, ticket);
    return { ticket, isDuplicate: false };
  }

  try {
    await db.collection('tickets').insertOne(ticket);
    return { ticket, isDuplicate: false };
  } catch (err) {
    // Duplicate key on requestId → return existing
    if (err.code === 11000) {
      const existing = await findByRequestId({ db, mem }, requestId);
      if (existing) return { ticket: existing, isDuplicate: true };
    }
    throw err;
  }
}

// ─── Read tickets ─────────────────────────────────────────────────────────────

async function findByRequestId({ db, mem }, requestId) {
  if (!requestId) return null;
  if (mem) {
    return mem.tickets.get(requestId) || null;
  }
  return db.collection('tickets').findOne({ requestId }, { projection: PUBLIC_FIELDS });
}

export async function getTickets() {
  const { db, mem } = await getDB();

  if (mem) {
    return [...mem.ticketsByNumber.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30)
      .map(safeTicket);
  }

  return db
    .collection('tickets')
    .find({}, { projection: PUBLIC_FIELDS })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
}

export async function getTicketByNumber(ticketNumber) {
  const { db, mem } = await getDB();
  const num = parseInt(ticketNumber, 10);
  if (isNaN(num)) return null;

  if (mem) {
    return mem.ticketsByNumber.get(num) ? safeTicket(mem.ticketsByNumber.get(num)) : null;
  }

  return db.collection('tickets').findOne(
    { ticketNumber: num },
    { projection: PUBLIC_FIELDS }
  );
}

export async function resolveTicket(ticketNumber) {
  const { db, mem } = await getDB();
  const num = parseInt(ticketNumber, 10);
  if (isNaN(num)) return null;

  if (mem) {
    const ticket = mem.ticketsByNumber.get(num);
    if (!ticket) return null;
    ticket.status = 'resolved';
    ticket.resolvedAt = new Date();
    return safeTicket(ticket);
  }

  const result = await db.collection('tickets').findOneAndUpdate(
    { ticketNumber: num },
    { $set: { status: 'resolved', resolvedAt: new Date() } },
    { returnDocument: 'after', projection: PUBLIC_FIELDS }
  );
  return result || null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeTicket(t) {
  const fields = Object.keys(PUBLIC_FIELDS).filter((k) => PUBLIC_FIELDS[k] === 1);
  const result = {};
  for (const f of fields) {
    if (f in t) result[f] = t[f];
  }
  return result;
}

// Update telegram status on an existing ticket (called after alert is sent)
export async function updateTelegramStatus(ticketNumber, telegramStatus) {
  const { db, mem } = await getDB();
  if (mem) {
    const ticket = mem.ticketsByNumber.get(ticketNumber);
    if (ticket) ticket.telegramStatus = telegramStatus;
    return;
  }
  await db.collection('tickets').updateOne(
    { ticketNumber },
    { $set: { telegramStatus } }
  );
}
