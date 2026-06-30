# Exploration: TTS + UX refinements (`tts-and-ux-refinements`)

## Current State

- `lib/system-prompt.ts`: single `buildSystemPrompt(direction)` instructions string. Output contract `<traducción>\n---\n<glosa>`. The glosa paragraph reads *"La glosa es un resumen breve en el idioma del hablante (${source}) que le permite confirmar que la traducción capturó lo que dijo."* No first-person or anti-meta-language instruction exists anywhere.
- `lib/types.ts` `Turn`: `gloss` is one field, filled by the same streamed call as `translated` — there is no second model call anywhere in the app.
- `app/api/interpret/route.ts`: one `streamText()` call per turn, piped via `createTextStreamResponse`.
- `components/transcript-panel.tsx`: `showGloss = speakerSide && turn.gloss.length > 0 && ...` — gloss renders only on the speaker's own panel today.
- `app/page.tsx` + `hooks/useAudioCapture.ts`: press-and-hold. `useAudioCapture` is already `status`-gated (`idle|recording|transcribing|error`) and has an unmount cleanup that force-stops regardless of click state. No min-duration guard, no visibility/focus-loss handling.
- No TTS code exists anywhere in the repo.

## Affected Areas

- `lib/system-prompt.ts` — gloss wording fix (item 4); possibly a second, literally-framed prompt function if item 3 goes round-trip.
- `lib/types.ts` — `Turn.gloss` semantics/doc-comment; new pending-state if round-trip is chosen.
- `components/transcript-panel.tsx` — `showGloss`/`isSpeakerSide` is the single boolean item 3(a) flips.
- `app/api/interpret/route.ts` — unchanged for 3(a); needs a chained second call for 3(b).
- `app/page.tsx`, `hooks/useAudioCapture.ts` — click-toggle wiring (item 2); new TTS-call + autoplay wiring (item 1).
- New surface: a TTS route (e.g. `app/api/speech/route.ts`), client playback util, new manual provider key in `.env.local.example`.

## Item 1 — Text-to-Speech (research)

**Gateway routing — confirmed live (2026-06-30) against `https://ai-gateway.vercel.sh/v1/models`**: two independent fetches, searched for `tts|speech|audio|voice|whisper|elevenlabs|playai|cartesia` — zero matches (only video models with embedded audio, e.g. Kling/Veo). **AI Gateway does not route any TTS capability**, exactly mirroring the prior Groq-STT finding in `design.md` decision #4.

**`generateSpeech()` is real in `ai@7.0.6`** — verified directly in `node_modules/ai/dist/index.d.ts` (~line 7774): `generateSpeech({ model: SpeechModel, text, voice?, outputFormat?: 'mp3'|'wav'|string, instructions?, speed?, language?, providerOptions? }) => Promise<SpeechResult>` (`result.audio` is a `GeneratedAudioFile`). **No streaming variant exists** — grepped for `streamSpeech`/`SpeechStream`, zero matches. This is request/response only: full audio must finish generating before any playback, regardless of provider, even if that provider has its own low-latency streaming endpoint outside the AI SDK.

**Groq ruled out**: grepped `node_modules/@ai-sdk/groq/dist/index.d.ts` in full — zero "speech" matches, no `.speech()` factory exists. Separately, Groq's own PlayAI Dialog TTS supports only English/Arabic today — no Korean either way.

