/**
 * server/services/fallbackParser.js
 * Rule-based NLU parser. Used when Gemini is not configured or budget exceeded.
 * No external dependencies.
 */

// ─── Keyword maps ─────────────────────────────────────────────────────────────

// Order matters: more specific categories are checked first to avoid false positives.
// safety and library are checked before it/hostel to prevent keyword overlap.
const CATEGORY_KEYWORDS = {
  safety:      ['fire', 'smoke', 'emergency', 'danger', 'threat', 'fight', 'violence', 'eve teasing', 'harassment', 'ragging', 'theft', 'stolen', 'medical emergency', 'injured', 'accident', 'ambulance'],
  library:     ['library', 'reading room', 'journal', 'librarian', 'catalogue', 'borrow'],
  mess:        ['mess', 'canteen', 'cafeteria', 'meal', 'lunch', 'dinner', 'breakfast', 'khana', 'bhojan', 'tiffin', 'cook', 'chef'],
  academics:   ['class', 'lecture', 'professor', 'teacher', 'faculty', 'exam', 'attendance', 'marks', 'grade', 'result', 'certificate', 'syllabus', 'assignment', 'timetable'],
  transport:   ['bus', 'vehicle', 'transport', 'shuttle', 'driver', 'route', 'pickup', 'drop', 'cab', 'auto'],
  maintenance: ['electricity', 'electric', 'light', 'fan', 'ac', 'air conditioning', 'water leakage', 'tap', 'pipe', 'leakage', 'leak', 'repair', 'sewage', 'drain'],
  hostel:      ['hostel', 'dormitory', 'warden', 'bathroom', 'toilet', 'washroom', 'accommodation'],
  it:          ['wifi', 'internet', 'network', 'computer', 'laptop', 'printer', 'projector', 'server', 'portal', 'website', 'software', 'hotspot'],
  food:        ['food', 'khana', 'bhojan', 'menu'],
};

// Safety keywords that force critical priority
const CRITICAL_KEYWORDS = [
  'fire', 'smoke', 'emergency', 'danger', 'threat', 'violence',
  'eve teasing', 'harassment', 'ragging', 'theft', 'stolen',
  'injured', 'accident', 'ambulance', 'medical', 'sos',
  'attacked', 'blood', 'unconscious', 'faint', 'poisoning',
];

// High priority keywords
const HIGH_KEYWORDS = [
  'no water', 'no power', 'power cut', 'power outage', 'flood', 'flooded',
  'sewage overflow', 'gas leak', 'everyone', 'whole block', 'entire',
];

