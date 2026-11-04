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
    recognitionRef.current = null;
    setListening(false);
    setInterimTranscript('');
    if (recognition) {
      try { recognition.stop(); } catch { try { recognition.abort(); } catch {} }
    }
  }, []);

  const start = useCallback((lang = 'en-IN', onResult) => {
    const Recognition = getRecognition();
    if (!Recognition) { setError('unsupported'); return false; }
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    if (previous) {
      try { previous.abort(); } catch { /* ignored */ }
    }
    callbackRef.current = onResult;
    completedRef.current = false;
    setListening(false);
    setError(null);
    setTranscript('');
    setInterimTranscript('');

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      if (recognitionRef.current === recognition) setListening(true);
    };
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
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
      if (recognitionRef.current !== recognition) return;
      if (event.error !== 'aborted') setError(event.error || 'unknown');
      recognitionRef.current = null;
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
    try {
      recognition.start();
      return true;
    } catch {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setError('start-failed');
      setListening(false);
      return false;
    }
  }, []);

  useEffect(() => () => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { recognition.abort(); } catch { /* ignored */ }
    }
  }, []);

  return { supported, listening, transcript, interimTranscript, error, start, stop };
}
