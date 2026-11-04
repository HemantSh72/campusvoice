import { useState, useRef, useCallback, useEffect } from 'react';

const getSynthesis = () => typeof window !== 'undefined' ? window.speechSynthesis || null : null;

export function useTTS() {
  const [supported] = useState(() => Boolean(getSynthesis() && typeof window.SpeechSynthesisUtterance !== 'undefined'));
  const [speaking, setSpeaking] = useState(false);
  const voicesRef = useRef([]);
  const activeRef = useRef(null);

  useEffect(() => {
    const synth = getSynthesis();
    if (!synth) return undefined;
    const load = () => { voicesRef.current = synth.getVoices(); };
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, []);

  const stop = useCallback(() => {
    const synth = getSynthesis();
    if (activeRef.current) activeRef.current.finish();
    try { synth?.cancel(); } catch { /* ignored */ }
    setSpeaking(false);
  }, []);

  const speak = useCallback((text, lang = 'en-IN') => new Promise((resolve) => {
    const synth = getSynthesis();
    if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined' || !text) {
      resolve(); return;
    }
    if (activeRef.current) activeRef.current.finish();
    try { synth.cancel(); } catch { /* ignored */ }
    const utterance = new window.SpeechSynthesisUtterance(String(text).slice(0, 240));
    utterance.lang = lang;
    utterance.rate = 1;
    utterance.pitch = 1;
    const prefix = lang.split('-')[0];
    const voice = voicesRef.current.find((item) => item.lang === lang)
      || voicesRef.current.find((item) => item.lang?.startsWith(prefix));
    if (voice) utterance.voice = voice;

    let finished = false;
    let timeoutId;
    const active = {
      finish: () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        if (activeRef.current === active) activeRef.current = null;
        setSpeaking(false);
        resolve();
      },
    };
    activeRef.current = active;
    utterance.onend = active.finish;
    utterance.onerror = active.finish;
    timeoutId = setTimeout(active.finish, 12000);
    setSpeaking(true);
    try { synth.speak(utterance); } catch { active.finish(); }
  }), []);

  useEffect(() => () => {
    if (activeRef.current) activeRef.current.finish();
    try { getSynthesis()?.cancel(); } catch { /* ignored */ }
  }, []);

  return { supported, speaking, speak, stop };
}
