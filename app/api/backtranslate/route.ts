import { generateText } from 'ai';

import { buildBackTranslationPrompt } from '@/lib/system-prompt';
import type { Direction } from '@/lib/types';

export const runtime = 'nodejs';

type BackTranslateRequest = {
  translated: string;
  direction: Direction;
};

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<BackTranslateRequest>;

  if (typeof body.translated !== 'string' || !body.translated.trim()) {
    return new Response('Missing "translated"', { status: 400 });
  }
  if (body.direction !== 'es-ko' && body.direction !== 'ko-es') {
    return new Response('Invalid "direction"', { status: 400 });
  }

  try {
    const result = await generateText({
      model: process.env.DEFAULT_MODEL!,
      instructions: buildBackTranslationPrompt(body.direction),
      prompt: body.translated,
      abortSignal: AbortSignal.timeout(20_000),
    });

    return Response.json({ backTranslation: result.text.trim() });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new Response('Back-translation timed out', { status: 504 });
    }
    return new Response('Back-translation failed', { status: 502 });
  }
}
