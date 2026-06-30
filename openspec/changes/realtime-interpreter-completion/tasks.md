# Tasks: Complete the ES↔KO Real-Time Interpreter MVP

Legend: `[P]` = parallelizable within its phase. `[S]` = sequential, depends on a listed task. Gate = `lint` (`npm run lint`), `tc` (`npm run typecheck`), `build` (`npm run build`); no test runner exists in this project. `manual` = browser-only behavior no automated gate can cover.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~820 total (per-PR: ~235 / ~175 / ~210 / ~200) |
| 400-line budget risk | High (total); each work unit individually Low/Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 translation-core → PR2 voice-capture → PR3 ui-components → PR4 ui-wiring (PR4 depends on 1–3; PR1–3 are mutually independent) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | `lib/types.ts`, `lib/glossary.ts`, `lib/system-prompt.ts`, `app/api/interpret/route.ts` | PR 1 | Independent; base = tracker/main per chosen strategy |
| 2 | `package.json` (`@ai-sdk/groq`), `.env.local.example`, `app/api/transcribe/route.ts`, `hooks/useAudioCapture.ts` | PR 2 | Independent of PR1; only shares `lib/types.ts` |
| 3 | `components/DirectionToggle.tsx`, `SpanishPanel.tsx`, `KoreanPanel.tsx` | PR 3 | Independent of PR1/PR2; only shares `lib/types.ts` |
| 4 | `app/page.tsx` rewrite + manual QA | PR 4 | Depends on PR1, PR2, PR3 merged first |

## Phase 1: Foundation

- [x] 1.1 Create `lib/types.ts`: `Direction`, `TurnStatus` (`recording|transcribing|translating|done|error`), `Turn`. Design: Interfaces/Contracts. Spec: interpreter-ui Req1, translation-core Req5. Gate: tc/lint. **Note**: spec prose uses "record"; design's type contract uses "recording" — implement per design (canonical), keep status labels consistent.

## Phase 2: Translation Core (depends on 1.1)

- [x] 2.1 `[P]` `lib/glossary.ts`: `GlossaryEntry`, `glossary` (procedimientos/finanzas/marcas, seed entries per design), `buildGlossaryBlock(direction)`. Spec: translation-core Req2 (direction-oriented block, empty-glossary safety). Gate: tc/lint.
- [x] 2.2 `[S]` (after 2.1) `lib/system-prompt.ts`: `buildSystemPrompt(direction)` — intent-over-literal, business register, brands/figures preserved, gloss-in-speaker-language instruction, appends `buildGlossaryBlock`. Spec: translation-core Req1 (ES→KO, KO→ES, figures/brands scenarios). Gate: tc/lint.
- [x] 2.3 `[S]` (after 1.1, 2.2) Rewrite `app/api/interpret/route.ts`: `instructions = buildSystemPrompt(direction)`; map last 6–10 `history` `Turn`s (both directions) to `ModelMessage[]` (`user`=original, `assistant`=translated, gloss stripped) + current `{role:'user',content:text}`; `streamText({model:process.env.DEFAULT_MODEL!, instructions, messages})`; `createTextStreamResponse`; keep existing 400 validation; `runtime='nodejs'`. Spec: translation-core Req3, Req4 (history truncation/empty), Req5. Gate: tc/lint/build.

## Phase 3: Voice Capture (depends on 1.1; independent of Phase 2)

