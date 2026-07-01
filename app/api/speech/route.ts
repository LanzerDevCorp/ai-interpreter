import { generateSpeech } from 'ai';
import { elevenLabs } from '@ai-sdk/elevenlabs'; // default instance reads ELEVENLABS_API_KEY

export const runtime = 'nodejs';

const SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // multilingual; override via env

type SpeechRequest = {
  text: string;
  language: 'es' | 'ko';
};

function isTimeoutError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export async function POST(request: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return Response.json({ error: 'tts_unavailable' }, { status: 503 });
  }

  const body = (await request.json()) as Partial<SpeechRequest>;

  if (typeof body.text !== 'string' || !body.text.trim()) {
    return new Response('Missing "text"', { status: 400 });
  }
  if (body.language !== 'es' && body.language !== 'ko') {
    return new Response('Invalid "language"', { status: 400 });
  }

  try {
    const result = await generateSpeech({
      model: elevenLabs.speech('eleven_multilingual_v2'),
      text: body.text,
      voice: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      language: body.language, // ISO 639-1; provider may auto-detect — harmless
      outputFormat: 'mp3',
      abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });

    return new Response(Buffer.from(result.audio.uint8Array), {
      headers: { 'Content-Type': result.audio.mediaType ?? 'audio/mpeg' },
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      return new Response('Speech generation timed out', { status: 504 });
    }
    return new Response('Speech generation failed', { status: 502 });
  }
}
