import { groq } from '@ai-sdk/groq';
import { APICallError, transcribe } from 'ai';

import type { Direction } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB
const TRANSCRIBE_TIMEOUT_MS = 30_000;

function whisperLanguageHint(direction: unknown): 'es' | 'ko' {
  return direction === 'ko-es' ? 'ko' : 'es';
}

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const audio = formData.get('audio');
  const direction = formData.get('direction') as Direction | null;

  if (!(audio instanceof File) || audio.size === 0) {
    return new Response('Missing or empty "audio" file', { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return new Response('Audio file exceeds the 20MB limit', { status: 413 });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  const language = whisperLanguageHint(direction);

  try {
    const result = await transcribe({
      model: groq.transcription('whisper-large-v3-turbo'),
      audio: bytes,
      providerOptions: { groq: { language } },
      abortSignal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });

    return Response.json({ text: result.text });
  } catch (error) {
    if (isTimeoutError(error)) {
      return new Response('Transcription request timed out', {
        status: 504,
      });
    }

    if (APICallError.isInstance(error)) {
      if (error.statusCode === 429) {
        return new Response('Transcription provider rate limit exceeded', {
          status: 429,
        });
      }
      return new Response('Transcription provider request failed', {
        status: 502,
      });
    }

    return new Response('Transcription failed', { status: 500 });
  }
}
