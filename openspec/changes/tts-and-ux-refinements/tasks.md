# Tasks: TTS + UX Refinements

Legend: `[P]` = parallelizable within its phase. `[S]` = sequential, depends on a listed task. Gate = `lint` (`npm run lint`), `tc` (`npm run typecheck`), `build` (`npm run build`); no test runner exists in this project (Strict TDD Mode OFF). `manual` = browser-only behavior no automated gate can cover.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~610 total (per-PR: ~125 / ~180 / ~45 / ~15 / ~250) |
| 400-line budget risk | High (total); each work unit individually Low |
| Chained PRs recommended | Yes |
| Suggested split | PR1 Foundation → PR2 Speech-Synthesis → PR3 Back-Translation → PR4 Capture-Toggle Hook → PR5 UI Wiring (PR5 depends on PR1–4; PR2/PR3/PR4 are mutually independent) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `lib/types.ts`, `lib/system-prompt.ts`, `package.json`, `.env.local.example` | PR 1 | Independent; base = tracker/main. Everything downstream reads from this. |
| 2 | `app/api/speech/route.ts`, `hooks/useSpeech.ts` | PR 2 | Independent of PR3/PR4; only needs PR1's `package.json`/env. |
| 3 | `app/api/backtranslate/route.ts` | PR 3 | Independent of PR2/PR4; only needs PR1's `buildBackTranslationPrompt`. |
| 4 | `hooks/useAudioCapture.ts` (`visibilitychange`) | PR 4 | Fully independent — no dependency on PR1–3. Smallest unit, could fold into PR1 if preferred. |
| 5 | `app/page.tsx`, `components/transcript-panel.tsx`, `SpanishPanel.tsx`/`KoreanPanel.tsx` | PR 5 | Depends on PR1–4 merged. Single-file edits to `page.tsx` are sequential within this PR (same-file conflict risk). |

## Phase 1: Foundation

