import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Browser-native text-to-speech (Web Speech API speechSynthesis).
 * Free and instant; voice quality depends on the OS/browser voices.
 * Picks the most natural-sounding English voice available.
 */

export function useSpeechSynthesis() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Choose a pleasant English voice once the voice list is populated
  useEffect(() => {
    if (!supported) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      voiceRef.current =
        voices.find(
          (v) =>
            /en[-_]US/i.test(v.lang) &&
            /natural|google|aria|jenny|samantha|zira|guy/i.test(v.name)
        ) ||
        voices.find((v) => /en[-_]US/i.test(v.lang)) ||
        voices.find((v) => /^en/i.test(v.lang)) ||
        voices[0];
    };
    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', pick);
  }, [supported]);

  const isMountedRef = useRef(true);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    if (isMountedRef.current) setIsSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.onend = () => {
        if (isMountedRef.current) setIsSpeaking(false);
      };
      utterance.onerror = () => {
        if (isMountedRef.current) setIsSpeaking(false);
      };
      if (isMountedRef.current) setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  const toggle = useCallback(
    (text: string) => {
      if (!supported) return;
      if (window.speechSynthesis.speaking) cancel();
      else speak(text);
    },
    [supported, cancel, speak]
  );

  // Never leave narration running after the quiz unmounts
  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (supported) window.speechSynthesis.cancel();
    },
    [supported]
  );

  return { supported, isSpeaking, speak, cancel, toggle };
}
