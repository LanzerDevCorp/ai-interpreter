'use client';

import { Mic } from 'lucide-react';
import { useCallback, useEffect, useReducer, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DirectionToggle } from '@/components/DirectionToggle';
import { KoreanPanel } from '@/components/KoreanPanel';
import { SpanishPanel } from '@/components/SpanishPanel';
import { useAudioCapture } from '@/hooks/useAudioCapture';
import type { Direction, Turn } from '@/lib/types';

const STORAGE_KEY = 'interpreter:v1:turns';

// The model usually emits the literal "\n---\n" sentinel between the
// translation and the gloss, but it has been observed adding extra
// whitespace around the dashes (e.g. "\n\n---\n\n"). Match generously.
const TRANSLATION_DELIMITER_RE = /\n+---\n+/;

type CaptureStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'translating'
  | 'error';

type State = {
  /** Confirmed/historical turns — always terminal (`done` or `error`). */
  turns: Turn[];
  /** The single turn currently in progress, if any. */
  draft: Turn | null;
  captureStatus: CaptureStatus;
};

type Action =
  | { type: 'start-recording'; direction: Direction }
  | { type: 'transcribing-started' }
  | { type: 'transcript-received'; text: string }
  | { type: 'draft-text-changed'; text: string }
  | { type: 'capture-error'; error: string }
  | { type: 'submit-draft' }
  | { type: 'translation-chunk'; translated: string; gloss: string }
  | { type: 'translation-done'; translated: string; gloss: string }
  | { type: 'translation-error'; error: string }
  | { type: 'restore'; turns: Turn[] }
  | { type: 'reset' };

const initialState: State = { turns: [], draft: null, captureStatus: 'idle' };

function createDraftTurn(direction: Direction): Turn {
  return {
    id: crypto.randomUUID(),
    direction,
    original: '',
    translated: '',
    gloss: '',
    status: 'recording',
    timestamp: Date.now(),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start-recording': {
      // Only one turn can be in flight at a time.
      if (state.draft) return state;
      return {
        ...state,
        draft: createDraftTurn(action.direction),
        captureStatus: 'recording',
      };
    }

    case 'transcribing-started': {
      if (!state.draft) return state;
      return {
        ...state,
        draft: { ...state.draft, status: 'transcribing' },
        captureStatus: 'transcribing',
      };
    }

    case 'transcript-received': {
      if (!state.draft) return state;
      // Non-empty `original` + status `transcribing` is the documented
      // editable-draft-awaiting-confirm state.
      return {
        ...state,
        draft: { ...state.draft, status: 'transcribing', original: action.text },
        captureStatus: 'idle',
      };
    }

    case 'draft-text-changed': {
      if (!state.draft) return state;
      return { ...state, draft: { ...state.draft, original: action.text } };
    }

    case 'capture-error': {
      if (!state.draft) {
        return { ...state, captureStatus: 'error' };
      }
      const errored: Turn = {
        ...state.draft,
        status: 'error',
        error: action.error,
      };
      return {
        ...state,
        turns: [...state.turns, errored],
        draft: null,
        captureStatus: 'error',
      };
    }

    case 'submit-draft': {
      if (!state.draft || !state.draft.original.trim()) return state;
      return {
        ...state,
        draft: { ...state.draft, status: 'translating' },
        captureStatus: 'translating',
      };
    }

    case 'translation-chunk': {
      if (!state.draft) return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          translated: action.translated,
          gloss: action.gloss,
        },
      };
    }

    case 'translation-done': {
      if (!state.draft) return state;
      const done: Turn = {
        ...state.draft,
        status: 'done',
        translated: action.translated,
        gloss: action.gloss,
      };
      return {
        ...state,
        turns: [...state.turns, done],
        draft: null,
        captureStatus: 'idle',
      };
    }

    case 'translation-error': {
      if (!state.draft) return state;
      // The user's confirmed `original` text must not be lost on failure.
      const errored: Turn = {
        ...state.draft,
        status: 'error',
        error: action.error,
      };
      return {
        ...state,
        turns: [...state.turns, errored],
        draft: null,
        captureStatus: 'idle',
      };
    }

    case 'restore': {
      return { ...state, turns: action.turns };
    }

    case 'reset': {
      return initialState;
    }

    default:
      return state;
  }
}

/**
 * Splits the accumulated streamed text into translation + gloss using a
 * whitespace-tolerant delimiter match. Before the delimiter has fully
 * streamed in, everything accumulated so far is treated as the (still
 * growing) translation.
 */
function splitTranslationStream(accumulated: string): {
  translated: string;
  gloss: string;
} {
  const match = TRANSLATION_DELIMITER_RE.exec(accumulated);
  if (!match) {
    return { translated: accumulated, gloss: '' };
  }
  return {
    translated: accumulated.slice(0, match.index),
    gloss: accumulated.slice(match.index + match[0].length),
  };
}

