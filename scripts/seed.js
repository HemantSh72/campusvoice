/**
 * Idempotently seed three sample tickets for a demo environment.
 * Run with: npm run seed
 */
import { getDB } from '../server/db.js';
import { createTicket } from '../server/services/tickets.js';

const samples = [
  { summary: 'WiFi connectivity is unavailable in hostel block B', category: 'it', priority: 'high', location: 'Hostel block B' },
  { summary: 'Water leakage reported near the library entrance', category: 'maintenance', priority: 'medium', location: 'Library entrance' },
  { summary: 'Campus shuttle is consistently delayed', category: 'transport', priority: 'medium', location: 'Main gate bus stop' },
];

const { db, mem } = await getDB();
if (mem) {
  console.log('Seed skipped: the in-memory store is process-local and cannot persist after this script exits. Set MONGODB_URI to seed persistent demo tickets.');
  process.exit(0);
}
const existing = await db.collection('tickets').countDocuments({ isSeed: true });
if (existing >= 3) {
  console.log('Seed skipped: three or more sample tickets already exist.');
  process.exit(0);
}
for (let i = 0; i < samples.length; i += 1) {
  const sample = samples[i];
  const requestId = `campusvoice-seed-${i + 1}`;
  await createTicket({ ...sample, requestId, parsedBy: 'seed', telegramStatus: 'not_configured', transcript: sample.summary, isSeed: true });
}
console.log('Seed complete: three sample tickets are available.');
