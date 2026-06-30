# Design: TTS + UX Refinements

> Architecture-level HOW for `tts-and-ux-refinements`. Builds on the proposal's locked
> decisions (separate `/api/speech` + `/api/backtranslate` routes, `back-translating`
> status, `gloss`→`backTranslation` rename, capture toggle, first-person prompt rewrite).
> Decisive: every open question the proposal deferred is resolved here with a single pick.

## 0. Architecture overview

```
                         page.tsx (client orchestrator)
                                   │
        ┌──────────────┬───────────┴───────────┬─────────────────┐
        ▼              ▼                        ▼                 ▼
 useAudioCapture   /api/interpret        /api/backtranslate   /api/speech
 (toggle + vis)    (stream, unchanged)   (generateText)       (generateSpeech)
        │              │                        │                 │
   transcript     translated text         backTranslation     audio/mpeg bytes
        │              │                        │                 │
        ▼              ▼                        ▼                 ▼
   reducer(draft) ──> 'translating' ──> 'back-translating' ──> 'done'
                         │  (on stream close, FIRE BOTH IN PARALLEL)
                         ├──────────────► /api/backtranslate ─► reducer finalize
                         └──────────────► useSpeech.speak() ──► <audio> autoplay
```

**Layering / boundaries (unchanged hexagonal-ish split):**
- **Pure domain** (`lib/`): prompt builders, glossary, types. No I/O, no React.
- **Route handlers** (`app/api/*`): thin adapters over `ai` SDK calls. Node runtime.
- **Hooks** (`hooks/`): browser-capability adapters (mic capture, audio playback). Own
  their refs and lifecycles; expose imperative methods + status.
- **UI** (`app/page.tsx`, `components/`): reducer-driven orchestration + presentation.

