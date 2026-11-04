/**
 * server/routes/voice.js
 * POST /api/voice — main voice pipeline endpoint.
 */

import { Router } from 'express';
import { sanitizeTranscript, sanitizeDraft, getDepartment, getSlaHours } from '../validate.js';
import { parse as fallbackParse } from '../services/fallbackParser.js';
import { parseWithLLM } from '../services/llm.js';
import { createTicket, getTicketByNumber, updateTelegramStatus } from '../services/tickets.js';
import { sendAlert } from '../services/telegram.js';
import { checkRateLimit, getClientIp } from '../services/rateLimit.js';
import config from '../config.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    // ── Rate limiting ──
    const ip = getClientIp(req);
    const rl = await checkRateLimit(ip);
    if (!rl.allowed) {
      return res.status(429).json({
        error: rl.message || 'Too many requests. Please wait before trying again.',
        retryAfter: rl.retryAfter,
      });
    }

    // ── Input validation ──
    const rawTranscript = req.body?.transcript;
    const transcript = sanitizeTranscript(rawTranscript);
    if (!transcript) {
      return res.status(400).json({
        error: 'Please say something. Your message was empty.',
      });
    }

    const draft = sanitizeDraft(req.body?.draft);
    const requestId = typeof req.body?.requestId === 'string'
      ? req.body.requestId.slice(0, 64)
      : null;
    const lang = typeof req.body?.lang === 'string'
      ? req.body.lang.slice(0, 20)
      : 'en-IN';

    // ── LLM / fallback parsing ──
    const parsed = await parseWithLLM(transcript, draft, lang);
    const { intent, parsedBy } = parsed;
    const newDraft = parsed.draft || {};

    // ── Handle intents ──

    // Cancel intent
    if (intent === 'cancel') {
      return res.json({
        reply: parsed.reply || "Okay, I've cancelled that. Feel free to start a new complaint whenever you're ready.",
        draft: {},
        awaiting: false,
        parsedBy,
      });
    }

    // Status query intent
    if (intent === 'check_status') {
      const ticketNum = parsed.ticketNumber;
      if (!ticketNum) {
        return res.json({
          reply: "I didn't catch the ticket number. Please say something like 'status of ticket 7'.",
          draft: newDraft,
          awaiting: false,
          parsedBy,
        });
      }

      const ticket = await getTicketByNumber(ticketNum);
      if (!ticket) {
        return res.json({
          reply: `Ticket number ${ticketNum} was not found. Please check the number and try again.`,
          draft: newDraft,
          awaiting: false,
          parsedBy,
        });
      }

      const statusMsg = ticket.status === 'resolved'
        ? `resolved`
        : `still open`;
      const reply = `Ticket ${ticketNum} is ${statusMsg}. It's a ${ticket.priority} priority ${ticket.category} issue assigned to ${ticket.department}. ${ticket.status === 'open' ? `SLA: ${ticket.slaHours} hours.` : ''}`.trim();

      return res.json({
        reply,
        draft: newDraft,
        awaiting: false,
        parsedBy,
        ticket,
      });
    }

    // Unknown intent
    if (intent === 'unknown') {
      return res.json({
        reply: "I'm sorry, I didn't understand that. You can report an issue, check a ticket status, or say 'cancel' to start over.",
        draft: newDraft,
        awaiting: false,
        parsedBy,
      });
    }

    // Report issue intent
    if (intent === 'report_issue') {
      // If the parser is asking a follow-up question, relay it
      if (parsed.awaiting) {
        return res.json({
          reply: parsed.reply || 'Could you please provide more details?',
          draft: newDraft,
          awaiting: true,
          parsedBy,
        });
      }

      // Check if we have minimum required fields
      if (!newDraft.summary) {
        return res.json({
          reply: "I didn't catch what the issue is. Could you please describe your complaint?",
          draft: newDraft,
          awaiting: true,
          parsedBy,
        });
      }

      // Location still missing after multi-turn → default
      if (!newDraft.location) {
        newDraft.location = 'Not specified';
      }

      // ── Create ticket ──
      const { ticket, isDuplicate } = await createTicket({
        summary: newDraft.summary,
        category: newDraft.category || 'other',
        priority: newDraft.priority || 'medium',
        location: newDraft.location,
        reporterName: newDraft.reporterName || null,
        transcript: transcript.slice(0, 500),
        lang,
        parsedBy,
        requestId,
      });

      // ── Send Telegram alert (awaited before responding) ──
      let telegramStatus = ticket.telegramStatus;
      if (!isDuplicate) {
        telegramStatus = await sendAlert(ticket);
        // Update telegram status in DB (non-blocking on failure)
        updateTelegramStatus(ticket.ticketNumber, telegramStatus).catch(() => {});
        ticket.telegramStatus = telegramStatus;
      }

      const priorityPhrases = {
        critical: 'This is flagged as CRITICAL priority with a 2-hour SLA.',
        high: 'This is high priority with an 8-hour SLA.',
        medium: 'This is medium priority with a 24-hour SLA.',
        low: 'This is low priority with a 72-hour SLA.',
      };

      const alertPart = telegramStatus === 'sent'
        ? ' An alert has been sent to the department.'
        : telegramStatus === 'failed'
          ? ' Note: the alert could not be sent right now.'
          : '';

      const reply = isDuplicate
        ? `Your complaint was already registered as ticket number ${ticket.ticketNumber}.`
        : `Your complaint has been registered as ticket number ${ticket.ticketNumber}. It has been sent to ${ticket.department}. ${priorityPhrases[ticket.priority] || ''}${alertPart}`;

      return res.json({
        reply,
        draft: {},
        awaiting: false,
        parsedBy,
        telegramStatus,
        ticket: {
          ticketNumber: ticket.ticketNumber,
          summary: ticket.summary,
          category: ticket.category,
          department: ticket.department,
          priority: ticket.priority,
          slaHours: ticket.slaHours,
          location: ticket.location,
          status: ticket.status,
          createdAt: ticket.createdAt,
          telegramStatus: ticket.telegramStatus,
        },
      });
    }

    // Fallthrough
    return res.json({
      reply: "I'm not sure what to do with that. Try saying 'WiFi is down in block A' or 'status of ticket 5'.",
      draft: newDraft,
      awaiting: false,
      parsedBy,
    });
  } catch (err) {
    // Production guard: DB unavailable
    if (err.message?.includes('MONGODB_URI')) {
      return res.status(503).json({
        error: 'The service is temporarily unavailable. Please try again in a few minutes.',
      });
    }
    throw err; // Let the global error handler handle it
  }
});

export default router;
