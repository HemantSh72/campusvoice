/**
 * server/routes/tickets.js
 * GET /api/tickets — public ticket list
 * POST /api/tickets/:ticketNumber/resolve — admin resolve with PIN
 */

import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { getTickets, resolveTicket } from '../services/tickets.js';
import config from '../config.js';

const router = Router();

// ─── GET /api/tickets ─────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const tickets = await getTickets();
  res.json({ tickets });
});

// ─── POST /api/tickets/:ticketNumber/resolve ──────────────────────────────────

router.post('/:ticketNumber/resolve', async (req, res) => {
  // Resolve endpoint disabled if no ADMIN_PIN configured
  if (!config.adminPin) {
    return res.status(503).json({
      error: 'Resolve endpoint is disabled: ADMIN_PIN is not configured.',
    });
  }

  const submittedPin = req.headers['x-admin-pin'];
  if (typeof submittedPin !== 'string') {
    return res.status(401).json({ error: 'Admin PIN required.' });
  }

  // Constant-time comparison to prevent timing attacks
  const pinMatch = comparePin(submittedPin, config.adminPin);
  if (!pinMatch) {
    return res.status(401).json({ error: 'Invalid PIN.' });
  }

  const { ticketNumber } = req.params;
  const ticket = await resolveTicket(ticketNumber);

  if (!ticket) {
    return res.status(404).json({ error: `Ticket ${ticketNumber} not found.` });
  }

  res.json({ success: true, ticket });
});

// ─── Timing-safe string comparison ───────────────────────────────────────────

function comparePin(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length, 1);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a.slice(0, maxLen));
  bufB.write(b.slice(0, maxLen));
  return timingSafeEqual(bufA, bufB);
}

export default router;