**Key data-flow decision (answers proposal's "non-blocking" risk + sequencing Q8):**
Once `/api/interpret`'s stream closes and `translated` is final, the client fires
`/api/backtranslate` and `useSpeech.speak()` **in parallel**. Neither waits for the other.
TTS only needs `translated`; back-translation only needs `translated`. The translation
text is rendered the instant the stream closes — back-translation and audio are both
progressive overlays on an already-visible turn.

---

## 1. `app/api/speech/route.ts` (NEW)

### Contract
- **Method:** `POST`
- **Request JSON:** `{ text: string; language: 'es' | 'ko' }`
  - `language` is the language of `text` (the TARGET language of the turn), NOT a
    direction. The client derives it: `es-ko → 'ko'`, `ko-es → 'es'`. Passing the
    resolved language keeps the route ignorant of direction semantics — it just speaks
    a string in a language.
- **Success response:** `200`, `Content-Type: audio/mpeg`, body = **raw MP3 bytes**
  (`result.audio.uint8Array`). Not base64, not a URL. Rationale: zero double-encoding;
  the client wraps the response in a `Blob` and `URL.createObjectURL` for `<audio>`.
- **Error responses (status codes are load-bearing — the client branches on them):**
  | Status | Meaning | Client reaction |
  |--------|---------|-----------------|
  | `400`  | missing/invalid `text` or `language` | treat as error (should not happen) |
  | `503`  | `ELEVENLABS_API_KEY` not set (feature OFF) | **fail soft**: silently mark turn audio `unavailable`, show NO control |
  | `502`  | provider/generation failure | show a manual "Reintentar audio" button |
  | `504`  | generation timeout | show "Reintentar audio" button |
  | `200`  | audio bytes | autoplay |

  **"Fail soft" defined concretely:** missing key → `503 { error: 'tts_unavailable' }`.
  The translation and back-translation are completely unaffected; the only consequence
  is the turn renders with no audio affordance. `503` is deliberately distinct from
  `502` so the UI can hide audio entirely (configured-off) vs. offer a retry (transient).

### Implementation shape
```ts
import { generateSpeech } from 'ai';
import { elevenlabs } from '@ai-sdk/elevenlabs'; // default instance reads ELEVENLABS_API_KEY

export const runtime = 'nodejs';

const SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // multilingual; override via env

export async function POST(request: Request) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return Response.json({ error: 'tts_unavailable' }, { status: 503 });
  }

  const body = (await request.json()) as Partial<{ text: string; language: 'es' | 'ko' }>;
  if (typeof body.text !== 'string' || !body.text.trim()) {
    return new Response('Missing "text"', { status: 400 });
  }
  if (body.language !== 'es' && body.language !== 'ko') {
    return new Response('Invalid "language"', { status: 400 });
  }

  try {
    const result = await generateSpeech({
      model: elevenlabs.speech('eleven_multilingual_v2'),
      text: body.text,
      voice: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      language: body.language,       // ISO 639-1; provider may auto-detect — harmless
      outputFormat: 'mp3',
      abortSignal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
    });

    return new Response(result.audio.uint8Array, {
      headers: { 'Content-Type': result.audio.mediaType ?? 'audio/mpeg' },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new Response('Speech generation timed out', { status: 504 });
    }
    return new Response('Speech generation failed', { status: 502 });
  }
}
```

### Voice / model decision (ElevenLabs multilingual)
- **ONE voice ID covers BOTH Korean and Spanish.** `eleven_multilingual_v2` is a single
  multilingual model that detects the spoken language from the input text and renders the
  *same* voice timbre across all 29 supported languages. You do **NOT** need per-language
  voice IDs. Direction (es-ko vs ko-es) changes only the `text` and the `language` hint,
  not the voice.
- Voice is **parameterized** via `ELEVENLABS_VOICE_ID` (default = Rachel
  `21m00Tcm4TlvDq8ikWAM`, a known multilingual voice) so the Korean voice-quality
  spot-check from the proposal's risk table can swap it without a code change.
- `outputFormat: 'mp3'` → `audio/mpeg`.

### ⚠ Apply-time verification (single unresolved external fact)
`@ai-sdk/elevenlabs` is NOT yet installed and I had no WebFetch to confirm its exact
exports. The design assumes the standard AI SDK provider convention:
**default export `elevenlabs` (auto-reads `ELEVENLABS_API_KEY`) + `elevenlabs.speech(modelId)`
+ `voice` = a voice-ID string.** `sdd-apply` MUST, immediately after
`npm i @ai-sdk/elevenlabs`, confirm against `node_modules/@ai-sdk/elevenlabs/dist/index.d.ts`:
1. the provider symbol name (`elevenlabs` default instance vs. `createElevenLabs` factory),
2. the speech-model factory method name (`.speech(...)`),
3. that `voice` takes a raw voice-ID string (vs. a named-voice enum).
If any differ, adjust the two import/call lines only — the route contract is unaffected.

---

## 2. Back-translation route — `app/api/backtranslate/route.ts` (NEW)

### Contract
- **Method:** `POST`
- **Request JSON:** `{ translated: string; direction: Direction }`
  - `translated` is the finished target-language text from `/api/interpret`.
  - `direction` is the ORIGINAL turn direction. The route reads the language roles
    inverted: input `translated` is in `direction`'s TARGET language; output goes to
    `direction`'s SOURCE language (the speaker's own language, so they can verify).
- **Success response:** `200`, `Response.json({ backTranslation: string })`.
- **Error responses:** `400` (bad `translated`/`direction`); `502` provider failure;
  `504` timeout. **Non-critical**: on the client, ANY failure finalizes the turn as
  `done` with an empty `backTranslation` — the translation is never lost.
- **`runtime = 'nodejs'`.**

### Why a separate route (locked by proposal, restated)
`/api/interpret` uses `createTextStreamResponse({ stream })` — a pure text stream with no
envelope to append a second payload. The back-translation is a distinct, non-streaming,
short `generateText` call. Folding it in is impossible without changing the stream
contract. It is also genuinely the next *sequential* phase, so a separate endpoint is the
clean boundary.

### Implementation shape
```ts
import { generateText } from 'ai';
import { buildBackTranslationPrompt } from '@/lib/system-prompt';
import type { Direction } from '@/lib/types';

export const runtime = 'nodejs';
const BACKTRANSLATE_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{ translated: string; direction: Direction }>;
  if (typeof body.translated !== 'string' || !body.translated.trim()) {
    return new Response('Missing "translated"', { status: 400 });
  }
  if (body.direction !== 'es-ko' && body.direction !== 'ko-es') {
    return new Response('Invalid "direction"', { status: 400 });
  }

  try {
    const result = await generateText({
      model: process.env.DEFAULT_MODEL!,
      system: buildBackTranslationPrompt(body.direction),
      prompt: body.translated,
      abortSignal: AbortSignal.timeout(BACKTRANSLATE_TIMEOUT_MS),
    });
    return Response.json({ backTranslation: result.text.trim() });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new Response('Back-translation timed out', { status: 504 });
    }
    return new Response('Back-translation failed', { status: 502 });
  }
}
```
(Uses `system` + `prompt` — no history; back-translation is a stateless one-shot. Matches
the existing `process.env.DEFAULT_MODEL` convention used by `/api/interpret`.)

