/**
 * server/services/telegram.js
 * Sends plain-text Telegram alerts via Bot API.
 * Awaited before responding to prevent serverless freeze.
 * Failures never fail ticket creation — always returns a status string.
 */

import config from '../config.js';

const TELEGRAM_API = 'https://api.telegram.org';
const TIMEOUT_MS = 4000;

/**
 * Format a ticket into a human-readable Telegram message.
 */
function formatAlert(ticket) {
  const slaText = ticket.slaHours < 24
    ? `${ticket.slaHours} hour(s)`
    : `${ticket.slaHours / 24} day(s)`;

  return [
    `🎙️ CampusVoice Alert — New Ticket #${ticket.ticketNumber}`,
    ``,
    `📋 Issue: ${ticket.summary}`,
    `📍 Location: ${ticket.location}`,
    `🏢 Department: ${ticket.department}`,
    `⚡ Priority: ${ticket.priority.toUpperCase()}`,
    `⏰ SLA: ${slaText}`,
    `🤖 Parsed by: ${ticket.parsedBy}`,
    `🕐 Reported: ${new Date(ticket.createdAt).toUTCString()}`,
  ].join('\n');
}

/**
 * Send a Telegram alert for a new ticket.
 * Returns "sent" | "failed" | "not_configured"
 */
export async function sendAlert(ticket) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return 'not_configured';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${TELEGRAM_API}/bot${config.telegramBotToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
        text: formatAlert(ticket),
        // No parse_mode — plain text only (safe from injection)
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[telegram] Alert failed: ${res.status} ${body}`);
      return 'failed';
    }

    return 'sent';
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[telegram] Alert error:', err.message);
    return 'failed';
  }
}
