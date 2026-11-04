import { useCallback, useState } from 'react';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useTTS } from './hooks/useTTS.js';

const EXAMPLES = [
  'WiFi is not working in hostel block B',
  'There is water leakage near the library',
  'The campus bus is always late',
  'What is the status of ticket 7?',
];

export default function App() {
  const [lang, setLang] = useState('en-IN');
  const [draft, setDraft] = useState({});
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('Tap the microphone and describe your campus issue. You can also type below.');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [apiError, setApiError] = useState('');
  const speech = useSpeechRecognition();
  const tts = useTTS();

  const submitTranscript = useCallback(async (transcript) => {
    const clean = transcript.trim();
    if (!clean || busy) return;
    setBusy(true);
    setMessage(clean);
    setApiError('');
    try {
      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: clean,
          draft,
          lang,
          requestId: globalThis.crypto?.randomUUID?.() || `cv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      setReply(data.reply || 'Your request was processed.');
      setDraft(data.draft || {});
      setLastTicket(data.ticket || null);
      if (data.awaiting) setDraft(data.draft || {});
      await tts.speak(data.reply || 'Your request was processed.', lang);
    } catch (error) {
      const text = error.message || 'Could not reach CampusVoice. Please try again.';
      setApiError(text);
      setReply(text);
      await tts.speak(text, lang);
    } finally {
      setBusy(false);
      setTyped('');
    }
  }, [busy, draft, lang, tts]);

  const startListening = () => {
    if (busy || tts.speaking) return;
    tts.stop();
    speech.start(lang, submitTranscript);
  };

  const submitTyped = (event) => {
    event.preventDefault();
    submitTranscript(typed);
  };

  const chooseExample = (example) => {
    setTyped(example);
  };

  const statusLabel = busy ? 'Processing your request…'
    : speech.listening ? 'Listening — speak now'
    : tts.speaking ? 'Speaking response…'
    : 'Ready when you are';

  return (
    <div className="app">
      <header className="app-header">
        <h1>CampusVoice</h1>
        <p>Your campus grievance desk. Speak naturally — we’ll route the issue.</p>
      </header>

      <main className="app-main">
        <section className="card mic-section" aria-label="Voice complaint">
          <div className="lang-toggle" aria-label="Speech language">
            <span>Language</span>
            <button className={lang === 'en-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('en-IN')} type="button">English</button>
            <button className={lang === 'hi-IN' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('hi-IN')} type="button">हिन्दी</button>
          </div>
          <div className="mic-button-wrap">
            <div className={`mic-ring ${speech.listening ? 'listening' : tts.speaking ? 'speaking' : ''}`} />
            <button
              className={`mic-button ${speech.listening ? 'listening' : busy ? 'thinking' : tts.speaking ? 'speaking' : 'idle'}`}
              type="button"
              onClick={speech.listening ? speech.stop : startListening}
              disabled={busy || (!speech.supported && !speech.listening)}
              aria-label={speech.listening ? 'Stop listening' : 'Start voice input'}
            >
              {speech.listening ? '■' : '🎙️'}
            </button>
          </div>
          <p className="mic-state-label" aria-live="polite">{statusLabel}</p>
          {!speech.supported && (
            <div className="unsupported-banner">
              Voice recognition is not available in this browser. Use the text box below or open this page in Chrome.
            </div>
          )}
          {speech.error && (
            <div className="warning-banner" role="status">
              Microphone issue ({speech.error}). Check browser microphone permission or use typed input.
            </div>
          )}
          <div className="transcript-display" aria-live="polite">
            {message && <p className="transcript-final">You said: {message}</p>}
            {speech.interimTranscript && <p className="transcript-interim">{speech.interimTranscript}</p>}
          </div>
          {speech.listening && <button className="stop-button" type="button" onClick={speech.stop}>Stop listening</button>}
        </section>

        <section className="card">
          <h2 className="card-title">Assistant</h2>
          <div className="reply-bubble" aria-live="polite">
            <span className="reply-icon">💬</span>
            <p>{reply}</p>
          </div>
          {lastTicket && (
            <div className="draft-card mt-2">
              <div className="draft-field"><label>Ticket</label><value>#{lastTicket.ticketNumber}</value></div>
              <div className="draft-field"><label>Status</label><value>{lastTicket.status || 'open'}</value></div>
              <div className="draft-field"><label>Department</label><value>{lastTicket.department}</value></div>
              <div className="draft-field"><label>Priority / SLA</label><value>{lastTicket.priority} · {lastTicket.slaHours}h</value></div>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">Or type your message</h2>
          <form className="typed-input-wrap" onSubmit={submitTyped}>
            <input className="typed-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="e.g. WiFi is down in block A…" aria-label="Type a complaint or ticket status query" />
            <button className="send-btn" type="submit" disabled={!typed.trim() || busy}>Send</button>
          </form>
          <div className="chips-wrap mt-2">
            {EXAMPLES.map((example) => <button className="chip" type="button" key={example} onClick={() => chooseExample(example)}>{example}</button>)}
          </div>
          {apiError && <div className="error-banner mt-2" role="alert">{apiError}</div>}
        </section>
      </main>

      <footer className="app-footer">
        CampusVoice · Voice-first campus grievance desk · Do not use this demo for emergencies.
      </footer>
    </div>
  );
}