- [x] 1.1 `[P]` `lib/types.ts`: add `'back-translating'` to `TurnStatus` (between `translating` and `done`); rename `gloss` → `backTranslation` on `Turn` with doc comment (literal round-trip; empty until resolved; renders on target panel). Spec: interpreter-ui Req "Turn Lifecycle States"; translation-verification (Turn field). Design §3. Gate: tc/lint.
- [x] 1.2 `[P]` `lib/system-prompt.ts`: rewrite `buildSystemPrompt` — delete `---` delimiter + gloss section, add first-person/anti-meta rules + Mal/Bien example, keep `buildGlossaryBlock` append. Add NEW `buildBackTranslationPrompt(direction)` — strictly literal, target→source, does not inherit natural-paraphrase framing. Spec: translation-core Req "Direction-Aware System Prompt", "First-Person/Anti-Meta Translation Style", "Translation-Only Streaming Output Format"; translation-verification Req "Literal (Non-Paraphrase) Translation Builder". Design §4. Gate: tc/lint.
- [x] 1.3 `[P]` `package.json`: add `@ai-sdk/elevenlabs`, run `npm i`. Immediately confirm against `node_modules/@ai-sdk/elevenlabs/dist/index.d.ts` that the default export is `elevenLabs` (capital L — confirmed live against ai-sdk.dev docs, NOT `elevenlabs` as design.md's code sample shows) and that `.speech(modelId)` + raw voice-ID string match. Design §1 verification block, §8. Gate: build (install resolves).
- [x] 1.4 `[P]` Create `.env.local.example` (no file exists yet) with `ELEVENLABS_API_KEY=` and `ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM`, comment noting one multilingual voice covers both KO+ES. Design §8. Gate: manual review. **Prerequisite for 2.1 live verification**: user must supply a real `ELEVENLABS_API_KEY` in `.env.local` (same pattern as `GROQ_API_KEY` previously).

## Phase 2: Speech Synthesis (depends on 1.3, 1.4; independent of Phase 3/4)

- [x] 2.1 `[S]` (after 1.3) `app/api/speech/route.ts` (NEW, `runtime='nodejs'`): `POST {text, language:'es'|'ko'}`; 503 if `ELEVENLABS_API_KEY` unset; 400 on bad input; `generateSpeech({model: elevenLabs.speech('eleven_multilingual_v2'), text, voice: process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID, language, outputFormat:'mp3', abortSignal: 30s})`; return raw `result.audio.uint8Array` as `audio/mpeg`; catch timeout→504, else→502. Spec: speech-synthesis Req "Speech Synthesis Endpoint Contract", "Missing API Key Fail-Soft", "Speech Generation Failure Handling". Design §1. Gate: tc/lint/build **+ manual curl** (`curl -X POST localhost:3000/api/speech -d '{"text":"hola","language":"ko"}'` — requires real `ELEVENLABS_API_KEY` per 1.4). **DONE** — live curl confirmed fail-soft path (`503 {"error":"tts_unavailable"}`, key not configured in this environment); full 200/audio-bytes path unverified pending a real key.
- [x] 2.2 `[S]` (after 2.1) `hooks/useSpeech.ts` (NEW): `AudioState` (`generating|playing|idle|blocked|error|unavailable`); `Map<turnId,AudioState>` + `Map<turnId,blobUrl>`; one reusable `HTMLAudioElement`; `speak(turnId,text,language)` posts to `/api/speech`, branches on 503/non-OK/200, builds blob URL, `audio.play().catch` → `blocked`; `replay(turnId)`; `getState(turnId)`. Spec: speech-synthesis Req "Autoplay on Completed Translation", "Autoplay-Blocked Fallback Control". Design §6d, ADR-1, ADR-5. Gate: tc/lint/build. **DONE** — tc/lint/build clean (zero new errors).

## Phase 3: Translation Verification (depends on 1.2; independent of Phase 2/4)

- [ ] 3.1 `app/api/backtranslate/route.ts` (NEW, `runtime='nodejs'`): `POST {translated, direction}`; 400 on bad input; `generateText({model: process.env.DEFAULT_MODEL!, system: buildBackTranslationPrompt(direction), prompt: translated, abortSignal: 20s})` → `Response.json({backTranslation: result.text.trim()})`; catch timeout→504, else→502. Spec: translation-verification Req "Backtranslate Endpoint Contract", "Verification Failure Handling". Design §2. Gate: tc/lint/build **+ manual curl** (uses existing `DEFAULT_MODEL`/Gateway credentials already configured — no new key needed).

## Phase 4: Voice Capture (fully independent — no dependency on Phase 1–3)

- [ ] 4.1 `hooks/useAudioCapture.ts`: add `useEffect` (empty deps) registering `document` `visibilitychange` listener; on `hidden` + `recorderRef.current?.state==='recording'`, call `recorderRef.current.stop()` (same path as `stop()`). Public API (`start`/`stop`) unchanged — no `toggle()` added. Spec: voice-capture Req "Visibility-Loss Auto-Stop". Design §5, ADR-6. Gate: tc/lint/build **+ manual** (tab-hide behavior, browser-only — see 6.2).

## Phase 5: UI Wiring (depends on Phase 1–4 merged; same-file edits to `page.tsx` are sequential)

- [ ] 5.1 `[S]` `app/page.tsx`: update `Action` union (drop `gloss` from `translation-chunk`/`translation-done`; add `back-translation-done`/`back-translation-error`); reducer — `translation-done` sets `status:'back-translating'` and KEEPS draft (no move to `turns`); new `back-translation-done`/`back-translation-error` cases finalize `done` + push to `turns`; `createDraftTurn` inits `backTranslation:''`; delete `splitTranslationStream`/`TRANSLATION_DELIMITER_RE`. Spec: interpreter-ui Req "Turn Lifecycle States". Design §6a. Gate: tc/lint/build.
- [ ] 5.2 `[S]` (after 5.1, 2.2, 3.1) `app/page.tsx` `handleDraftSubmit`: stream loop dispatches `translation-chunk {translated}` only (no split); on close dispatch `translation-done`, derive `targetLang`, then fire `speech.speak(turnId, translated, targetLang)` and `fetch('/api/backtranslate', ...)` **in parallel** (`void` both, neither awaits the other), dispatching `back-translation-done`/`back-translation-error` from the fetch result. Spec: speech-synthesis Req "Autoplay on Completed Translation"; translation-verification Req "Trigger Timing". Design §6b, ADR-2. Gate: tc/lint/build.
- [ ] 5.3 `[S]` (after 5.1, 4.1) `app/page.tsx`: replace `onPointerDown`/`onPointerUp`/`onPointerLeave` with single `onClick={handleToggleCapture}` (stop if `recording`; return if `state.draft`; else start); dynamic `aria-label` (`'Detené la grabación'` / `'Empezá a hablar'`). Instantiate `useSpeech()` and pass `getState`/`replay` to `SpanishPanel`/`KoreanPanel` as `getAudioState`/`onReplayAudio`. Spec: voice-capture Req "Click-Toggle Recording Lifecycle". Design §6c, §6d, ADR-6. Gate: tc/lint/build.
- [ ] 5.4 `[P]` `components/transcript-panel.tsx`: `showBackTranslation = !speakerSide && (turn.backTranslation?.length ?? 0) > 0`, rendered under the translated `<p>` on the TARGET side; `isBackTranslatingTarget = !speakerSide && turn.status==='back-translating'` → `Skeleton` + `Badge "Verificando traducción…"`; thread optional `getAudioState`/`onReplayAudio` props through `TranscriptPanel`/`TurnRow`, rendering per `AudioState` (`generating`→badge, `blocked`/`error`→retry button, `idle`/`playing`→optional, `unavailable`→nothing). Spec: interpreter-ui Req "Back-Translation Display on Target Panel"; speech-synthesis (audio affordances). Design §6e. Gate: tc/lint/build.
- [ ] 5.5 `[P]` `components/SpanishPanel.tsx`, `components/KoreanPanel.tsx`: verify the existing `Omit<TranscriptPanelProps, 'title'|'language'|'emptyLabel'>` pass-through automatically forwards the two new optional audio props; edit only if the `Omit` set wrongly excludes them. Design §7. Gate: tc/lint.

## Phase 6: Manual Verification (no automated gate covers these)

- [ ] 6.1 `manual` TTS autoplay fires on turn `done` (gesture context from the click-to-stop satisfies browser autoplay policy); when blocked, "Reproducir" button appears and plays on click; "Reintentar audio" on 502/504. Spec: speech-synthesis (all scenarios).
- [ ] 6.2 `manual` Switch tabs / minimize while actively recording → recording force-stops, transcription proceeds; no-op when idle. Spec: voice-capture Req "Visibility-Loss Auto-Stop".
- [ ] 6.3 `manual` Click-toggle feel: click starts, click again stops, click ignored while transcribing/translating/back-translating (`state.draft` gated), variant flips to destructive while recording. Spec: voice-capture Req "Click-Toggle Recording Lifecycle".
- [ ] 6.4 `manual` Full ES→KO and KO→ES round trip: back-translation renders on target panel under the translation with in-progress skeleton+badge, turn still reaches `done` if `/api/backtranslate` fails (simulate by breaking the route temporarily). Spec: translation-verification + interpreter-ui (all scenarios).
- [ ] 6.5 `manual` Korean voice quality spot-check (numerals, dates, brand names) against the chosen `ELEVENLABS_VOICE_ID`; swap via env if unacceptable. Design "Open risks".