// Status intent patterns
const STATUS_PATTERNS = [
  /status\s+(?:of\s+)?(?:ticket\s+)?(?:number\s+)?([0-9]+)/i,
  /(?:ticket|complaint)\s+(?:number\s+)?([0-9]+)/i,
  /what(?:'s| is)\s+(?:the\s+)?status\s+(?:of\s+)?(?:ticket\s+)?([0-9]+)/i,
  /(?:check|track)\s+(?:ticket\s+)?(?:number\s+)?([0-9]+)/i,
  /update\s+(?:on\s+)?(?:ticket\s+)?([0-9]+)/i,
];

// Cancel patterns
const CANCEL_PATTERNS = [
  /\b(?:cancel|stop|abort|quit|exit|never\s+mind|nevermind|forget\s+it)\b/i,
];

// Spelled-out numbers one..twenty
const SPELLED_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const SPELLED_STATUS_PATTERNS = Object.entries(SPELLED_NUMBERS).map(
  ([word, num]) => ({ word, num, pattern: new RegExp(`\\b${word}\\b`, 'i') })
);

// Location extraction patterns (in/at/near followed by a phrase)
const LOCATION_PATTERNS = [
  /\b(?:in|at|near|inside|outside|behind|beside|next to|front of|front)\s+([a-z0-9 ,'-]{2,50}?)(?:[.,!?]|$)/i,
  /\b(?:block|building|floor|room|gate|section)\s+([a-z0-9 ,'-]{1,30}?)(?:[.,!?]|$)/i,
  /\b([A-Z]\s*block\b[a-z0-9 ,'-]{0,20})/,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectCategory(text) {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      const found = kw.includes(' ') ? lower.includes(kw) : new RegExp('\\\\b' + kw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\  for (const kw of keywords) {
      if (lower.includes(kw)) {') + '\\\\b', 'i').test(lower);
      if (found) {
        // Map 'food' (helper alias) to 'mess'
        return cat === 'food' ? 'mess' : cat;
      }
    }
  }
  return 'other';
}

function detectPriority(text) {
  const lower = text.toLowerCase();
  for (const kw of CRITICAL_KEYWORDS) {
    if (lower.includes(kw)) return 'critical';
  }
  for (const kw of HIGH_KEYWORDS) {
    if (lower.includes(kw)) return 'high';
  }
  return 'medium';
}

function extractLocation(text) {
  for (const pattern of LOCATION_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1]) {
      return m[1].trim().replace(/\s+/g, ' ');
    }
  }
  return null;
}

function extractTicketNumber(text) {
  // Try digit patterns first
  for (const pattern of STATUS_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1]) return parseInt(m[1], 10);
  }

  // Try spelled-out numbers
  const lower = text.toLowerCase();
  if (/\b(?:status|ticket|check|update|track)\b/i.test(lower)) {
    for (const { num, pattern } of SPELLED_STATUS_PATTERNS) {
      if (pattern.test(lower)) return num;
    }
  }

  return null;
}

function detectStatusIntent(text) {
  const lower = text.toLowerCase();
  return /\b(?:status|track|check|where is|update on)\b.*(?:ticket|complaint|issue|my)/i.test(lower) ||
         /(?:ticket|complaint)\s+(?:number\s+)?\d+/i.test(lower);
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse a user utterance with an optional prior draft.
 *
 * @param {string} text - The user's utterance
 * @param {object} draft - Prior conversation state (may be empty {})
 * @returns {{ intent, draft, ticketNumber, reply?, awaiting? }}
 */
export function parse(text, draft = {}) {
  const cleanText = (text || '').trim();

  // ── Cancel intent ──
  if (CANCEL_PATTERNS.some((p) => p.test(cleanText))) {
    return {
      intent: 'cancel',
      draft: {},
      reply: 'Okay, I\'ve cancelled that. Feel free to start a new complaint whenever you\'re ready.',
      awaiting: false,
    };
  }

  // ── Status intent ──
  const ticketNumber = extractTicketNumber(cleanText);
  if (ticketNumber || detectStatusIntent(cleanText)) {
    return {
      intent: 'check_status',
      draft: { ...draft },
      ticketNumber: ticketNumber || null,
    };
  }

  // ── Report issue: multi-turn follow-up for missing location ──
  if (draft.summary && !draft.location) {
    const currentFollowUpCount = draft.followUpCount || 0;

    // If we've already asked twice, give up and default location
    if (currentFollowUpCount >= 1) {
      return {
        intent: 'report_issue',
        draft: {
          ...draft,
          location: 'Not specified',
          followUpCount: currentFollowUpCount + 1,
        },
      };
    }

    // Try to extract location from this utterance
    const extractedLocation = extractLocation(cleanText);
    // Also accept the raw text if it's short enough to be a location
    const fallbackLocation = cleanText.length >= 2 && cleanText.length <= 80 ? cleanText.trim() : null;
    const resolvedLocation = extractedLocation || fallbackLocation;

    // A location is valid if it's at least 3 chars and not just 'hmm', 'ok', etc.
    const meaningless = /^(hmm+|ok|okay|um+|uh+|yes|no|idk|dunno|i don'?t know)$/i;
    const isValidLocation = resolvedLocation && resolvedLocation.length >= 3 && !meaningless.test(resolvedLocation.trim());

    if (isValidLocation) {
      return {
        intent: 'report_issue',
        draft: {
          ...draft,
          location: resolvedLocation,
          followUpCount: currentFollowUpCount + 1,
        },
      };
    }

    // Location still not found — ask again (increment count)
    return {
      intent: 'report_issue',
      draft: { ...draft, followUpCount: currentFollowUpCount + 1 },
      reply: currentFollowUpCount === 0
        ? 'Got it. Where is this happening? Please tell me the block or area.'
        : 'Sorry, I didn\'t catch the location. Could you please say the block or place name?',
      awaiting: true,
    };
  }

  // ── Report issue: fresh complaint ──
  const category = detectCategory(cleanText);
  const priority = detectPriority(cleanText);
  const location = extractLocation(cleanText);

  // Build a clean summary (use the raw text, truncated)
  const summary = cleanText.length > 200 ? cleanText.slice(0, 197) + '...' : cleanText;

  const newDraft = {
    ...draft,
    summary,
    category,
    priority,
    location: location || draft.location || null,
  };

  if (!newDraft.location) {
    return {
      intent: 'report_issue',
      draft: { ...newDraft, followUpCount: 0 },
      reply: 'Got it. Where is this happening? Please tell me the location or block.',
      awaiting: true,
    };
  }

  return {
    intent: 'report_issue',
    draft: newDraft,
  };
}

export default { parse };
