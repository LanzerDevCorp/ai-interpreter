# Proposal: TTS + UX Refinements

## Intent

The shipped MVP translates ES↔KO text-to-text. Three gaps remain before it is usable in a live meeting: (1) no spoken Korean output — listeners must read; (2) the source-language "gloss" is an independent parallel summary, not a true back-translation, so it cannot actually verify accuracy and the model often emits third-person meta-summaries ("Explicación del funcionamiento…") instead of restating the idea; (3) press-and-hold capture is awkward for longer turns. This follow-up adds spoken output, a real round-trip verification, and a toggle capture UX.

## Scope

### In Scope
- TTS via `@ai-sdk/elevenlabs` (`eleven_multilingual_v2`), new `app/api/speech` route, autoplay on turn completion, new `ELEVENLABS_API_KEY`.
- True round-trip back-translation: a second model call after the translation stream completes, literally translating `translated` back to the source language; rendered under the TARGET panel bubble with a "back-translating…" state.
- Capture toggle (click-start / click-stop) replacing press-and-hold, plus a `visibilitychange` auto-stop safety net and updated copy/aria-labels.
- System-prompt rewrite: first-person + anti-meta wording, a contrastive Mal/Bien example, first-person rule folded into shared translation rules; a SEPARATE strictly-literal prompt builder for the back-translation.

### Out of Scope
- Streaming TTS (no streaming variant exists in `ai@7.0.6`).
- Latency-fallback providers (`eleven_flash_v2_5`, `gpt-4o-mini-tts`) — deferred unless measured generation time proves unacceptable.
- Voice selection UI, playback controls, audio caching/persistence.

## Capabilities

### New Capabilities
- `speech-synthesis`: server-side TTS generation and client autoplay of completed Korean/Spanish translations.

### Modified Capabilities
- `translation-core`: adds the second literal back-translation call and the dedicated literal prompt; first-person/anti-meta main-prompt rewrite.
- `voice-capture`: press-and-hold replaced by toggle + visibility-loss auto-stop.
- `interpreter-ui`: verification text moves to the target side; new `back-translating` turn state; autoplay wiring.

> Reasoning: `openspec/specs/` is EMPTY — the MVP specs were never promoted there, so there is no promoted baseline to delta against. `speech-synthesis` is genuinely NEW. The other three are requirement-level (not just implementation) changes, so they are MODIFIED; their baseline-of-record is `openspec/changes/realtime-interpreter-completion/specs/<name>/spec.md`, which sdd-spec MUST read first, then promote-and-modify into `openspec/specs/`.

## Approach

- **TTS**: `POST /api/speech` → `generateSpeech()` → returns `audio/mpeg` bytes; client plays via blob URL on turn `done`.
- **Back-translation**: NEW `POST /api/backtranslate` (not folded into the streaming interpret route, which is text-stream-only and cannot append a second payload). Client calls it with the finished `translated` text after the stream closes, driving the `back-translating` state.
- **Turn status**: add ONE value `back-translating` to the lifecycle enum — it is the genuine next sequential phase (recording→transcribing→translating→back-translating→done), so it fits the existing linear model without overloading any value (avoids the `transcribing` dual-meaning trap). The `gloss` field is repurposed to hold the literal back-translation; recommend renaming `gloss`→`backTranslation` (final call deferred to design).
- **Capture**: single `onClick` switching `start`/`stop` by `status`; `visibilitychange` listener inside `useAudioCapture` force-stops a hidden-tab recording.
- **Prompt**: rewrite shared rules; add literal back-translation builder that does NOT inherit the natural-paraphrase framing.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/api/speech/route.ts` | New | ElevenLabs TTS endpoint |
| `app/api/backtranslate/route.ts` | New | Literal round-trip call |
| `lib/system-prompt.ts` | Modified | First-person rewrite + literal builder |
| `lib/types.ts` | Modified | `back-translating` status; `gloss`→`backTranslation` |
| `app/api/interpret/route.ts` | Modified | Unchanged stream; may drop trailing gloss contract |
| `hooks/useAudioCapture.ts` | Modified | Toggle + visibilitychange |
| `app/page.tsx` | Modified | Toggle wiring, back-translate + TTS orchestration |
| `components/transcript-panel.tsx` | Modified | Verification moves to target side; new state UI |
| `.env.local.example`, `package.json` | Modified | `ELEVENLABS_API_KEY`, `@ai-sdk/elevenlabs` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Non-streaming TTS latency stacks AFTER translation finishes | High | Measure generation time empirically; flash/openai fallback ready; show "generando audio…" |
| Round-trip back-translation adds a second round-trip of latency | High | Render translation immediately; back-translation is non-blocking/progressive |
| New manual `ELEVENLABS_API_KEY` (Gateway routes zero TTS) | Certain | Document in `.env.local.example`; fail soft if missing |
| Browser autoplay policy may block audio without recent gesture | Med | Click-to-stop is a recent gesture; fall back to a play button if blocked |
| Korean voice quality unverified against domain vocab | Med | Spot-check numerals/dates/brand names before finalizing voice |

## Rollback Plan

Each item is independently revertible. TTS, back-translation, capture-toggle, and prompt rewrite land as separate commits/slices. Revert the relevant commit; the `back-translating` status and `backTranslation` field are additive (old turns default safely). Removing `ELEVENLABS_API_KEY` disables only TTS. No data migration.

## Dependencies

- `@ai-sdk/elevenlabs` (new); `ELEVENLABS_API_KEY` (manual, non-Gateway).

## Success Criteria

- [ ] Completed Korean translations autoplay as natural Korean audio.
- [ ] Back-translation is a literal round-trip of `translated`, shown under the target bubble, with a visible in-progress state.
- [ ] Click starts/stops capture; hiding the tab auto-stops an active recording.
- [ ] Main prompt restates ideas in first person; no third-person meta-summaries; literal prompt stays faithful.