**Viable candidates**: `@ai-sdk/openai` (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`), `@ai-sdk/elevenlabs` (`eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`, ...), `@ai-sdk/lmnt`, Google (`gemini-2.5-flash-preview-tts`/`gemini-3.1-flash-tts-preview`).

**Korean quality**: ElevenLabs is the most consistently cited Korean quality leader (Eleven v3, 70+ languages, MOS ~4.14; Flash v2.5 supports Korean at ~75ms TTFB on ElevenLabs' own streaming endpoint — not reachable via AI SDK's non-streaming call; default voices can carry English-accent artifacts into Korean, pick a Korean-tagged voice and test numerals/dates). `gpt-4o-mini-tts` supports Korean among 50+ languages but is "optimized for English," with a reported quality edge for English over Korean; much cheaper. Google Chirp 3 HD/Gemini TTS is closing the gap.

**Auth**: every candidate needs a direct, manually-managed key (`ELEVENLABS_API_KEY` / `OPENAI_API_KEY`) — none fit OIDC/Gateway, because Gateway doesn't route TTS at all; this is unavoidable, not a differentiator, and follows the `GROQ_API_KEY` precedent.

**Recommendation**: `@ai-sdk/elevenlabs` + `eleven_multilingual_v2` (quality-priority) as primary; `eleven_flash_v2_5` as a latency fallback if measured generation time is unacceptable; `gpt-4o-mini-tts` as the cheaper fallback if cost/key-sprawl outweighs the Korean-quality gap. Flag explicitly: no streaming means autoplay latency = full TTS generation time stacked *after* the translation stream finishes — measure this empirically before promising a UX feel.

## Item 2 — Capture UX (quick scope)

Real new risk vs. press-and-hold: **background-tab/forgot-to-stop**. `MediaRecorder` keeps recording in a hidden tab; `stop()` is purely manual today; press-and-hold made this impossible by construction (OS-enforced pointer release), toggle removes that safety net. Double-click and SPA-navigation-mid-recording are already handled or roughly equivalent-risk (unmount cleanup already force-stops; reducer already guards re-entry via `if (state.draft) return state`).

1. **Simple toggle** — one `onClick` swapping `start`/`stop` by `status`. Low effort, leaves the focus-loss gap open.
2. **Toggle + safety net (recommended)** — same toggle + min-recording-duration guard + a `visibilitychange` auto-stop inside `useAudioCapture`. Medium effort, closes both real new risks.

Also: `aria-label="Mantené presionado para hablar"` and hold-semantics copy must change regardless of option.

## Item 3 — Back-translation placement (quick scope)

Confirmed: today's `gloss` is **not** a true round-trip — it's generated by the same call, in parallel from the original text, never derived from the model's own `translated` output. It only resembles a back-translation because it's in the source language.

1. **(a) Same-call, render-only** — flip `showGloss = speakerSide && ...` to `!speakerSide`. Zero latency/cost, one-line diff. **Does not deliver true accuracy verification** — can falsely reassure or falsely alarm since it's an independent parallel production, not derived from `translated`.
2. **(b) True round-trip** — second, smaller call after the first finishes, with an explicitly LITERAL prompt translating `translated` back to source. Genuinely catches translation errors; doubles latency/cost for the verification segment and needs a new pending-state in the UI.

Recommendation: the user's stated goal ("verify translation accuracy by reading both together") is only truly met by (b); (a) looks like the feature but answers a different question — surface this gap explicitly at proposal time rather than letting (a) get picked by default for its cheapness.

## Item 4 — System prompt fix (diagnosis)

Literal trigger text: *"La glosa es un **resumen breve**... que le permite **confirmar** que la traducción capturó lo que dijo."* Two compounding causes: (1) "resumen breve" literally instructs summarization, which models tend to execute in third-person expository register; (2) "que le permite confirmar... lo que dijo" describes the gloss's purpose in third person, and models mirror nearby instruction register absent a contrary anchor. No positive first-person instruction or negative anti-meta constraint exists anywhere to counteract this.

1. Minimal wording swap — replace the clause with explicit first-person + anti-meta language ("...en primera persona, como si el propio hablante la repitiera... NUNCA una descripción en tercera persona").
2. Add a contrastive anti-pattern example ("Mal: 'Explicación del funcionamiento...' / Bien: '<idea en primera persona>'") — highest leverage since the failure is observed, not hypothetical.
3. Fold the first-person rule into the shared "Reglas de traducción" so both translation and gloss/back-translation inherit it from one place (defense in depth).

Recommendation: combine 1+2 as the actual fix; apply 3's structuring regardless of item-3's outcome — but if item 3 picks round-trip (b), that second-pass prompt must stay strictly literal and must NOT inherit the "natural first-person paraphrase" framing, since faithfulness is what makes it useful as a check.

## Risks

- No streaming TTS in `ai@7.0.6` — "near-instant autoplay" needs empirical latency validation, not assumption.
- No TTS candidate fits OIDC/Gateway — new manual key required regardless of provider chosen.
- Item 3(a) is cheap but doesn't functionally satisfy the stated verification goal — risk of shipping something that looks right but isn't.
- Toggle capture removes press-and-hold's "free" safety net — needs explicit visibilitychange mitigation.
- Korean voice-quality findings are from web/vendor sources, not a hands-on test against this project's actual domain vocabulary (medical-aesthetics/finance terms, brand names) — spot-check before finalizing.

## Ready for Proposal

Yes. Two decisions should be explicitly re-confirmed with the user rather than silently defaulted: (1) item 1's provider/model given the no-streaming latency caveat, and (2) item 3's option (a) vs (b) given (a) doesn't truly deliver the stated verification goal.