const CAPTURE_STATUS_LABEL: Record<CaptureStatus, string | null> = {
  idle: null,
  recording: 'Grabando…',
  transcribing: 'Transcribiendo…',
  translating: 'Traduciendo…',
  error: 'Hubo un error con el micrófono.',
};

export default function Page() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [direction, setDirection] = useState<Direction>('es-ko');
  const [hydrated, setHydrated] = useState(false);

  const handleTranscript = useCallback((text: string) => {
    dispatch({ type: 'transcript-received', text });
  }, []);

  const capture = useAudioCapture({ direction, onTranscript: handleTranscript });

  // Mirror the audio-capture hook's own status into the turn lifecycle.
  useEffect(() => {
    if (capture.status === 'transcribing') {
      dispatch({ type: 'transcribing-started' });
    } else if (capture.status === 'error') {
      dispatch({
        type: 'capture-error',
        error: capture.error ?? 'No se pudo grabar audio.',
      });
    }
  }, [capture.status, capture.error]);

  // Restore persisted history on mount. Corrupt/empty storage is treated as
  // an empty history rather than crashing the page.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          dispatch({ type: 'restore', turns: parsed as Turn[] });
        }
      }
    } catch {
      // Corrupt or unreadable storage — start with empty history.
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist only terminal (done/error) turns — `state.turns` only ever
  // holds terminal turns by construction, so this syncs the whole array.
  // Guarded by `hydrated` so the initial mount doesn't clobber storage
  // before restoration has had a chance to run.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.turns));
    } catch {
      // Storage write failed (quota exceeded, private mode) — non-critical.
    }
  }, [hydrated, state.turns]);

  const handleDirectionChange = useCallback(
    (next: Direction) => {
      // Direction only ever affects the next turn — block changes mid-turn
      // rather than letting it retroactively look like it changed an
      // in-flight turn.
      if (state.draft) return;
      setDirection(next);
    },
    [state.draft],
  );

  const handlePointerDown = useCallback(() => {
    if (state.draft) return;
    dispatch({ type: 'start-recording', direction });
    void capture.start();
  }, [capture, direction, state.draft]);

  const handlePointerUp = useCallback(() => {
    capture.stop();
  }, [capture]);

  const handleDraftTextChange = useCallback((text: string) => {
    dispatch({ type: 'draft-text-changed', text });
  }, []);

  const handleDraftSubmit = useCallback(() => {
    const draft = state.draft;
    if (!draft || draft.status !== 'transcribing' || !draft.original.trim()) {
      return;
    }

    const history = state.turns;
    dispatch({ type: 'submit-draft' });

    void (async () => {
      try {
        const response = await fetch('/api/interpret', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: draft.original,
            direction: draft.direction,
            history,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`La traducción falló (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const { translated, gloss } = splitTranslationStream(accumulated);
          dispatch({ type: 'translation-chunk', translated, gloss });
        }

        accumulated += decoder.decode();
        const { translated, gloss } = splitTranslationStream(accumulated);
        dispatch({
          type: 'translation-done',
          translated: translated.trim(),
          gloss: gloss.trim(),
        });
      } catch (err) {
        dispatch({
          type: 'translation-error',
          error: err instanceof Error ? err.message : 'La traducción falló.',
        });
      }
    })();
  }, [state.draft, state.turns]);

  const handleReset = useCallback(() => {
    capture.stop();
    dispatch({ type: 'reset' });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable — state is still reset in memory.
    }
  }, [capture]);

  const statusLabel = CAPTURE_STATUS_LABEL[state.captureStatus];

  return (
    <main className="flex min-h-svh flex-col gap-6 p-6">
      <header className="flex flex-col items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">
          Intérprete ES↔KO
        </h1>

        <DirectionToggle value={direction} onChange={handleDirectionChange} />

        <div className="flex flex-col items-center gap-2">
          <Button
            type="button"
            size="icon-lg"
            variant={state.captureStatus === 'recording' ? 'destructive' : 'default'}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            aria-label="Mantené presionado para hablar"
          >
            <Mic />
          </Button>
          {statusLabel && (
            <Badge variant={state.captureStatus === 'error' ? 'destructive' : 'secondary'}>
              {statusLabel}
            </Badge>
          )}
        </div>

        <Button type="button" variant="outline" size="sm" onClick={handleReset}>
          Nueva sesión
        </Button>
      </header>

      <div className="grid flex-1 gap-6 md:grid-cols-2">
        <SpanishPanel
          turns={state.turns}
          draft={state.draft ?? undefined}
          onDraftTextChange={handleDraftTextChange}
          onDraftSubmit={handleDraftSubmit}
        />
        <KoreanPanel
          turns={state.turns}
          draft={state.draft ?? undefined}
          onDraftTextChange={handleDraftTextChange}
          onDraftSubmit={handleDraftSubmit}
        />
      </div>
    </main>
  );
}
