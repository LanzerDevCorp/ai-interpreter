'use client';

import { TranscriptPanel, type TranscriptPanelProps } from '@/components/transcript-panel';

export type KoreanPanelProps = Omit<
  TranscriptPanelProps,
  'title' | 'language' | 'emptyLabel'
>;

/**
 * Unified chronological Korean-language view of the conversation. Symmetric
 * mirror of `SpanishPanel`: shows `turn.original` for `ko-es` turns (the
 * Korean speaker) and `turn.translated` for `es-ko` turns (translated into
 * Korean). Orders and scrolls independently of `SpanishPanel`.
 */
export function KoreanPanel(props: KoreanPanelProps) {
  return (
    <TranscriptPanel
      {...props}
      title="한국어"
      language="ko"
      emptyLabel="Todavía no hay turnos en coreano."
    />
  );
}
