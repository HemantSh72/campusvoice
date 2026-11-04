import { useState, useRef, useCallback, useEffect } from 'react';

const getRecognition = () => typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;

export function useSpeechRecognition() {
  const [supported] = useState(() => Boolean(getRecognition()));
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const callbackRef = useRef(null);
  const completedRef = useRef(false);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try { recognition.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback((lang = 'en-IN', onResult) => {
    const Recognition = getRecognition();
    if (!Recognition) { setError('unsupported'); return false; }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignored */ }
    }
    callbackRef.current = onResult;
    completedRef.current = false;
    setError(null);
    setTranscript('');
    setInterimTranscript('');
    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalText += text;
        else interim += text;
      }
      setInterimTranscript(interim);
      if (finalText.trim() && !completedRef.current) {
        completedRef.current = true;
        setTranscript(finalText.trim());
        setInterimTranscript('');
        callbackRef.current?.(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setError(event.error || 'unknown');
      setListening(false);
      setInterimTranscript('');
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
        setListening(false);
        setInterimTranscript('');
      }
    };
    try { recognition.start(); return true; }
    catch { setError('start-failed'); setListening(false); recognitionRef.current = null; return false; }
  }, []);

  useEffect(() => () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignored */ }
    }
  }, []);

  return { supported, listening, transcript, interimTranscript, error, start, stop };
}