- [x] 3.1 `[P]` Add `@ai-sdk/groq` to `package.json`, install. Design: Migration/Rollout. Gate: build (install resolves, no peer conflicts).
- [x] 3.2 `[P]` Create `.env.local.example` with `DEFAULT_MODEL` and `GROQ_API_KEY` placeholders. Gate: manual review.
- [x] 3.3 `[S]` (after 3.1) `app/api/transcribe/route.ts`: POST FormData `audio`/`direction`; validate `File` present/non-empty (400) and ≤20MB (413); `groq.transcription('whisper-large-v3-turbo')` via `transcribe()` with `AbortSignal.timeout(30_000)`; map errors 429/502/504/500; `runtime='nodejs'`. Confirm `providerOptions.groq` language field name against installed types (design Open Question). Spec: voice-capture Req2, Req3 (missing-audio, failure). Gate: tc/lint/build.
- [x] 3.4 `[S]` (after 1.1, 3.3) `hooks/useAudioCapture.ts`: `useAudioCapture({direction,onTranscript})`; `getUserMedia` on `start()`, `MediaRecorder` (webm/opus), `dataavailable` collection, `stop()` finalizes Blob → POST `/api/transcribe`; status `idle|recording|transcribing|error`; stop tracks on unmount/after capture; no silence-based auto-stop, no interim text. Spec: voice-capture Req1, Req3 (permission denied), Req4, Req5 (no interim). Gate: tc/lint/build **+ manual** (mic permission/press-hold behavior cannot be verified by build/lint alone).

## Phase 4: UI Components (depends on 1.1; independent of Phase 2/3)

- [x] 4.1 `[P]` `components/DirectionToggle.tsx`: `{value,onChange}` ES/KO segmented control (shadcn `Switch`). Spec: interpreter-ui Req2 (changes next turn only, no retroactive effect). Gate: tc/lint/build.
- [x] 4.2 `[P]` `components/SpanishPanel.tsx`: chronological `Turn[]` list in `ScrollArea`; shows `original` when `direction==='es-ko'` else `translated`; gloss under speaker's side; status visuals per design (`Skeleton`+`Badge` transcribing/translating, editable `Textarea`+"Enviar" for draft, destructive `Badge` on error); `Card`+`Separator` per turn. Spec: interpreter-ui Req1, Req3. Gate: tc/lint/build.
- [x] 4.3 `[P]` `components/KoreanPanel.tsx`: symmetric mirror of 4.2 for Korean. Spec: interpreter-ui Req3 (independent ordering per panel). Gate: tc/lint/build.

## Phase 5: UI Wiring (depends on 2.3, 3.3, 3.4, 4.1–4.3)

- [x] 5.1 Rewrite `app/page.tsx` (`'use client'`): `useReducer` for `{turns,draft,captureStatus}` with named actions covering record→transcribing→translating→done/error; `direction` via `useState`; two-column grid wiring `DirectionToggle` + `useAudioCapture` (press-and-hold via `onPointerDown`/`onPointerUp`/`onPointerLeave`) + `SpanishPanel`/`KoreanPanel`; submits confirmed draft to `/api/interpret`, reads stream incrementally, splits on `"\n---\n"` into translated/gloss; "Nueva sesión" resets state + clears storage key. Spec: interpreter-ui Req1, Req2, Req5; voice-capture Req4. Gate: tc/lint/build — PASSED.
- [x] 5.2 `[S]` (same file, after 5.1) Add `useEffect` persistence: sync only `done`/`error` turns to `localStorage` key `interpreter:v1:turns` on change; read/restore on mount. Spec: interpreter-ui Req4 (survives refresh, empty storage no error), Req5 (reset clears entry). Gate: tc/lint/build — PASSED **+ manual** (refresh persistence has no automated coverage — Phase 6, out of scope for this batch).

## Phase 6: Manual Verification (no automated gate covers these)

- [ ] 6.1 `manual` Mic permission grant/deny, press-and-hold start/stop, no auto-stop on mid-hold silence, transcribing indicator, draft edit before send. Spec: voice-capture (all scenarios). Browser: Chrome/Edge (design's locked target).
- [ ] 6.2 `manual` ES→KO and KO→ES streamed translation render live, delimiter split correct, gloss in speaker's language. Spec: translation-core Req3.
- [ ] 6.3 `manual` Full turn lifecycle visuals, error during transcribing/translating keeps turn visible (not dropped), mixed-direction panel ordering per panel, refresh persistence, "Nueva sesión" clears both panels + storage. Spec: interpreter-ui (all scenarios).