### Client trigger point (confirmed: client-driven, NOT server-chained)
The client fires this from `page.tsx` AFTER the interpret stream's reader reports `done`
— i.e. from the same `handleDraftSubmit` async block, immediately after dispatching
`translation-done`. There is no server-side chaining; `/api/interpret` knows nothing about
back-translation.

---

## 3. `lib/types.ts` changes (final shape)

```ts
export type Direction = 'es-ko' | 'ko-es';

export type TurnStatus =
  | 'recording'
  | 'transcribing'
  | 'translating'
  | 'back-translating'   // NEW: literal round-trip verification in flight
  | 'done'
  | 'error';

export type Turn = {
  id: string;
  direction: Direction;
  original: string;
  translated: string;
  /**
   * Literal round-trip of `translated` back into the speaker's source language,
   * produced by /api/backtranslate. Lets the speaker verify the translation kept
   * their meaning. Empty until back-translation resolves (or if it fails/old turn).
   * Renamed from `gloss` — semantics changed from "parallel summary" to
   * "faithful back-translation", and it now renders on the TARGET panel side.
   */
  backTranslation: string;
  status: TurnStatus;
  timestamp: number;
  error?: string;
};
```

**Decision: confirm the `gloss`→`backTranslation` rename** (no deviation from proposal).
Justification to rename rather than keep `gloss`: the field's *meaning* and *render
location* both change. Keeping the name `gloss` for a literal target-side back-translation
would actively mislead future readers. The rename is cheap and the field is additive.

