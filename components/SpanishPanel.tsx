'use client';

import { TranscriptPanel, type TranscriptPanelProps } from '@/components/transcript-panel';

export type SpanishPanelProps = Omit<
  TranscriptPanelProps,
  'title' | 'language' | 'emptyLabel'
>;

/**
 * Unified chronological Spanish-language view of the conversation.
 * Shows `turn.original` for `es-ko` turns (the Spanish speaker) and
 * `turn.translated` for `ko-es` turns (translated into Spanish).
 */
export function SpanishPanel(props: SpanishPanelProps) {
  return (
    <TranscriptPanel
      {...props}
      title="Español"
      language="es"
      emptyLabel="Todavía no hay turnos en español."
    />
  );
}
