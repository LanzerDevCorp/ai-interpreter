'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AudioState =
  | 'generating' // /api/speech in flight → "Generando audio…"
  | 'playing'
  | 'idle' // played; replayable
  | 'blocked' // autoplay rejected by browser policy → manual play button
  | 'error' // 502/504 → "Reintentar audio"
  | 'unavailable'; // 503 (key not set) → no control at all

type UseSpeechResult = {
  getState: (turnId: string) => AudioState | undefined;
  speak: (turnId: string, text: string, language: 'es' | 'ko') => Promise<void>;
  replay: (turnId: string) => void;
};

/**
 * Owns TTS playback for completed turns: one reusable HTMLAudioElement,
 * per-turn AudioState, and per-turn blob URLs for replay. Deliberately
 * lives outside the Turn/reducer model — audio state is ephemeral and
 * blob URLs are non-serializable, so mixing them into localStorage-persisted
 * Turn data would either corrupt persistence or force stripping on every
 * write (see design.md ADR-5).
 */
export function useSpeech(): UseSpeechResult {
  const [states, setStates] = useState<Map<string, AudioState>>(
    () => new Map(),
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  const setTurnState = useCallback((turnId: string, state: AudioState) => {
    setStates(prev => {
      const next = new Map(prev);
      next.set(turnId, state);
      return next;
    });
  }, []);

  const getAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const speak = useCallback(
    async (turnId: string, text: string, language: 'es' | 'ko') => {
      setTurnState(turnId, 'generating');

      let response: Response;
      try {
        response = await fetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language }),
        });
      } catch {
        setTurnState(turnId, 'error');
        return;
      }

      if (response.status === 503) {
        setTurnState(turnId, 'unavailable');
        return;
      }
      if (!response.ok) {
        setTurnState(turnId, 'error');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      blobUrlsRef.current.set(turnId, url);

      const audio = getAudioElement();
      audio.src = url;
      audio.onended = () => setTurnState(turnId, 'idle');

      try {
        await audio.play();
        setTurnState(turnId, 'playing');
      } catch {
        setTurnState(turnId, 'blocked');
      }
    },
    [getAudioElement, setTurnState],
  );

  const replay = useCallback(
    (turnId: string) => {
      const url = blobUrlsRef.current.get(turnId);
      if (!url) return;

      const audio = getAudioElement();
      audio.src = url;
      audio.onended = () => setTurnState(turnId, 'idle');
      audio.play().then(
        () => setTurnState(turnId, 'playing'),
        () => setTurnState(turnId, 'blocked'),
      );
    },
    [getAudioElement, setTurnState],
  );

  const getState = useCallback(
    (turnId: string) => states.get(turnId),
    [states],
  );

  useEffect(() => {
    const blobUrls = blobUrlsRef.current;
    return () => {
      blobUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  return { getState, speak, replay };
}
