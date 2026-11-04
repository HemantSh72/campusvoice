import { Router } from 'express';
import { getTickets, resolveTicket } from '../services/tickets.js';
import { comparePin } from '../validate.js';
import { checkRateLimit, getClientIp } from '../services/rateLimit.js';
import config from '../config.js';

const router = Router();
router.get('/', async (req, res) => {
  try {
    const tickets = await getTickets();
    return res.json({ tickets });
  } catch (error) {
    console.error('[tickets] list failed:', error.message);
    return res.status(config.isProduction ? 503 : 500).json({
      error: config.isProduction ? 'Ticket database is temporarily unavailable.' : 'Could not load tickets.',
    });
  }
});

router.post('/:ticketNumber/resolve', async (req, res) => {
  try {
    if (!config.adminPin) return res.status(503).json({ error: 'Ticket resolution is disabled because ADMIN_PIN is not configured.' });
    const limit = await checkRateLimit(getClientIp(req));
    if (!limit.allowed) return res.status(429).json({ error: limit.message });
    const submitted = req.headers['x-admin-pin'];
    if (!comparePin(submitted, config.adminPin)) return res.status(401).json({ error: 'Invalid PIN.' });
    const number = Number.parseInt(req.params.ticketNumber, 10);
    if (!Number.isSafeInteger(number) || number < 1) return res.status(400).json({ error: 'Invalid ticket number.' });
    const ticket = await resolveTicket(number);
    if (!ticket) return res.status(404).json({ error: 'Ticket ' + number + ' was not found.' });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error('[tickets] resolve failed:', error.message);
    return res.status(config.isProduction ? 503 : 500).json({
      error: config.isProduction ? 'Ticket database is temporarily unavailable.' : 'Could not resolve this ticket.',
    });
  }
});
export default router;
