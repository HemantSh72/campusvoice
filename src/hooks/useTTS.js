/**
 * SpeechSynthesis wrapper with voice loading and a per-utterance completion guard.
 * Every call resolves on end, error, stop, or timeout.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window
  ? window.speechSynthesis
  : null;

export function useTTS() {
  const [supported] = useState(Boolean(synth));
  const [speaking, setSpeaking] = useState(false);
  const voicesRef = useRef([]);
  const activeRef = useRef(null);

  useEffect(() => {
    if (!synth) return undefined;
    const load = () => { voicesRef.current = synth.getVoices() || []; };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, []);

  const pickVoice = useCallback((lang) => {
    const voices = voicesRef.current;
    return voices.find((voice) => voice.lang?.toLowerCase() === lang.toLowerCase())
      || voices.find((voice) => voice.lang?.toLowerCase().startsWith(lang.split('-')[0].toLowerCase()))
      || null;
  }, []);

  const stop = useCallback(() => {
    const active = activeRef.current;
    if (active) active.finish();
    try { synth?.cancel(); } catch {}
    setSpeaking(false);
  }, []);

  const speak = useCallback((text, lang = 'en-IN') => new Promise((resolve) => {
    if (!synth || !text) { resolve(); return; }
    const previous = activeRef.current;
    if (previous) previous.finish();
    try { synth.cancel(); } catch {}

    const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 250));
    utterance.lang = lang;
    utterance.rate = 0.96;
    utterance.pitch = 1;
    const voice = pickVoice(lang);
    if (voice) utterance.voice = voice;

    const active = { timer: null, finished: false, finish: null };
    active.finish = () => {
      if (active.finished) return;
      active.finished = true;
      if (active.timer) clearTimeout(active.timer);
      if (activeRef.current === active) {
        activeRef.current = null;
        setSpeaking(false);
      }
      resolve();
    };
    activeRef.current = active;
    utterance.onend = active.finish;
    utterance.onerror = active.finish;
    active.timer = setTimeout(active.finish, 15_000);
    setSpeaking(true);
    try {
      synth.speak(utterance);
      setTimeout(() => {
        if (!active.finished && !synth.speaking && !synth.pending) active.finish();
      }, 700);
    } catch { active.finish(); }
  }), [pickVoice]);

  useEffect(() => () => {
    if (activeRef.current) activeRef.current.finish();
    try { synth?.cancel(); } catch {}
  }, []);

  return { supported, speaking, speak, stop };
}
