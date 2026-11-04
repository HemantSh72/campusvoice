/**
 * POST /api/voice — validate, parse, create ticket, and await alert delivery.
 */
import { Router } from 'express';
import { sanitizeTranscript, sanitizeDraft } from '../validate.js';
import { parseWithLLM } from '../services/llm.js';
import { createTicket, getTicketByNumber, updateTelegramStatus } from '../services/tickets.js';
import { sendAlert } from '../services/telegram.js';
import { checkRateLimit, getClientIp } from '../services/rateLimit.js';
import config from '../config.js';

const router = Router();
router.post('/', async (req, res) => {
  try {
    const rate = await checkRateLimit(getClientIp(req));
    if (!rate.allowed) return res.status(429).json({
      error: rate.message || 'Too many requests. Please wait before trying again.',
      retryAfter: rate.retryAfter,
    });
    const transcript = sanitizeTranscript(req.body?.transcript);
    if (!transcript) return res.status(400).json({ error: 'Please say something. Your message was empty.' });
    const draft = sanitizeDraft(req.body?.draft);
    const requestId = typeof req.body?.requestId === 'string' && req.body.requestId.length <= 64
      ? req.body.requestId.trim() || null : null;
    const lang = req.body?.lang === 'hi-IN' ? 'hi-IN' : 'en-IN';
    const parsed = await parseWithLLM(transcript, draft, lang);
    const intent = parsed.intent;
    const nextDraft = parsed.draft || {};

    if (intent === 'cancel') return res.json({
      reply: parsed.reply || "Okay, I've cancelled that. You can start a new complaint whenever you're ready.",
      draft: {}, awaiting: false, parsedBy: parsed.parsedBy,
    });

    if (intent === 'check_status') {
      if (!parsed.ticketNumber) return res.json({
        reply: "I didn't catch the ticket number. Please say something like 'status of ticket 7'.",
        draft: nextDraft, awaiting: false, parsedBy: parsed.parsedBy,
      });
      const ticket = await getTicketByNumber(parsed.ticketNumber);
      if (!ticket) return res.json({
        reply: 'Ticket number ' + parsed.ticketNumber + ' was not found. Please check the number and try again.',
        draft: {}, awaiting: false, parsedBy: parsed.parsedBy,
      });
      const statusReply = 'Ticket ' + ticket.ticketNumber + ' is ' + ticket.status +
        '. It is a ' + ticket.priority + ' priority issue assigned to ' + ticket.department + '. ' +
        (ticket.status === 'open' ? 'SLA: ' + ticket.slaHours + ' hours.' : '');
      return res.json({ reply: statusReply, draft: {}, awaiting: false, parsedBy: parsed.parsedBy, ticket });
    }

    if (intent === 'unknown') return res.json({
      reply: "I didn't understand that. Try reporting a campus issue, asking for a ticket status, or saying cancel.",
      draft: {}, awaiting: false, parsedBy: parsed.parsedBy,
    });

    if (intent !== 'report_issue') return res.json({
      reply: 'Please describe the campus issue you want to report.',
      draft: nextDraft, awaiting: true, parsedBy: parsed.parsedBy,
    });

    if (!nextDraft.summary) return res.json({
      reply: parsed.reply || "I didn't catch the issue. Please describe the campus problem.",
      draft: nextDraft, awaiting: true, parsedBy: parsed.parsedBy,
    });
    if (parsed.awaiting || !nextDraft.location) return res.json({
      reply: parsed.reply || 'Where is this happening? Please tell me the block or area.',
      draft: nextDraft, awaiting: true, parsedBy: parsed.parsedBy,
    });

    const created = await createTicket({
      summary: nextDraft.summary,
      category: nextDraft.category || 'other',
      priority: nextDraft.priority || 'medium',
      location: nextDraft.location,
      reporterName: nextDraft.reporterName || null,
      transcript: transcript.slice(0, 500),
      lang,
      parsedBy: parsed.parsedBy,
      requestId,
    });
    const ticket = created.ticket;
    let telegramStatus = ticket.telegramStatus || 'not_configured';
    if (!created.isDuplicate) {
      telegramStatus = await sendAlert(ticket);
      await updateTelegramStatus(ticket.ticketNumber, telegramStatus);
      ticket.telegramStatus = telegramStatus;
    }
    const priorityText = {
      critical: 'Critical priority with a 2-hour SLA.',
      high: 'High priority with an 8-hour SLA.',
      medium: 'Medium priority with a 24-hour SLA.',
      low: 'Low priority with a 72-hour SLA.',
    }[ticket.priority];
    const alertText = telegramStatus === 'sent' ? ' A Telegram alert was sent.'
      : telegramStatus === 'failed' ? ' Telegram delivery failed; the ticket is still saved.'
      : ' Telegram alerts are not configured.';
    const reply = created.isDuplicate
      ? 'Your complaint was already registered as ticket number ' + ticket.ticketNumber + '.'
      : 'Your complaint has been registered as ticket number ' + ticket.ticketNumber +
        ' and assigned to ' + ticket.department + '. ' + priorityText + alertText;
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
    console.error('[voice] request failed:', error.message);
    if (config.isProduction || error.message?.includes('DATABASE_UNAVAILABLE')) {
      return res.status(503).json({ error: 'CampusVoice is temporarily unavailable because its ticket database cannot be reached. Please try again shortly.' });
    }
    return res.status(500).json({ error: 'Something went wrong while processing your request. Please try again.' });
  }
});
export default router;
