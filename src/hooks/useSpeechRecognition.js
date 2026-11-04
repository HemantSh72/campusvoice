/**
 * Browser SpeechRecognition wrapper. Prevents overlapping recognition sessions
 * and exposes stable error codes for the UI.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

export function useSpeechRecognition() {
  const [supported] = useState(Boolean(SpeechRecognitionCtor));
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(null);
  const deliveredRef = useRef(false);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      try { recognition.stop(); } catch { try { recognition.abort(); } catch {} }
    }
    setListening(false);
    setInterimTranscript('');
  }, []);

  const start = useCallback((lang = 'en-IN', onResult) => {
    if (!SpeechRecognitionCtor) {
      setError('unsupported');
      return false;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    onResultRef.current = onResult;
    deliveredRef.current = false;
    setError(null);
    setTranscript('');
    setInterimTranscript('');

    const recognition = new SpeechRecognitionCtor();
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
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setInterimTranscript(interim);
      if (finalText.trim() && !deliveredRef.current) {
        deliveredRef.current = true;
        setTranscript(finalText.trim());
        setInterimTranscript('');
        onResultRef.current?.(finalText.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') setError(event.error || 'unknown');
      setListening(false);
      setInterimTranscript('');
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript('');
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
    try {
      recognition.start();
      return true;
    } catch {
      setError('start-failed');
      setListening(false);
      recognitionRef.current = null;
      return false;
    }
  }, []);

  useEffect(() => () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  return { supported, listening, transcript, interimTranscript, error, start, stop };
}
