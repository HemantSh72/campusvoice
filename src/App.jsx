import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useTTS } from './hooks/useTTS.js';

const EXAMPLES = [
  'WiFi is not working in hostel block B',
  'There is water leakage near the library',
  'The campus bus is always late',
  'What is the status of ticket 7?',
];
const FRIENDLY_SPEECH_ERRORS = {
  'not-allowed': 'Microphone access was denied. Allow microphone access in your browser settings, or type your complaint below.',
  'service-not-allowed': 'This browser does not allow speech recognition here. You can type your complaint below.',
  'no-speech': 'I did not hear anything. Please try speaking again, or type your complaint.',
  'audio-capture': 'I could not find an available microphone. Check your microphone connection or type your complaint.',
  network: 'Speech recognition could not connect. Check your internet connection or type your complaint.',
  aborted: 'Voice input was stopped.',
  'start-failed': 'I could not start the microphone. Check browser permissions or type your complaint.',
};

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
function statusClass(value) {
  if (['mongo', 'configured', 'sent', 'supported'].includes(value)) return 'ok';
  if (['down', 'failed', 'unsupported'].includes(value)) return 'down';
  return 'warn';
}

export default function App() {
  const [lang, setLang] = useState('en-IN');
  const [draft, setDraft] = useState({});
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('Tap the microphone and describe your campus issue. You can also type below.');
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [autoListen, setAutoListen] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [failedTranscript, setFailedTranscript] = useState('');
  const [apiError, setApiError] = useState('');
  const [health, setHealth] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [dashboardError, setDashboardError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const pendingRequest = useRef(null);
  const speech = useSpeechRecognition();
  const { supported: ttsSupported, speaking: ttsSpeaking, speak, stop: stopTTS } = useTTS();

  const submitTranscript = useCallback(async (value) => {
    const clean = String(value || '').trim();
    if (!clean || busy) return;
    if (!pendingRequest.current || pendingRequest.current.transcript !== clean) {
      pendingRequest.current = { transcript: clean, requestId: newRequestId() };
    }
    const requestId = pendingRequest.current.requestId;
    speech.stop();
    stopTTS();
    setBusy(true);
    setMessage(clean);
    setApiError('');
    setAutoListen(false);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try {
        response = await fetch('/api/voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: clean, draft, requestId, lang }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeout); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) throw new Error(data.error || 'Too many requests. Please wait and try again.');
        if (response.status >= 500) throw new Error(data.error || 'CampusVoice is temporarily unavailable. Please try again shortly.');
        throw new Error(data.error || 'Your message could not be processed. Please try again.');
      }
      const spokenReply = data.reply || 'Your request was processed.';
      setReply(spokenReply);
      setDraft(data.draft || {});
      setAwaiting(Boolean(data.awaiting));
      setLastTicket(data.ticket || null);
      setFailedTranscript('');
      pendingRequest.current = null;
      await speak(spokenReply, 'en-IN');
      if (data.awaiting) setAutoListen(true);
    } catch (error) {
      const friendly = error.name === 'AbortError'
        ? 'The request took too long. Check your connection and retry.'
        : (error.message || 'Could not reach CampusVoice. Please try again.');
      setApiError(friendly);
      setReply(friendly);
      setFailedTranscript(clean);
      await speak(friendly, 'en-IN');
    } finally {
      setBusy(false);
    }
  }, [busy, draft, lang, speak, speech.stop, stopTTS]);

  useEffect(() => {
    if (!autoListen || busy || ttsSpeaking || !speech.supported) return;
    setAutoListen(false);
    speech.start(lang, submitTranscript);
  }, [autoListen, busy, ttsSpeaking, speech.supported, speech.start, lang, submitTranscript]);

  useEffect(() => {
    if (!speech.error || speech.error === 'aborted') return;
    const friendly = FRIENDLY_SPEECH_ERRORS[speech.error] || 'Microphone input failed. Please try again or type your complaint.';
    setReply(friendly);
    speak(friendly, 'en-IN');
  }, [speech.error, speak]);

  const startListening = () => {
    if (busy || ttsSpeaking) return;
    stopTTS();
    speech.start(lang, submitTranscript);
  };
  const submitTyped = (event) => {
    event.preventDefault();
    if (typed.trim()) submitTranscript(typed);
    setTyped('');
  };

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (!response.ok) throw new Error('Health check unavailable');
      setHealth(await response.json());
    } catch { setHealth({ ok: false, db: 'down', llm: 'unknown', telegram: 'unknown' }); }
  }, []);
  const loadTickets = useCallback(async () => {
    try {
      const response = await fetch('/api/tickets', { cache: 'no-store' });
      if (!response.ok) throw new Error('Ticket dashboard unavailable');
      const data = await response.json();
      setTickets(Array.isArray(data.tickets) ? data.tickets : []);
      setDashboardError('');
      setLastUpdated(new Date());
    } catch (error) { setDashboardError(error.message || 'Could not load tickets.'); }
  }, []);

  useEffect(() => {
    loadHealth();
    loadTickets();
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        loadHealth();
        loadTickets();
      }
    };
    const interval = setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadHealth, loadTickets]);

  const resolve = async (ticketNumber) => {
    const pin = window.prompt('Enter admin PIN to resolve ticket #' + ticketNumber);
    if (pin === null) return;
    if (!pin.trim()) { setDashboardError('Admin PIN cannot be empty.'); return; }
    try {
      const response = await fetch('/api/tickets/' + ticketNumber + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not resolve ticket.');
      await loadTickets();
    } catch (error) { setDashboardError(error.message || 'Could not resolve ticket.'); }
  };

  const aiLabel = health?.llm === 'configured' ? 'Gemini configured' : 'Rule-based fallback';
  const dbLabel = health?.db || 'checking';
  const telegramLabel = health?.telegram === 'configured' ? 'Telegram configured' : 'Telegram not configured';
  const telegramUrl = import.meta.env.VITE_TELEGRAM_CHANNEL_URL;

  return (
    <div className="app">
      <header className="app-header">
        <h1>CampusVoice</h1>
        <p>Your campus grievance desk. Speak naturally — we’ll route the issue.</p>
      </header>

      <main className="app-main">
        <section className="card" aria-label="System status">
          <h2 className="card-title">System status</h2>
          <div className="status-strip" aria-live="polite">
            <span className={'status-badge ' + statusClass(speech.supported ? 'supported' : 'unsupported')}>
              <span className="status-dot" /> Mic {speech.supported ? 'supported in this browser' : 'not supported'}
            </span>
            <span className={'status-badge ' + statusClass(health?.llm === 'configured' ? 'configured' : 'fallback')}>
              <span className="status-dot" /> {aiLabel}
            </span>
            <span className={'status-badge ' + statusClass(dbLabel)}>
              <span className="status-dot" /> Database: {dbLabel}
            </span>
            <span className={'status-badge ' + statusClass(health?.telegram === 'configured' ? 'configured' : 'not_configured')}>
              <span className="status-dot" /> {telegramLabel}
            </span>
          </div>
          {health?.modelChain?.length > 0 && (
            <p className="muted-small mt-1">Model chain: {health.modelChain.map((model) => model.model + ' (' + model.status + ')').join(' → ')}</p>
          )}
        </section>

        <section className="card mic-section" aria-label="Voice complaint">
          <div className="lang-toggle" aria-label="Speech language">
            <span>Speak in</span>
            <button className={lang === 'en-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('en-IN')} type="button">English</button>
            <button className={lang === 'hi-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('hi-IN')} type="button">हिन्दी</button>
          </div>
          <div className="mic-button-wrap">
            <div className={'mic-ring ' + (speech.listening ? 'listening' : ttsSpeaking ? 'speaking' : '')} />
            <button
              className={'mic-button ' + (apiError || speech.error ? 'error' : speech.listening ? 'listening' : busy ? 'thinking' : ttsSpeaking ? 'speaking' : 'idle')}
              type="button"
              onClick={speech.listening ? speech.stop : startListening}
              disabled={busy || ttsSpeaking || (!speech.supported && !speech.listening)}
              aria-label={speech.listening ? 'Stop listening' : 'Start voice input'}
            >{speech.listening ? '■' : busy ? '…' : '🎙️'}</button>
          </div>
          <p className="mic-state-label" aria-live="polite">
            {busy ? 'Processing your request…' : speech.listening ? 'Listening — speak now' : ttsSpeaking ? 'Speaking response…' : speech.error ? 'Microphone error — see guidance below' : 'Ready when you are'}
          </p>
          {(speech.listening || ttsSpeaking) && (
            <button className="stop-button" type="button" onClick={() => { speech.stop(); stopTTS(); setAutoListen(false); }}>Stop</button>
          )}
          {!speech.supported && <div className="unsupported-banner">Voice recognition is unavailable in this browser. Use the typed input below or open this page in Chrome. Voice output may still work.</div>}
          {!ttsSupported && <div className="warning-banner">Voice output is not supported in this browser. Replies will appear as text.</div>}
          {speech.error && speech.error !== 'aborted' && <div className="warning-banner" role="status">{FRIENDLY_SPEECH_ERRORS[speech.error] || 'Microphone input failed.'}</div>}
          <div className="transcript-display" aria-live="polite">
            {message && <p className="transcript-final">You said: {message}</p>}
            {speech.interimTranscript && <p className="transcript-interim">{speech.interimTranscript}</p>}
          </div>
          {awaiting && <p className="warning-banner">One more detail needed: tell me the location. The microphone will listen again after this question.</p>}
        </section>

        <section className="card">
          <h2 className="card-title">Assistant</h2>
          <div className="reply-bubble" aria-live="polite"><span className="reply-icon">💬</span><p>{reply}</p></div>
          {lastTicket && (
            <div className="draft-card mt-2">
              <div className="draft-field"><label>Ticket</label><value>#{lastTicket.ticketNumber}</value></div>
              <div className="draft-field"><label>Status</label><value>{lastTicket.status || 'open'}</value></div>
              <div className="draft-field"><label>Department</label><value>{lastTicket.department}</value></div>
              <div className="draft-field"><label>Priority / SLA</label><value>{lastTicket.priority} · {lastTicket.slaHours}h</value></div>
              <div className="draft-field"><label>Location</label><value>{lastTicket.location}</value></div>
              <div className="draft-field"><label>Telegram</label><value>{lastTicket.telegramStatus}</value></div>
            </div>
          )}
          {draft.summary && awaiting && (
            <div className="draft-card mt-2">
              <div className="draft-field"><label>Draft summary</label><value>{draft.summary}</value></div>
              <div className="draft-field"><label>Location</label><value>{draft.location || 'Waiting for location'}</value></div>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Or type your message</h2>
          <form className="typed-input-wrap" onSubmit={submitTyped}>
            <input className="typed-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="e.g. WiFi is down in block A…" aria-label="Type a complaint or ticket status query" />
            <button className="send-btn" type="submit" disabled={!typed.trim() || busy}>Send</button>
          </form>
          <p className="muted-small mt-1">Try saying — tap an example to submit it as text:</p>
          <div className="chips-wrap mt-1">
            {EXAMPLES.map((example) => <button className="chip" type="button" key={example} disabled={busy} onClick={() => submitTranscript(example)}>{example}</button>)}
          </div>
          {apiError && <div className="error-banner mt-2" role="alert">{apiError}</div>}
          {failedTranscript && <button className="send-btn mt-2" type="button" onClick={() => submitTranscript(failedTranscript)} disabled={busy}>Retry same request</button>}
        </section>

        <section className="card">
          <div className="dashboard-header">
            <div><h2 className="card-title">Live ticket dashboard</h2><p className="muted-small">Latest 30 tickets · refreshes every 5 seconds</p></div>
            <div className="dashboard-actions">
              {telegramUrl && <a className="tg-btn" href={telegramUrl} target="_blank" rel="noreferrer">↗ Watch live alerts</a>}
              <button className="chip" type="button" onClick={loadTickets}>Refresh</button>
            </div>
          </div>
          {lastUpdated && <p className="muted-small">Updated {lastUpdated.toLocaleTimeString()}</p>}
          {dashboardError && <div className="error-banner mt-1" role="alert">{dashboardError}</div>}
          <div className="tickets-list mt-2">
            {tickets.length === 0 ? <p className="tickets-empty">No tickets yet. Report an issue to create the first one.</p> : tickets.map((ticket) => (
              <article className={'ticket-row priority-' + ticket.priority + (ticket.status === 'resolved' ? ' resolved' : '')} key={ticket.ticketNumber}>
                <div className="ticket-num">#{ticket.ticketNumber}</div>
                <div className="ticket-body">
                  <p className="ticket-summary">{ticket.summary}</p>
                  <div className="ticket-meta">
                    <span className="ticket-tag">{ticket.department}</span>
                    <span className="ticket-tag">{ticket.location}</span>
                    <span className={'ticket-tag priority-' + ticket.priority}>{ticket.priority}</span>
                    <span className="ticket-tag">{ticket.slaHours}h SLA</span>
                    <span className={'ticket-tag ' + (ticket.telegramStatus === 'sent' ? 'tg-sent' : ticket.telegramStatus === 'failed' ? 'tg-failed' : 'tg-nc')}>Alert: {ticket.telegramStatus}</span>
                  </div>
                </div>
                <div className="ticket-actions">
                  {ticket.status === 'resolved' ? <span className="resolved-badge">Resolved</span> : health?.adminPin === 'configured' ? <button className="resolve-btn" type="button" onClick={() => resolve(ticket.ticketNumber)}>Resolve</button> : <span className="resolved-badge">Admin PIN not configured</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="app-footer">
        Speech recognition and speech output run in your browser. Tickets are stored in the configured database; local development without MongoDB uses temporary memory only. Gemini and Telegram are real integrations only when configured. This demo is not an emergency service.
      </footer>
    </div>
  );
}
