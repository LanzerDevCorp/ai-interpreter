import { createTextStreamResponse, streamText, type ModelMessage } from 'ai';

import { buildSystemPrompt } from '@/lib/system-prompt';
import type { Direction, Turn } from '@/lib/types';

export const runtime = 'nodejs';

type InterpretRequest = {
  text: string;
  direction: Direction;
  history?: Turn[];
};

const MAX_HISTORY_TURNS = 10;

/**
 * Maps prior turns (both directions) into ModelMessage history. Each turn
 * becomes a user message (original) followed by an assistant message
 * (translated); the verification gloss is intentionally stripped — it is
 * not part of the translation exchange.
 */
function mapHistoryToMessages(history: Turn[] | undefined): ModelMessage[] {
  if (!history || history.length === 0) return [];

  return history.slice(-MAX_HISTORY_TURNS).flatMap((turn): ModelMessage[] => {
    const messages: ModelMessage[] = [];
    if (turn.original) {
      messages.push({ role: 'user', content: turn.original });
    }
    if (turn.translated) {
      messages.push({ role: 'assistant', content: turn.translated });
    }
    return messages;
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<InterpretRequest>;

  if (typeof body.text !== 'string' || !body.text.trim()) {
    return new Response('Missing "text"', { status: 400 });
  }
  if (body.direction !== 'es-ko' && body.direction !== 'ko-es') {
    return new Response('Invalid "direction"', { status: 400 });
  }

  const instructions = buildSystemPrompt(body.direction);
  const messages: ModelMessage[] = [
    ...mapHistoryToMessages(body.history),
    { role: 'user', content: body.text },
  ];

  const result = streamText({
    model: process.env.DEFAULT_MODEL!,
    instructions,
    messages,
  });

  return createTextStreamResponse({ stream: result.textStream });
}
