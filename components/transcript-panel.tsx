'use client';

import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Direction, Turn } from '@/lib/types';

export type PanelLanguage = 'es' | 'ko';

export interface TranscriptPanelProps {
  /** Heading shown above the scrollable history, e.g. "Español". */
  title: string;
  /** Which language this panel renders. */
  language: PanelLanguage;
  /** Confirmed turn history, oldest first. */
  turns: Turn[];
  /** Turn currently in progress (transcribing/translating), if any. Rendered
   * separately from `turns` because it needs editable/loading affordances
   * that confirmed turns don't. */
  draft?: Turn;
  /** Copy shown when there is nothing to display yet. */
  emptyLabel: string;
  /** Called when the user edits the draft text before sending it. */
  onDraftTextChange?: (text: string) => void;
  /** Called when the user confirms the draft for translation. */
  onDraftSubmit?: () => void;
  /** Label for the confirm button on an editable draft. Defaults to "Enviar". */
  submitLabel?: string;
  className?: string;
}

/** True when `language` is the speaker's own language for this turn's direction. */
function isSpeakerSide(direction: Direction, language: PanelLanguage) {
  return (
    (language === 'es' && direction === 'es-ko') ||
    (language === 'ko' && direction === 'ko-es')
  );
}

/**
 * Whether a turn has anything to show on this panel yet. The speaker's own
 * panel has content from the moment transcription starts; the other panel
 * (the translation target) only gets content once translation has started.
 */
function isRowVisible(turn: Turn, language: PanelLanguage): boolean {
  if (turn.status === 'recording') return false;
  if (!isSpeakerSide(turn.direction, language) && turn.status === 'transcribing') {
    return false;
  }
  return true;
}

interface TurnRowProps {
  turn: Turn;
  language: PanelLanguage;
  isDraft: boolean;
  onDraftTextChange?: (text: string) => void;
  onDraftSubmit?: () => void;
  submitLabel: string;
}

function TurnRow({
  turn,
  language,
  isDraft,
  onDraftTextChange,
  onDraftSubmit,
  submitLabel,
}: TurnRowProps) {
  const speakerSide = isSpeakerSide(turn.direction, language);
  const text = speakerSide ? turn.original : turn.translated;

  const isTranscribingEmpty =
    speakerSide && turn.status === 'transcribing' && text.length === 0;
  const isEditableDraft =
    isDraft && speakerSide && turn.status === 'transcribing' && text.length > 0;
  const isTranslatingTarget = !speakerSide && turn.status === 'translating';
  const isError = turn.status === 'error';
  const showGloss = speakerSide && turn.gloss.length > 0 && !isTranscribingEmpty && !isEditableDraft;
  const showPlainText =
    !isTranscribingEmpty && !isEditableDraft && !isTranslatingTarget && text.length > 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2">
        {isTranscribingEmpty && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-4/5" />
            <Badge variant="secondary">Transcribiendo…</Badge>
          </div>
        )}

        {isEditableDraft && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={text}
              onChange={(event) => onDraftTextChange?.(event.target.value)}
              aria-label="Editar transcripción antes de enviar"
            />
            <Button
              type="button"
              size="sm"
              className="self-end"
              onClick={() => onDraftSubmit?.()}
            >
              {submitLabel}
            </Button>
          </div>
        )}

        {isTranslatingTarget && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-4/5" />
            <Badge variant="secondary">Traduciendo…</Badge>
          </div>
        )}

        {showPlainText && <p className="text-sm text-foreground">{text}</p>}

        {isError && (
          <Badge variant="destructive">{turn.error ?? 'Ocurrió un error.'}</Badge>
        )}

        {showGloss && <p className="text-xs text-muted-foreground">{turn.gloss}</p>}
      </CardContent>
    </Card>
  );
}

export function TranscriptPanel({
  title,
  language,
  turns,
  draft,
  emptyLabel,
  onDraftTextChange,
  onDraftSubmit,
  submitLabel = 'Enviar',
  className,
}: TranscriptPanelProps) {
  const visibleTurns = turns.filter((turn) => isRowVisible(turn, language));
  const draftVisible = draft ? isRowVisible(draft, language) : false;
  const isEmpty = visibleTurns.length === 0 && !draftVisible;

  return (
    <div className={cn('flex h-full min-h-0 flex-col gap-3', className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <ScrollArea className="h-[28rem] rounded-lg border border-border">
        <div className="flex flex-col gap-3 p-3">
          {isEmpty && <p className="text-sm text-muted-foreground">{emptyLabel}</p>}

          {visibleTurns.map((turn, index) => (
            <Fragment key={turn.id}>
              <TurnRow
                turn={turn}
                language={language}
                isDraft={false}
                submitLabel={submitLabel}
              />
              {(index < visibleTurns.length - 1 || draftVisible) && <Separator />}
            </Fragment>
          ))}

          {draftVisible && draft && (
            <TurnRow
              turn={draft}
              language={language}
              isDraft
              onDraftTextChange={onDraftTextChange}
              onDraftSubmit={onDraftSubmit}
              submitLabel={submitLabel}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
