'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Direction } from '@/lib/types';

export type AudioCaptureStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'error';

type UseAudioCaptureOptions = {
  direction: Direction;
  onTranscript: (text: string) => void;
};

type UseAudioCaptureResult = {
  status: AudioCaptureStatus;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
};

const RECORDER_MIME_TYPE = 'audio/webm';

/**
 * Push-to-talk audio capture: start() requests the mic and begins
 * recording, stop() finalizes the recording and posts it to
 * /api/transcribe, resolving the transcript via onTranscript. Request/
 * response only — no interim/partial transcripts, no silence-based
 * auto-stop.
 */
export function useAudioCapture({
  direction,
  onTranscript,
}: UseAudioCaptureOptions): UseAudioCaptureResult {
  const [status, setStatus] = useState<AudioCaptureStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const directionRef = useRef(direction);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setStatus('transcribing');

      try {
        const formData = new FormData();
        formData.append('audio', blob, 'audio.webm');
        formData.append('direction', directionRef.current);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Transcription failed (${response.status})`);
        }

        const data = (await response.json()) as { text: string };
        onTranscript(data.text);
        setStatus('idle');
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Transcription failed',
        );
        setStatus('error');
      }
    },
    [onTranscript],
  );

  const start = useCallback(async () => {
    if (status === 'recording' || status === 'transcribing') return;

    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: RECORDER_MIME_TYPE,
      });
      recorderRef.current = recorder;

      recorder.addEventListener('dataavailable', event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, {
          type: RECORDER_MIME_TYPE,
        });
        chunksRef.current = [];
        stopTracks();
        void transcribe(blob);
      });

      recorder.start();
      setStatus('recording');
    } catch (err) {
      stopTracks();
      setError(
        err instanceof Error ? err.message : 'Microphone permission denied',
      );
      setStatus('error');
    }
  }, [status, stopTracks, transcribe]);

  const stop = useCallback(() => {
    if (status !== 'recording') return;
    recorderRef.current?.stop();
  }, [status]);

  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      stopTracks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, error, start, stop };
}
