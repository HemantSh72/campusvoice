/**
 * src/hooks/useTTS.js
 * Wraps the browser SpeechSynthesis API.
 * Handles async voice loading (voiceschanged event), timeout guard,
 * and always resolves the speak promise on end/error/timeout.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const synth = window.speechSynthesis || null;

export function useTTS() {
  const [supported] = useState(() => !!synth);
  const [speaking, setSpeaking] = useState(false);
  const voicesRef = useRef([]);
  const utteranceRef = useRef(null);
  const resolveRef = useRef(null);

  // Load voices (may fire asynchronously)
  useEffect(() => {
    if (!synth) return;

    const loadVoices = () => {
      voicesRef.current = synth.getVoices();
    };

    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.addEventListener('voiceschanged', loadVoices);
      return () => synth.removeEventListener('voiceschanged', loadVoices);
    }
  }, []);

  const stop = useCallback(() => {
    if (synth) {
      try { synth.cancel(); } catch {}
    }
    setSpeaking(false);
    if (resolveRef.current) {
      resolveRef.current();
      resolveRef.current = null;
    }
  }, []);

  /**
   * Pick the best voice for the given lang.
   * Prefers exact match (en-IN), then language prefix (en), then first available.
   */
  const pickVoice = useCallback((lang = 'en-IN') => {
    const voices = voicesRef.current;
    if (!voices.length) return null;

    // Try exact lang match
    let voice = voices.find((v) => v.lang === lang);
    if (voice) return voice;

    // Try language prefix match (e.g. "en" for "en-IN")
    const prefix = lang.split('-')[0];
    voice = voices.find((v) => v.lang.startsWith(prefix));
    if (voice) return voice;

    // Fallback to first voice
    return voices[0];
  }, []);

  /**
   * Speak text. Returns a Promise that resolves when done (or on error/timeout).
   * Keeps replies short — Chrome TTS can stall on long text.
   */
  const speak = useCallback((text, lang = 'en-IN') => {
    return new Promise((resolve) => {
      if (!synth || !text) {
        resolve();
        return;
      }

      // Cancel any ongoing speech
      try { synth.cancel(); } catch {}

      // Truncate to avoid Chrome stall (max ~200 chars for reliability)
      const safeText = text.length > 250 ? text.slice(0, 247) + '...' : text;

      const utterance = new SpeechSynthesisUtterance(safeText);
      utterance.lang = lang;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Pick a matching voice (may need a small delay for async loading)
      const voice = pickVoice(lang);
      if (voice) utterance.voice = voice;

      resolveRef.current = resolve;
      utteranceRef.current = utterance;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        setSpeaking(false);
        resolveRef.current = null;
        resolve();
      };

      utterance.onend = finish;
      utterance.onerror = finish;

      // Safety timeout: if TTS doesn't finish in 15s, resolve anyway
      const timeoutId = setTimeout(finish, 15_000);

      setSpeaking(true);
      try {
        synth.speak(utterance);
      } catch {
        finish();
      }

      // Chrome bug workaround: check if speaking stalled after 500ms
      setTimeout(() => {
        if (!finished && synth && !synth.speaking && !synth.pending) {
          finish();
        }
      }, 500);
    });
  }, [pickVoice]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (synth) {
        try { synth.cancel(); } catch {}
      }
    };
  }, []);

  return { supported, speaking, speak, stop };
}
