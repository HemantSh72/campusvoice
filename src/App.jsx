import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useTTS } from './hooks/useTTS.js';

const EXAMPLES = [
  'WiFi is not working in hostel block B',
  'There is water leakage near the library',
  'The campus bus is always late',
  'What is the status of ticket 7?',
];
const friendlySpeechErrors = {
  unsupported: 'Voice recognition is not supported here. You can type your message below.',
  'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings, then try again.',
  'service-not-allowed': 'This browser or page is not allowed to use the microphone. Use typed input instead.',
  'no-speech': 'I did not hear anything. Please try speaking again.',
  'audio-capture': 'No microphone was detected. Connect or enable a microphone, or type your message.',
  network: 'The browser speech service had a network problem. Please try again or type your message.',
  aborted: 'Voice input was stopped.',
  'start-failed': 'The microphone could not be started. Check browser permissions and try again.',
};

async function fetchJson(url, options = {}, timeout = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Request failed with status ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function statusClass(value) {
  if (['mongo', 'configured', 'supported', 'ok'].includes(value)) return 'ok';
  if (['down', 'failed', 'unsupported'].includes(value)) return 'down';
  return 'warn';
}

function StatusBadge({ label, value, detail }) {
  return <span className={`status-badge ${statusClass(value)}`} title={detail || value}>
    <span className="status-dot" />{label}: {detail || value}
  </span>;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function App() {
  const [lang, setLang] = useState('en-IN');
  const [draft, setDraft] = useState({});
  const [reply, setReply] = useState('Tap the microphone or type below to report a campus issue. You can also ask for a ticket status.');
  const [typed, setTyped] = useState('');
  const [lastTranscript, setLastTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [dashboardError, setDashboardError] = useState('');
  const [retryPayload, setRetryPayload] = useState(null);
  const speech = useSpeechRecognition();
  const tts = useTTS();
  const submitRef = useRef(null);
  const hiddenRef = useRef(false);

  const speakReply = useCallback(async (text) => {
    if (tts.supported) await tts.speak(text, 'en-IN');
  }, [tts]);

  const submitTranscript = useCallback(async (transcript, reuseRequestId = null) => {
    const clean = String(transcript || '').trim();
    if (!clean || busy) return;
    speech.stop();
    tts.stop();
    setBusy(true);
    setError('');
    setLastTranscript(clean);
    const requestId = reuseRequestId || globalThis.crypto?.randomUUID?.() || `cv-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = { transcript: clean, draft, lang, requestId };
    setRetryPayload(payload);
    let shouldListenAgain = false;
    try {
      const data = await fetchJson('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setReply(data.reply || 'Your request was processed.');
      setDraft(data.draft || {});
      setAwaiting(Boolean(data.awaiting));
      setLastTicket(data.ticket || null);
      setRetryPayload(null);
      shouldListenAgain = Boolean(data.awaiting && speech.supported);
      await speakReply(data.reply || 'Your request was processed.');
    } catch (cause) {
      let message;
      if (cause.name === 'AbortError') message = 'The request took too long. Check your connection and retry.';
      else if (cause.status === 429) message = cause.message || 'Too many requests. Please wait before trying again.';
      else if (cause.status >= 500) message = cause.message || 'CampusVoice is temporarily unavailable. Please try again shortly.';
      else if (cause.status) message = cause.message;
      else message = 'Could not connect to CampusVoice. Check your internet connection and retry.';
      setError(message);
      setReply(message);
      await speakReply(message);
    } finally {
      setBusy(false);
      setTyped('');
    }
    if (shouldListenAgain && !hiddenRef.current) {
      speech.start(lang, (nextText) => submitRef.current?.(nextText));
    }
  }, [busy, draft, lang, speech, tts, speakReply]);

  useEffect(() => { submitRef.current = submitTranscript; }, [submitTranscript]);

  const startListening = () => {
    if (busy || tts.speaking || !speech.supported) return;
    tts.stop();
    setError('');
    speech.start(lang, (text) => submitRef.current?.(text));
  };

  const stopAll = () => {
    speech.stop();
    tts.stop();
  };

  const submitTyped = (event) => {
    event.preventDefault();
    submitTranscript(typed);
  };

  const retry = () => {
    if (retryPayload) submitTranscript(retryPayload.transcript, retryPayload.requestId);
  };

  const loadHealth = useCallback(async () => {
    try {
      const data = await fetchJson('/api/health', {}, 5000);
      setHealth(data);
    } catch {
      setHealth({ ok: false, db: 'down', llm: 'unknown', telegram: 'unknown' });
    }
  }, []);

  const loadTickets = useCallback(async () => {
    try {
      const data = await fetchJson('/api/tickets', {}, 7000);
      setTickets(data.tickets || []);
      setDashboardError('');
    } catch {
      setDashboardError('Ticket dashboard is temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    loadHealth();
    loadTickets();
    const healthTimer = setInterval(loadHealth, 30_000);
    const ticketTimer = setInterval(() => {
      if (!document.hidden) loadTickets();
    }, 5000);
    const onVisibility = () => {
      hiddenRef.current = document.hidden;
      if (!document.hidden) { loadHealth(); loadTickets(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(healthTimer);
      clearInterval(ticketTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadHealth, loadTickets]);

  const resolve = async (ticketNumber) => {
    const pin = window.prompt(`Enter admin PIN to resolve ticket #${ticketNumber}:`);
    if (pin === null) return;
    try {
      await fetchJson(`/api/tickets/${ticketNumber}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
        body: '{}',
      });
      setReply(`Ticket ${ticketNumber} has been marked resolved.`);
      await loadTickets();
    } catch (cause) {
      const message = cause.status === 401 ? 'The admin PIN is incorrect.' : cause.message || 'Could not resolve this ticket.';
      setError(message);
      setReply(message);
      await speakReply(message);
    }
  };

  const statusText = busy ? 'Thinking…'
    : speech.listening ? 'Listening — speak now'
    : tts.speaking ? 'Speaking response…'
    : error ? 'Needs attention'
    : 'Ready when you are';

  const dbValue = health?.db || 'checking';
  const llmValue = health?.llm || 'checking';
  const telegramValue = health?.telegram || 'checking';

  return (
    <div className="app">
      <header className="app-header">
        <h1>CampusVoice</h1>
        <p>Your campus grievance desk. Speak naturally — we’ll route the issue.</p>
      </header>

      <main className="app-main">
        <section className="card" aria-label="System status">
          <h2 className="card-title">Live system status</h2>
          <div className="status-strip">
            <StatusBadge label="Microphone" value={speech.supported ? 'supported' : 'unsupported'} detail={speech.supported ? 'Browser voice ready' : 'Use typed input'} />
            <StatusBadge label="AI" value={llmValue} detail={llmValue === 'configured' ? 'Gemini model chain' : 'Rules fallback'} />
            <StatusBadge label="Database" value={dbValue} detail={dbValue === 'mongo' ? 'MongoDB connected' : dbValue === 'memory' ? 'Local memory only' : dbValue === 'down' ? 'Database unavailable' : 'Checking'} />
            <StatusBadge label="Telegram" value={telegramValue} detail={telegramValue === 'configured' ? 'Alerts configured' : 'Alerts not configured'} />
          </div>
          {health?.modelChain && <p className="status-detail mt-1">Model chain: {Object.entries(health.modelChain).map(([name, state]) => `${name}: ${state.reason}`).join(' · ')}</p>}
        </section>

        <section className="card mic-section" aria-label="Voice complaint">
          <div className="lang-toggle" aria-label="Speech language">
            <span>Recognition language</span>
            <button className={lang === 'en-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('en-IN')} type="button">English</button>
            <button className={lang === 'hi-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('hi-IN')} type="button">हिन्दी</button>
          </div>
          <div className="mic-button-wrap">
            <div className={`mic-ring ${speech.listening ? 'listening' : tts.speaking ? 'speaking' : ''}`} />
            <button
              className={`mic-button ${speech.listening ? 'listening' : busy ? 'thinking' : tts.speaking ? 'speaking' : error ? 'error' : 'idle'}`}
              type="button"
              onClick={speech.listening || tts.speaking ? stopAll : startListening}
              disabled={busy || (!speech.supported && !tts.speaking)}
              aria-label={speech.listening || tts.speaking ? 'Stop' : 'Start voice input'}
            >{speech.listening || tts.speaking ? '■' : '🎙️'}</button>
          </div>
          <p className="mic-state-label" aria-live="polite">{statusText}</p>
          {(speech.listening || tts.speaking) && <button className="stop-button" type="button" onClick={stopAll}>Stop</button>}
          {!speech.supported && <div className="unsupported-banner">Voice recognition is unavailable in this browser. Type your message below. Voice replies may still work.</div>}
          {speech.error && <div className="warning-banner" role="status">{friendlySpeechErrors[speech.error] || 'The microphone could not be used. Check permissions or type your message.'}</div>}
          <div className="transcript-display" aria-live="polite">
            {lastTranscript && <p className="transcript-final">You said: {lastTranscript}</p>}
            {speech.interimTranscript && <p className="transcript-interim">{speech.interimTranscript}</p>}
          </div>
        </section>

        {(draft.summary || awaiting) && <section className="card">
          <h2 className="card-title">Ticket draft</h2>
          <div className="draft-card">
            <div className="draft-field"><label>Issue summary</label><value>{draft.summary || 'Waiting for issue description'}</value></div>
            <div className="draft-field"><label>Location</label><value className={!draft.location ? 'empty' : ''}>{draft.location || 'Please provide the location'}</value></div>
            <div className="draft-field"><label>Department</label><value>{draft.category || 'To be determined'}</value></div>
            <div className="draft-field"><label>Priority</label><value>{draft.priority || 'To be determined'}</value></div>
          </div>
        </section>}

        <section className="card">
          <h2 className="card-title">Assistant reply</h2>
          <div className="reply-bubble" aria-live="polite"><span className="reply-icon">💬</span><p>{reply}</p></div>
          {lastTicket && <div className="draft-card mt-2">
            <div className="draft-field"><label>Ticket number</label><value>#{lastTicket.ticketNumber}</value></div>
            <div className="draft-field"><label>Status</label><value>{lastTicket.status || 'open'}</value></div>
            <div className="draft-field"><label>Department</label><value>{lastTicket.department}</value></div>
            <div className="draft-field"><label>Priority / SLA</label><value>{lastTicket.priority} · {lastTicket.slaHours}h</value></div>
          </div>}
        </section>

        <section className="card">
          <h2 className="card-title">Type a complaint or status question</h2>
          <form className="typed-input-wrap" onSubmit={submitTyped}>
            <input className="typed-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="e.g. WiFi is down in block A…" aria-label="Type your message" />
            <button className="send-btn" type="submit" disabled={!typed.trim() || busy}>Send</button>
          </form>
          {error && <div className="error-banner mt-2" role="alert">{error}{retryPayload && <button className="retry-btn" type="button" onClick={retry}>Retry same request</button>}</div>}
          <h3 className="card-title mt-2">Try saying (or tap to submit)</h3>
          <div className="chips-wrap">{EXAMPLES.map((example) => <button className="chip" type="button" key={example} disabled={busy} onClick={() => submitTranscript(example)}>{example}</button>)}</div>
        </section>

        <section className="card" aria-label="Ticket dashboard">
          <div className="dashboard-header">
            <h2 className="card-title">Live ticket dashboard</h2>
            <div className="dashboard-actions">
              <button className="stop-button" type="button" onClick={loadTickets}>Refresh</button>
              {import.meta.env.VITE_TELEGRAM_CHANNEL_URL && <a className="tg-btn" href={import.meta.env.VITE_TELEGRAM_CHANNEL_URL} target="_blank" rel="noreferrer">Watch live alerts ↗</a>}
            </div>
          </div>
          {dashboardError && <div className="warning-banner">{dashboardError}</div>}
          {!tickets.length && !dashboardError ? <p className="tickets-empty">No tickets yet. Report an issue to create the first ticket.</p> : <div className="tickets-list">
            {tickets.map((ticket) => <article className={`ticket-row priority-${ticket.priority} ${ticket.status === 'resolved' ? 'resolved' : ''}`} key={ticket.ticketNumber}>
              <div className="ticket-num">#{ticket.ticketNumber}</div>
              <div className="ticket-body">
                <p className="ticket-summary">{ticket.summary}</p>
                <div className="ticket-meta">
                  <span className="ticket-tag">{ticket.department}</span>
                  <span className="ticket-tag">{ticket.location}</span>
                  <span className={`ticket-tag priority-${ticket.priority}`}>{ticket.priority}</span>
                  <span className="ticket-tag">{ticket.slaHours}h SLA</span>
                  <span className={`ticket-tag ${ticket.telegramStatus === 'sent' ? 'tg-sent' : ticket.telegramStatus === 'failed' ? 'tg-failed' : 'tg-nc'}`}>Telegram: {ticket.telegramStatus || 'unknown'}</span>
                  <span className="ticket-tag">{formatDate(ticket.createdAt)}</span>
                </div>
              </div>
              <div className="ticket-actions">
                {ticket.status === 'resolved' ? <span className="resolved-badge">Resolved</span> : <button className="resolve-btn" type="button" onClick={() => resolve(ticket.ticketNumber)} disabled={health?.adminPin === 'not_configured'}>Resolve</button>}
              </div>
            </article>)}
          </div>}
        </section>
      </main>

      <footer className="app-footer">
        Speech recognition and voice replies run in your browser. Ticket creation uses the CampusVoice API; Gemini, MongoDB and Telegram are real integrations only when their status is configured. Without credentials, local development uses rule-based parsing and memory storage. This demo is not for emergencies.
      </footer>
    </div>
  );
}
