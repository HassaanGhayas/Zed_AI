import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToWavBlob } from '../lib/wav';

/**
 * Voice input for the answer box, with two engines:
 * - native (Chrome/Edge/Opera): Web Speech API — free, live interim results.
 * - record (Firefox/Safari/others): MediaRecorder capture, then the backend
 *   transcribes the clip with Gemini (tiny token cost per dictated answer).
 * `supported` is true when at least one engine is available.
 */

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function useSpeechRecognition(
  onFinalText: (text: string) => void,
  fallbackTranscribe?: (blob: Blob) => Promise<string>
) {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listeningRef = useRef(false);
  const isMountedRef = useRef(true);
  const onFinalRef = useRef(onFinalText);
  onFinalRef.current = onFinalText;
  const fallbackRef = useRef(fallbackTranscribe);
  fallbackRef.current = fallbackTranscribe;

  const nativeSupported = typeof window !== 'undefined' && !!getRecognitionCtor();
  const mode: 'native' | 'record' = nativeSupported ? 'native' : 'record';
  const supported = nativeSupported || (recordingSupported() && !!fallbackTranscribe);

  // ── native engine ──

  const stopNative = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    setInterimText('');
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const startNative = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || listeningRef.current) return;
    setError('');

    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = String(result[0].transcript).trim();
        if (result.isFinal) {
          if (text) onFinalRef.current(text);
        } else {
          interim += text;
        }
      }
      setInterimText(interim);
    };

    rec.onend = () => {
      // Chrome ends the session after silence; restart while the mic is still on
      if (listeningRef.current) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      } else {
        setIsListening(false);
        setInterimText('');
      }
    };

    rec.onerror = (event) => {
      const code = event?.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Microphone access was denied. Allow it in your browser settings to use voice input.');
        listeningRef.current = false;
        setIsListening(false);
      } else if (code === 'no-speech' || code === 'aborted') {
        // Transient — onend restarts the session if still listening
      } else if (code) {
        setError(`Voice input error: ${code}`);
      }
    };

    recRef.current = rec;
    listeningRef.current = true;
    setIsListening(true);
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, []);

  // ── recording engine (fallback) ──

  const stopRecording = useCallback(() => {
    const rec = mediaRecRef.current;
    if (rec && rec.state !== 'inactive') {
      rec.stop(); // onstop handles cleanup + transcription
    } else {
      listeningRef.current = false;
      setIsListening(false);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    const transcribe = fallbackRef.current;
    if (!transcribe || listeningRef.current) return;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        listeningRef.current = false;
        if (isMountedRef.current) setIsListening(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size === 0) return;
        if (isMountedRef.current) setIsTranscribing(true);
        try {
          // Gemini rejects webm/ogg containers — transcode to 16 kHz mono WAV first
          let payload = blob;
          try {
            payload = await blobToWavBlob(blob);
          } catch {
            /* decode unsupported: send the original clip as-is */
          }
          const text = (await transcribe(payload)).trim();
          if (text && isMountedRef.current) onFinalRef.current(text);
        } catch (e) {
          if (isMountedRef.current) {
            setError(e instanceof Error ? e.message : 'Transcription failed.');
          }
        } finally {
          if (isMountedRef.current) setIsTranscribing(false);
        }
      };

      mediaRecRef.current = rec;
      listeningRef.current = true;
      if (isMountedRef.current) setIsListening(true);
      rec.start();
    } catch {
      if (isMountedRef.current) {
        setError('Microphone access was denied. Allow it in your browser settings to use voice input.');
      }
    }
  }, []);

  // ── unified controls ──

  const start = useCallback(() => {
    if (mode === 'native') startNative();
    else void startRecording();
  }, [mode, startNative, startRecording]);

  const stop = useCallback(() => {
    if (mode === 'native') stopNative();
    else stopRecording();
  }, [mode, stopNative, stopRecording]);

  const toggle = useCallback(() => {
    if (listeningRef.current) stop();
    else start();
  }, [start, stop]);

  // Hard-abort on unmount so the mic never stays hot
  useEffect(
    () => () => {
      isMountedRef.current = false;
      listeningRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
      try {
        if (mediaRecRef.current && mediaRecRef.current.state !== 'inactive') {
          mediaRecRef.current.stop();
        }
      } catch {
        /* noop */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  return { supported, mode, isListening, isTranscribing, interimText, error, start, stop, toggle };
}
