/**
 * src/hooks/useSpeechRecognition.js
 * Wraps the browser Web Speech API (SpeechRecognition).
 * Handles all error states and returns a consistent interface.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export function useSpeechRecognition() {
  const [supported] = useState(() => !!SpeechRecognition);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const onResultRef = useRef(null);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  }, []);

  const start = useCallback((lang = 'en-IN', onResult) => {
    if (!supported) {
      setError('unsupported');
      return;
    }

    onResultRef.current = onResult;
    setError(null);
    setTranscript('');
    setInterimTranscript('');

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }
      if (interim) setInterimTranscript(interim);
      if (final) {
        setTranscript(final);
        setInterimTranscript('');
        if (onResultRef.current) onResultRef.current(final);
      }
    };

    recognition.onerror = (event) => {
      const errorMessages = {
        'no-speech': 'No speech detected. Please try again.',
        'audio-capture': 'Microphone not found or not accessible.',
        'not-allowed': 'Microphone access was denied. Please allow mic access and reload.',
        'network': 'Network error during speech recognition.',
        'aborted': null, // User-initiated stop, not an error
        'service-not-allowed': 'Speech recognition is not allowed in this browser/context.',
      };
      const msg = errorMessages[event.error];
      if (msg !== null) {
        setError(event.error);
      }
      setListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript('');
    };

    try {
      recognition.start();
    } catch (err) {
      setError('start-failed');
      setListening(false);
    }
  }, [supported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
  };
}
