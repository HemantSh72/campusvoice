/**
 * POST /api/voice — speech/text intake pipeline.
 */
import { Router } from 'express';
import { sanitizeTranscript, sanitizeDraft } from '../validate.js';
import { parseWithLLM } from '../services/llm.js';
import { createTicket, getTicketByNumber, updateTelegramStatus } from '../services/tickets.js';
import { sendAlert } from '../services/telegram.js';
import { checkRateLimit, getClientIp } from '../services/rateLimit.js';
import config from '../config.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const ip = getClientIp(req);
    const rate = await checkRateLimit(ip);
    if (!rate.allowed) return res.status(429).json({ error: rate.message, retryAfter: rate.retryAfter });

    const transcript = sanitizeTranscript(req.body?.transcript);
    if (!transcript) return res.status(400).json({ error: 'Please say or type something before submitting.' });

    const draft = sanitizeDraft(req.body?.draft);
    const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.length <= 100 ? req.body.requestId : null;
    const lang = req.body?.lang === 'hi-IN' ? 'hi-IN' : 'en-IN';

    let parsed;
    try {
      parsed = await parseWithLLM(transcript, draft, lang);
    } catch (error) {
      console.warn('[voice] Parser degraded to fallback:', error.message);
      parsed = { intent: 'report_issue', draft: { ...draft }, parsedBy: 'fallback' };
    }
    const intent = parsed.intent || 'unknown';
    const nextDraft = parsed.draft || {};

    if (intent === 'cancel') {
      return res.json({ reply: 'Okay, I cancelled that. You can start a new complaint whenever you are ready.', draft: {}, awaiting: false, parsedBy: parsed.parsedBy });
    }

    if (intent === 'check_status') {
      const number = parsed.ticketNumber;
      if (!number) return res.json({ reply: "I didn't catch the ticket number. Please say, for example, status of ticket 7.", draft: {}, awaiting: false, parsedBy: parsed.parsedBy });
      const ticket = await getTicketByNumber(number);
      if (!ticket) return res.json({ reply: `Ticket ${number} was not found. Please check the number and try again.`, draft: {}, awaiting: false, parsedBy: parsed.parsedBy });
      const state = ticket.status === 'resolved' ? 'resolved' : 'still open';
      const reply = `Ticket ${number} is ${state}. It is a ${ticket.priority} priority issue assigned to ${ticket.department}. ${ticket.status === 'open' ? `The SLA is ${ticket.slaHours} hours.` : ''}`;
      return res.json({ reply, draft: {}, awaiting: false, parsedBy: parsed.parsedBy, ticket });
    }

    if (intent === 'unknown') {
      return res.json({ reply: "I didn't understand. Describe a campus issue, ask for a ticket status, or say cancel.", draft: {}, awaiting: false, parsedBy: parsed.parsedBy });
    }

    if (!nextDraft.summary) {
      return res.json({ reply: 'Please describe the campus issue first.', draft: nextDraft, awaiting: true, parsedBy: parsed.parsedBy });
    }
    if (parsed.awaiting || !nextDraft.location) {
      const attempts = Number(nextDraft.followUpCount) || 0;
      if (attempts < 2) {
        return res.json({
          reply: parsed.reply || (attempts === 0 ? 'Where is this happening? Please tell me the block, room or area.' : 'I still need the location. Which block or area is affected?'),
          draft: { ...nextDraft, followUpCount: attempts + (parsed.awaiting ? 0 : 1) },
          awaiting: true,
          parsedBy: parsed.parsedBy,
        });
      }
      nextDraft.location = 'Not specified';
    }

    const { ticket, isDuplicate } = await createTicket({
      summary: nextDraft.summary,
      category: nextDraft.category || 'other',
      priority: nextDraft.priority || 'medium',
      location: nextDraft.location || 'Not specified',
      reporterName: nextDraft.reporterName,
      transcript,
      lang,
      parsedBy: parsed.parsedBy || 'fallback',
      requestId,
    });

    let telegramStatus = ticket.telegramStatus;
    if (!isDuplicate) {
      telegramStatus = await sendAlert(ticket);
      await updateTelegramStatus(ticket.ticketNumber, telegramStatus);
      ticket.telegramStatus = telegramStatus;
    }
    const priority = { critical: 'critical priority (2-hour SLA)', high: 'high priority (8-hour SLA)', medium: 'medium priority (24-hour SLA)', low: 'low priority (72-hour SLA)' };
    const alert = telegramStatus === 'sent' ? ' A Telegram alert was sent.' : telegramStatus === 'failed' ? ' The alert could not be delivered right now.' : ' Telegram alerts are not configured.';
    const reply = isDuplicate
      ? `This request was already registered as ticket ${ticket.ticketNumber}.`
      : `Your complaint is registered as ticket ${ticket.ticketNumber}, assigned to ${ticket.department}, with ${priority[ticket.priority] || 'medium priority'}.${alert}`;

    return res.json({
      reply, draft: {}, awaiting: false, parsedBy: parsed.parsedBy, telegramStatus,
      ticket: {
        ticketNumber: ticket.ticketNumber, summary: ticket.summary, category: ticket.category,
        department: ticket.department, priority: ticket.priority, slaHours: ticket.slaHours,
        location: ticket.location, status: ticket.status, createdAt: ticket.createdAt,
        telegramStatus: ticket.telegramStatus,
      },
    });
  } catch (error) {
    if (config.isProduction && (!config.mongoUri || /database unavailable|MongoServerSelectionError|timed out/i.test(error.message))) {
      return res.status(503).json({ error: 'CampusVoice is temporarily unavailable because its database cannot be reached. Please try again shortly.' });
    }
    next(error);
  }
});

export default router;
