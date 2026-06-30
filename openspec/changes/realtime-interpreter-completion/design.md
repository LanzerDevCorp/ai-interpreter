# Design: Complete the ES↔KO Real-Time Interpreter MVP

> Verified against installed `ai@7.0.6` (`node_modules/ai/dist/index.d.ts`): v7 uses
> `instructions` (`system` is `@deprecated`), the `prompt | messages` union, `transcribe({ model, audio })`
> → `TranscriptionResult { text, segments, language, durationInSeconds }` with `audio: DataContent | URL`,
> `Output` is exported, and `createTextStreamResponse({ stream })` exists. `@ai-sdk/groq` is a NEW dependency
> (not installed). This artifact intentionally exceeds the generic 800-word budget: the task specifies eight
> concrete sub-designs that feed `sdd-tasks` directly, and vagueness would block that phase.

## Technical Approach

Three greenfield capabilities over the existing echo skeleton. Text translation stays on the OIDC AI
Gateway (`DEFAULT_MODEL` string → auto-routed); transcription uses the direct `@ai-sdk/groq` provider keyed
by the manual `GROQ_API_KEY` (the documented OIDC exception — Groq does not route through the Gateway). The
client captures push-to-talk audio, posts it to `/api/transcribe` for a draft, lets the user edit, then posts
the confirmed text to `/api/interpret` for a streamed translation + verification gloss. UI state is local to
`app/page.tsx`; history persists in `localStorage`.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| 1 | Prompt vs history wiring | `instructions = buildSystemPrompt(direction)` (static per direction, includes glossary block); conversation `history` + current `text` go in `messages` as `ModelMessage[]` | History serialized into `instructions` text blob | v7's `Instructions` type is explicitly "used with `prompt` or `messages`" — the split is idiomatic. Static `instructions` maximize Gateway cache hits and keep the prompt auditable; `messages` give the model real turn structure for terminology consistency / reference resolution (the stated purpose of the window). |
| 2 | Streaming output shape | Ship the delimited `traducción\n---\nglosa` plain-text contract for MVP | `streamText` + `Output.object()` structured streaming | Live-growing translation needs incremental rendering. Splitting accumulated plain text on a fixed sentinel is trivial and robust; parsing partial JSON deltas mid-stream is MORE fragile, not less. `Output.object()` stays as the documented fallback if real testing shows the model leaks/omits the delimiter. |
| 3 | History message mapping | Each prior `Turn` → `{role:'user', content: original}` + `{role:'assistant', content: translated}` (gloss stripped); final `{role:'user', content: text}` | Re-sending gloss; custom role labels | History is reference material for terminology, not re-verification. Mixed-direction turns are acceptable context because `instructions` fix the active output direction. |
| 4 | Transcription provider | Direct `groq.transcription('whisper-large-v3-turbo')` via `transcribe()` | Routing STT through the Gateway | Groq STT is not a Gateway-routed capability; locked decision. |
| 5 | State management | `useReducer` in `app/page.tsx`, no context/store | Context provider, Zustand/Redux | Single screen, one consumer tree, small-team MVP. The turn lifecycle has named transitions (record→transcribe→draft→translate→done/error) that read cleaner as reducer actions than scattered `useState`. A global store is over-engineering here. |
| 6 | Persistence | `useEffect` syncs only terminal turns (`done`/`error`) to versioned key `interpreter:v1:turns`; no debounce | Debounced writes; persisting in-flight turns | Turn frequency is human-paced and the payload is tiny; debounce adds complexity for no gain. In-flight turns must not survive a refresh. The `v1:` prefix allows a future schema bump to discard incompatible data. |

## Data Flow

    [DirectionToggle] sets active direction
           │
    press-and-hold mic ─► useAudioCapture: getUserMedia → MediaRecorder(webm/opus)
           │ release
           ▼
    Blob ──POST FormData(audio,direction)──► /api/transcribe ──groq.transcription──► { text }
           │
           ▼
    editable draft (Textarea in active-language panel)  ──user edits──► "Enviar"
           │
           ▼
    Turn{status:'translating'} ──POST {text,direction,history}──► /api/interpret
           │                                          (streamText: instructions+messages)
           ▼  stream chunks
    split on "\n---\n": before → translated (live), after → gloss
           │
           ▼  status:'done'  ──useEffect──► localStorage(interpreter:v1:turns)
    SpanishPanel + KoreanPanel render unified chronological history

## Interfaces / Contracts

`lib/types.ts`
```ts
export type Direction = 'es-ko' | 'ko-es';
export type TurnStatus = 'recording' | 'transcribing' | 'translating' | 'done' | 'error';
export type Turn = {
  id: string;            // crypto.randomUUID()
  direction: Direction;
  original: string;      // speaker-language text (filled after transcription)
  translated: string;    // target-language text (streamed)
  gloss: string;         // back-check in the SPEAKER's language (streamed, after delimiter)
  status: TurnStatus;
  timestamp: number;
  error?: string;
};
```
`transcribing` doubles as the "captured, editable draft awaiting confirm" state (non-empty `original` +
status `transcribing` ⇒ editable). `recording`/`transcribing`/`translating` are in-flight; only `done`/`error`
persist.

`lib/system-prompt.ts`
```ts
export function buildSystemPrompt(direction: Direction): string;
// Returns the full system text: role, intent-over-literal rule, redundancy collapse,
// formal business register in target language, preserve exact figures/amounts/dates,
// brands kept in original form, the strict output contract
// ("<traducción>\n---\n<glosa en idioma del hablante>", nothing else),
// then the glossary block from buildGlossaryBlock(direction) appended.
```

