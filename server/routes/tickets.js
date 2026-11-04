/**
 * Public ticket listing and PIN-protected resolution endpoint.
 */
import { Router } from 'express';
import { comparePin } from '../validate.js';
import { getTickets, resolveTicket } from '../services/tickets.js';
import config from '../config.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try { res.json({ tickets: await getTickets() }); }
  catch (error) { next(error); }
});

router.post('/:ticketNumber/resolve', async (req, res, next) => {
  try {
    if (!config.adminPin) return res.status(503).json({ error: 'Ticket resolution is disabled because the admin PIN is not configured.' });
    const submitted = req.headers['x-admin-pin'];
    if (!comparePin(submitted, config.adminPin)) return res.status(401).json({ error: 'Invalid or missing admin PIN.' });
    const ticket = await resolveTicket(req.params.ticketNumber);
    if (!ticket) return res.status(404).json({ error: `Ticket ${req.params.ticketNumber} was not found.` });
    res.json({ success: true, ticket });
  } catch (error) { next(error); }
});

export default router;