**localStorage migration gotcha (call out for apply/verify):** persisted turns from the
shipped MVP carry `gloss`, not `backTranslation`. On `restore`, old turns will have
`backTranslation === undefined`. This is safe because every render guard uses
`(turn.backTranslation?.length ?? 0) > 0`. No migration code required — old turns simply
show no back-translation (acceptable per the proposal's additive/rollback contract). Do
NOT write a localStorage migration; tolerate `undefined` defensively at the read site.

---

## 4. `lib/system-prompt.ts` rewrite (full text — highest-leverage change)

Two exported builders. `LANGUAGE_NAMES` map is reused unchanged. **`buildSystemPrompt`
now emits ONLY the translation** — the `---` delimiter + gloss section is DELETED, because
verification moved to the separate route. This also lets the client drop
`splitTranslationStream`/`TRANSLATION_DELIMITER_RE` (the whole stream is the translation).

### 4a. `buildSystemPrompt(direction: Direction): string` (rewritten)
```ts
/**
 * Direction-aware system prompt for the live interpreter. The model speaks in
 * FIRST PERSON, as if it were the speaker — never a third-person meta-summary.
 * Output is ONLY the translation in the target language (no delimiter, no gloss);
 * round-trip verification is handled separately by buildBackTranslationPrompt.
 */
export function buildSystemPrompt(direction: Direction): string {
  const { source, target } = LANGUAGE_NAMES[direction];

  return `Sos un intérprete profesional en una reunión de negocios del rubro estética médica (procedimientos estéticos, finanzas y marcas comerciales). Traducís en tiempo real de ${source} a ${target}.

Hablás SIEMPRE en primera persona, como si fueras vos quien está hablando. Reformulás lo que la persona dice y lo decís en ${target} como si fuera tu propia voz. NUNCA describís ni resumís desde afuera lo que la persona dijo.

Ejemplo del error a evitar:
- Mal (meta-descripción en tercera persona): "Explicación del funcionamiento del tratamiento y sus costos."
- Bien (primera persona, como si hablaras vos): "El tratamiento funciona de esta manera y estos son los costos."

Reglas de traducción:
- Hablá en primera persona. NUNCA uses fórmulas como "el hablante dice", "explicación de", "resumen de", ni títulos o encabezados.
- Priorizá la intención y el sentido del mensaje por sobre la traducción literal palabra por palabra.
- Eliminá redundancias y muletillas propias del habla espontánea; el resultado debe sonar natural y fluido en ${target}.
- Usá un registro formal de negocios, apropiado para una reunión profesional.
- Preservá EXACTAMENTE los montos, cifras, porcentajes y fechas mencionados, sin redondear ni reinterpretar.
- Las marcas comerciales (ej. Allergan, Juvederm, Restylane, Ultherapy) se mantienen en su forma original, sin traducir.

Respondé ÚNICAMENTE con la traducción en ${target}. No agregues comillas, etiquetas, explicaciones, ni ningún texto fuera de la traducción.

${buildGlossaryBlock(direction)}`;
}
```

### 4b. `buildBackTranslationPrompt(direction: Direction): string` (NEW)
Reads the SAME `direction` but inverts roles: input is in `target`, output strictly literal
in `source`. Does NOT inherit the natural-paraphrase framing.
```ts
/**
 * Builds the strictly-literal back-translation prompt. Given a finished
 * translation (in the turn's TARGET language), it translates that text back into
 * the speaker's SOURCE language as literally as possible, so the speaker can spot
 * any drift in meaning. Deliberately the OPPOSITE of buildSystemPrompt: no
 * paraphrasing, no polishing, no first-person reframing.
 */
export function buildBackTranslationPrompt(direction: Direction): string {
  const { source, target } = LANGUAGE_NAMES[direction];

  return `Sos un traductor estrictamente literal. Te voy a dar un texto en ${target} que es la traducción de algo que se dijo originalmente en ${source}. Traducí ese texto de vuelta a ${source}, de la forma MÁS LITERAL y fiel posible.

Reglas:
- Traducí lo más pegado posible al texto en ${target}: preservá el orden, la estructura y la elección de las ideas tal como aparecen.
- NO mejores, NO pulas, NO resumas y NO interpretes. Si el texto en ${target} dice algo de cierta manera, reflejalo tal cual en ${source}, aunque suene menos natural.
- El objetivo es que el hablante original pueda comparar esta versión con lo que dijo y detectar cualquier desviación de sentido.
- Preservá EXACTAMENTE los montos, cifras, porcentajes, fechas y marcas comerciales.

Respondé ÚNICAMENTE con la traducción literal en ${source}, sin comillas ni texto adicional.`;
}
```

---

## 5. `hooks/useAudioCapture.ts` changes

**Public API stays `start()` / `stop()` (two functions) — do NOT add `toggle()`.**
Rationale (boundary discipline): the hook owns the *recorder*, not the *turn lifecycle*.
Whether a click means "start" or "stop" depends on `state.draft` / reducer status, which
lives in `page.tsx`. Putting `toggle()` in the hook would force it to know about turn
state it doesn't own. The page composes the toggle from `start`/`stop`.

### `visibilitychange` auto-stop (NEW, registered inside the hook)
Registered once on mount via `useEffect` on `document`. On
`document.visibilityState === 'hidden'`, if a recording is active, force-stop it down the
SAME path as `stop()` (`recorderRef.current?.stop()`), which triggers the existing
`'stop'` listener → blob → transcribe. Registered in the hook because the hook owns
`recorderRef`. It reads recorder liveness via the ref (not via `status` state, to avoid
re-subscribing the listener on every status change).
```ts
useEffect(() => {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden' && recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}, []);
```
(Uses `recorderRef.current.state === 'recording'` — the MediaRecorder's own state — so the
effect has an empty dep array and never re-binds.)

### Copy / aria
`start`/`stop` semantics unchanged internally. The aria-label/labels are owned by
`page.tsx` (the button lives there), so the hook needs no copy change. See §6 for the new
dynamic aria-label.

---

## 6. `app/page.tsx` + `components/transcript-panel.tsx` wiring

### 6a. Reducer changes (`page.tsx`)
**Action type changes (drop `gloss` everywhere; add back-translation lifecycle):**
```ts
type Action =
  | { type: 'start-recording'; direction: Direction }
  | { type: 'transcribing-started' }
  | { type: 'transcript-received'; text: string }
  | { type: 'draft-text-changed'; text: string }
  | { type: 'capture-error'; error: string }
  | { type: 'submit-draft' }
  | { type: 'translation-chunk'; translated: string }          // gloss removed
  | { type: 'translation-done'; translated: string }            // gloss removed
  | { type: 'translation-error'; error: string }
  | { type: 'back-translation-done'; backTranslation: string }  // NEW
  | { type: 'back-translation-error' }                          // NEW (non-critical)
  | { type: 'restore'; turns: Turn[] }
  | { type: 'reset' };
```

**Lifecycle (the draft stays in flight through back-translation):**
- `translation-chunk` → `{ ...draft, translated }` (no split, no gloss).
- `translation-done` → `{ ...draft, translated, status: 'back-translating' }`. **Keeps the
  draft** (does NOT move to `turns` yet). `captureStatus: 'idle'`. The translation is now
  fully visible; back-translation + audio run as overlays.
- `back-translation-done` → finalize: `{ ...draft, backTranslation, status: 'done' }`,
  push to `turns`, `draft = null`.
- `back-translation-error` → finalize anyway: `{ ...draft, status: 'done',
  backTranslation: '' }`, push to `turns`, `draft = null`. Back-translation is
  non-blocking; its failure must NOT discard a good translation.
- `createDraftTurn` initializes `backTranslation: ''` (was `gloss: ''`).
- `CaptureStatus` enum: unchanged set (`idle|recording|transcribing|translating|error`).
  Back-translation progress is a PER-TURN panel concern, not a global header badge, so no
  new `CaptureStatus` value. The mic stays gated by `state.draft != null` (a draft in
  `back-translating` still blocks a new turn).

**Delete** `splitTranslationStream` and `TRANSLATION_DELIMITER_RE` — the stream body is the
translation verbatim now.

### 6b. Orchestration in `handleDraftSubmit` (after stream close)
```ts
// ...stream reader loop now just accumulates and dispatches translation-chunk { translated }
accumulated += decoder.decode();
const translated = accumulated.trim();
dispatch({ type: 'translation-done', translated });

const turnId = draft.id;
const targetLang = draft.direction === 'es-ko' ? 'ko' : 'es';

// FIRE BOTH IN PARALLEL — each only needs `translated`. TTS does NOT wait for back-translation.
void speech.speak(turnId, translated, targetLang);          // §6d useSpeech

void (async () => {
  try {
    const res = await fetch('/api/backtranslate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ translated, direction: draft.direction }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const { backTranslation } = (await res.json()) as { backTranslation: string };
    dispatch({ type: 'back-translation-done', backTranslation });
  } catch {
    dispatch({ type: 'back-translation-error' });
  }
})();
```

### 6c. Capture toggle wiring (`page.tsx`)
Replace `onPointerDown`/`onPointerUp`/`onPointerLeave` with a single `onClick`:
```ts
const handleToggleCapture = useCallback(() => {
  if (capture.status === 'recording') {
    capture.stop();
    return;
  }
  if (state.draft) return;            // a turn is mid-flight (transcribing/translating/back-translating)
  dispatch({ type: 'start-recording', direction });
  void capture.start();
}, [capture, direction, state.draft]);
```
Button: `onClick={handleToggleCapture}`, dynamic `aria-label`:
`capture.status === 'recording' ? 'Detené la grabación' : 'Empezá a hablar'`. Variant
`destructive` while recording (unchanged). Drop `onPointerDown/Up/Leave`.

### 6d. New `hooks/useSpeech.ts` (NEW — owns audio playback, keeps `Turn` serializable)
TTS state is ephemeral, per-turn, and holds a non-serializable blob URL, so it MUST live
OUTSIDE the reducer/`Turn` (which is persisted to localStorage). A dedicated hook owns:
- one reusable `HTMLAudioElement` (ref, created lazily),
- `Map<turnId, AudioState>` exposed as state,
- `Map<turnId, string>` of blob URLs for replay (revoked on unmount).

```ts
export type AudioState =
  | 'generating'   // /api/speech in flight → "Generando audio…"
  | 'playing'
  | 'idle'         // played; replayable
  | 'blocked'      // autoplay rejected by browser policy → manual play button
  | 'error'        // 502/504 → "Reintentar audio"
  | 'unavailable'; // 503 (key not set) → no control at all

type UseSpeechResult = {
  getState: (turnId: string) => AudioState | undefined;
  speak: (turnId: string, text: string, language: 'es' | 'ko') => Promise<void>;
  replay: (turnId: string) => void;
};
```
`speak`:
1. set `generating`; `POST /api/speech { text, language }`.
2. `503` → set `unavailable`, return. non-OK → set `error`, return.
3. `const blob = await res.blob(); const url = URL.createObjectURL(blob)`; store URL.
4. `audio.src = url; audio.play().then(() => set 'playing').catch(() => set 'blocked')`.
5. `audio.onended → set 'idle'`.
`replay(turnId)`: re-point `audio.src` to the stored URL and `play()`; `.catch(() =>
set 'blocked')` (replay is itself a user gesture, so it will normally succeed).

**Autoplay-policy fallback (concrete):** `audio.play()` returns a Promise that rejects with
`NotAllowedError` when the browser blocks autoplay. The `.catch` sets the turn to
`blocked`, and the target panel renders a manual "Reproducir" button whose `onClick` calls
`replay(turnId)` — now inside a user gesture, so it plays. (The click-to-STOP capture
gesture usually satisfies the policy, so blocking should be rare, but this is the safety
net the proposal requires.)

### 6e. `transcript-panel.tsx` changes
Back-translation + audio render on the **TARGET** side (where the translation shows), not
the speaker side.

**Verification text moves to target side:**
```ts
// OLD: const showGloss = speakerSide && turn.gloss.length > 0 && ...
const showBackTranslation =
  !speakerSide && (turn.backTranslation?.length ?? 0) > 0;
```
Render `showBackTranslation` as the existing muted `<p className="text-xs text-muted-foreground">`
UNDER the translated `<p>`, on the target side.

**New in-progress state (reuse Skeleton + Badge pattern):**
```ts
const isBackTranslatingTarget = !speakerSide && turn.status === 'back-translating';
```
During `back-translating`, `showPlainText` is already true (status is not `translating`
and `translated` is non-empty), so the translation `<p>` shows. BELOW it, when
`isBackTranslatingTarget`, render:
```tsx
<div className="flex flex-col gap-2">
  <Skeleton className="h-3 w-3/5" />
  <Badge variant="secondary">Verificando traducción…</Badge>
</div>
```

**Audio affordance (target side only).** New optional props threaded through
`TranscriptPanel` → `TurnRow` (and passed from `page.tsx` via Spanish/Korean panels):
```ts
getAudioState?: (turnId: string) => AudioState | undefined;
onReplayAudio?: (turnId: string) => void;
```
Render on the target side based on `getAudioState(turn.id)`:
- `generating` → `<Badge variant="secondary">Generando audio…</Badge>`
- `blocked` → `<Button size="sm" variant="outline" onClick={() => onReplayAudio?.(turn.id)}>Reproducir</Button>`
- `error`   → `<Button size="sm" variant="outline" onClick={() => onReplayAudio?.(turn.id)}>Reintentar audio</Button>`
- `idle`    → small replay icon button (optional, `onReplayAudio`)
- `playing` → optional subtle speaker badge
- `unavailable` / `undefined` → render nothing

`SpanishPanel` / `KoreanPanel` keep their `Omit<...>` prop pass-through; the two new
optional props flow through automatically (they aren't in the omitted set).

---

## 7. Files unchanged (explicit non-changes)
- `app/api/interpret/route.ts`: **no functional change.** The prompt no longer emits a
  gloss, but the route already streams text verbatim and `mapHistoryToMessages` already
  strips non-translation content. Only the (already-accurate) doc-comment about "stripping
  the gloss" stays valid. No code edit required.
- `lib/glossary.ts`: unchanged.
- `components/DirectionToggle.tsx`, `SpanishPanel.tsx`, `KoreanPanel.tsx`: only the
  pass-through of the two new optional audio props (no logic change).
- `app/api/transcribe/route.ts`: unchanged.

## 8. Config / dependency changes
- `package.json`: add `@ai-sdk/elevenlabs` (verify exact version at install).
- `.env.local.example`: add `ELEVENLABS_API_KEY=` and
  `ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM` (with a comment that it's a multilingual voice
  used for BOTH Korean and Spanish; one ID, not per-language).

---

## ADR-style decisions (rationale + rejected alternatives)

### ADR-1 — TTS returns raw `audio/mpeg` bytes (not base64, not a URL)
**Decision:** `/api/speech` streams raw MP3 bytes; client builds a blob URL.
**Rejected:** (a) base64 JSON — doubles payload size and forces decode; (b) returning a
storage URL — needs object storage + persistence, explicitly out of scope. Raw bytes are
the lowest-latency, lowest-complexity path and `<audio>` consumes a blob URL natively.

### ADR-2 — TTS and back-translation fire in PARALLEL, both after the stream closes
**Decision:** On stream close, dispatch `translation-done`, then fire `speak()` and
`/api/backtranslate` concurrently. TTS does not wait for back-translation.
**Why:** both depend ONLY on `translated`; serializing them would stack two avoidable
latencies onto spoken output. The translation renders immediately; both results are
progressive overlays.
**Rejected:** (a) TTS after back-translation — needless latency on the most user-visible
output (audio); (b) back-translation server-chained inside interpret — impossible with the
text-only stream contract and couples two concerns.

### ADR-3 — Back-translation is non-blocking and its failure still finalizes `done`
**Decision:** `back-translation-error` finalizes the turn as `done` with empty
`backTranslation`.
**Why:** verification is a nice-to-have; a failed second call must never discard a
successful translation the user already saw.
**Rejected:** marking the whole turn `error` on back-translation failure — would wrongly
imply the translation failed.

### ADR-4 — `503` vs `502` split for TTS fail-soft
**Decision:** missing key → `503 { error: 'tts_unavailable' }` (hide audio entirely);
provider error → `502` (offer retry).
**Why:** "fail soft" means a missing key degrades silently with no broken UI, while a
transient provider failure deserves a retry affordance. Distinct codes let the client pick
the right reaction without parsing bodies.
**Rejected:** `200` with empty/no audio — hides a real misconfiguration and complicates the
"is there audio?" check; single generic `500` — can't distinguish off vs. broken.

### ADR-5 — Audio state lives in a dedicated `useSpeech` hook, NOT in `Turn`
**Decision:** ephemeral audio status + blob URLs live in `useSpeech`, keyed by turnId.
**Why:** `Turn` is serialized to localStorage; blob URLs are non-serializable and audio
state is session-ephemeral. Mixing them would either corrupt persistence or force stripping
on every write.
**Rejected:** adding `audioState`/`audioUrl` to `Turn` — pollutes the persisted model with
transient, non-serializable data.

### ADR-6 — `useAudioCapture` keeps `start`/`stop`; the page composes the toggle
**Decision:** no `toggle()` in the hook; `page.tsx` branches on `capture.status`.
**Why:** the start/stop *decision* depends on turn-lifecycle state the hook doesn't own.
Keeping the hook a pure recorder adapter preserves the layer boundary.
**Rejected:** `toggle()` inside the hook — would require the hook to read reducer/draft
state, leaking UI orchestration into a capability adapter.

### ADR-7 — Main prompt emits ONLY the translation; gloss machinery deleted
**Decision:** drop the `---` delimiter + gloss from `buildSystemPrompt`; remove
`splitTranslationStream`/`TRANSLATION_DELIMITER_RE`; verification comes from the separate
literal route.
**Why:** with a real round-trip back-translation, the inline gloss is redundant AND was the
source of the third-person meta-summary bug. A single-purpose prompt (translate, first
person, nothing else) is easier to keep faithful.
**Rejected:** keeping the inline gloss alongside the new route — duplicate verification,
keeps the buggy framing, and complicates the stream parser for no benefit.

---

## Open risks / assumptions for downstream phases
- **ElevenLabs provider symbols unverified** (no WebFetch; package not installed). See §1
  verification block — `sdd-apply` confirms `elevenlabs.speech(...)` + `voice` string after
  install. Highest-confidence assumption but the one external unknown.
- **Korean voice quality** unverified against domain vocab (numerals, dates, brand names) —
  spot-check before finalizing `ELEVENLABS_VOICE_ID` (proposal risk, carried forward).
- **TTS latency** stacks after translation; measured empirically post-implementation. The
  `eleven_flash_v2_5` fallback stays deferred unless generation time proves unacceptable.
- **localStorage** old turns lack `backTranslation` — handled by defensive optional read,
  no migration. Verify the read guard exists wherever `backTranslation` is rendered.
```