`lib/glossary.ts`
```ts
export type GlossaryEntry = { es: string; ko: string; nota?: string };
export type GlossaryCategory = 'procedimientos' | 'finanzas' | 'marcas';
export const glossary: Record<GlossaryCategory, GlossaryEntry[]>;
export function buildGlossaryBlock(direction: Direction): string; // source→target oriented lines
```
Seed entries (real aesthetic-medicine business terms, placeholder for team completion):
- procedimientos: `bótox`↔`보톡스`; `ácido hialurónico`↔`히알루론산`; `hilos tensores`↔`실리프팅`;
  `peeling químico`↔`화학적 필링`; `mesoterapia`↔`메조테라피`.
- finanzas: `seña / anticipo`↔`계약금`; `cuotas / plan de pagos`↔`할부`; `factura`↔`세금계산서`;
  `IVA`↔`부가가치세`; `presupuesto`↔`견적서`.
- marcas: `Allergan`, `Juvederm`, `Restylane`, `Ultherapy` (`nota: mantener la marca en su forma original`).

`/api/interpret` (modified) — body `{ text: string; direction: Direction; history?: Turn[] }`. Builds
`instructions = buildSystemPrompt(direction)`, `messages = mapHistory(history) + {role:'user',content:text}`,
calls `streamText({ model: process.env.DEFAULT_MODEL!, instructions, messages })`, returns
`createTextStreamResponse({ stream: result.textStream })`. Validation unchanged (400 on bad text/direction).
`runtime = 'nodejs'`.

`/api/transcribe` (new) — `POST`, `Content-Type: multipart/form-data`, fields `audio` (Blob, required) and
`direction` (optional, for the Whisper language hint). `runtime = 'nodejs'`.
```ts
const form = await request.formData();
const file = form.get('audio');
if (!(file instanceof File) || file.size === 0) return Response 400 'Empty or missing audio';
if (file.size > 20 * 1024 * 1024) return Response 413 'Audio too large';   // Groq free-tier headroom
const bytes = new Uint8Array(await file.arrayBuffer());
const lang = form.get('direction') === 'ko-es' ? 'ko' : 'es';
const { text } = await transcribe({
  model: groq.transcription('whisper-large-v3-turbo'),
  audio: bytes,
  providerOptions: { groq: { language: lang } },
  abortSignal: AbortSignal.timeout(30_000),
});
return Response.json({ text });
```
Errors: 400 missing/empty/wrong-type, 413 oversize, 504 on timeout, 502 on Groq `APICallError`
(propagate 429 as 429 so the UI can show "demasiadas grabaciones, esperá unos segundos"), 500 otherwise.

`hooks/useAudioCapture.ts` — `useAudioCapture({ direction, onTranscript }) → { status: 'idle'|'recording'|'transcribing'|'error', error, start(), stop() }`.
`start()` lazily `getUserMedia({audio:true})` (permission prompt on first use), creates
`new MediaRecorder(stream, { mimeType: 'audio/webm' })`, collects `dataavailable` chunks. `stop()` finalizes the
Blob, POSTs FormData to `/api/transcribe`, sets `transcribing`, and resolves text via `onTranscript`. Tracks are
stopped on unmount and after each capture. Component wires `start` to `onPointerDown` and `stop` to
`onPointerUp`/`onPointerLeave` (press-and-hold).

`components/DirectionToggle.tsx` — `{ value: Direction; onChange(d: Direction): void }`; segmented
"¿Quién habla? ES / KO" using shadcn `Switch` + labels (or two `Button`s); flips the active translation
direction and the Whisper language hint.

`components/SpanishPanel.tsx` / `KoreanPanel.tsx` — `{ turns: Turn[]; draft?: DraftState; ... }`. Both render the
SAME chronological turn list inside a `ScrollArea`; each panel shows its own language's text per turn
(`es` panel: `original` when `direction==='es-ko'`, else `translated`; mirror for `ko`). The gloss renders small,
under the turn, on the SPEAKER's side. Status visuals: `transcribing` → `Skeleton` + `Badge variant="secondary"`
"Transcribiendo…"; editable draft → `Textarea` + "Enviar" `Button`; `translating` → `Skeleton` on the target side
+ `Badge` "Traduciendo…"; `error` → `Badge variant="destructive"` with `Turn.error`. `Card` per turn,
`Separator` between turns.

`app/page.tsx` — `'use client'`. `useReducer` holds `{ turns, draft, captureStatus }`; `direction` via `useState`.
Two-column `grid md:grid-cols-2`; toggle + mic button centered above. Reads `localStorage` on mount, syncs terminal
turns on change. "Nueva sesión" `Button` dispatches reset + clears the storage key.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `buildSystemPrompt`, `buildGlossaryBlock`, `mapHistory`, delimiter split parser | Pure-function assertions both directions |
| Integration | `/api/interpret` (real ES↔KO output + gloss), `/api/transcribe` (sample webm → text; 400/413/timeout) | Route handler invoked with crafted Request/FormData |
| E2E (manual) | Mic permission, press-and-hold, draft edit, stream render, refresh persistence, reset | Browser run in Chrome/Edge (locked target) |

## Migration / Rollout

No data migration. New `@ai-sdk/groq` dependency + `GROQ_API_KEY` in `.env.local` / Vercel env /
`.env.local.example`. Each fase reverts independently per the proposal rollback plan; the `interpreter:v1:`
storage prefix isolates any future schema change.

## Open Questions

- [ ] Whisper `language` hint key under `providerOptions.groq` — confirm exact field against
      `@ai-sdk/groq` docs/types once the package is installed (design assumes `language`).
- [ ] Groq free-tier file-size ceiling (assumed ~20–25 MB) — confirm during fase 4; adjust the 413 guard.
- [ ] If the delimiter proves unreliable in real testing, switch decision #2 to `Output.object()`.
