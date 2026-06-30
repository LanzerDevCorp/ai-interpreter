# Exploration: Replace Web Speech API (Fase 4) with Groq Whisper Large V3 Turbo

## Current State

Phases 0-2 are done. `app/api/interpret/route.ts` is a working echo-test using `streamText` + `createTextStreamResponse` from `ai@^7.0.6` (AI SDK v7, not v6 as plan.md's header says — already correctly using v7 APIs). Only `ai` is installed; no `@ai-sdk/*` provider packages are direct dependencies yet. Fases 3-5 are completely unbuilt (`lib/system-prompt.ts`, `lib/glossary.ts`, `lib/types.ts`, `hooks/`, `DirectionToggle`/`SpanishPanel`/`KoreanPanel`/`app/page.tsx` all don't exist) — this is greenfield for the STT redesign, not a refactor.

## Affected Areas

- `lib/types.ts` (new) — `Turn.status` needs a "recording/transcribing" state; drop interim-text fields.
- `app/api/transcribe/route.ts` (new) — receives audio Blob via FormData, calls Groq `transcribe()`, returns `{ text }`.
- `hooks/useSpeechRecognition.ts` (planned in plan.md) is now obsolete — replaced by a `MediaRecorder`-based capture hook + client call to `/api/transcribe`.
- `components/DirectionToggle.tsx`, `SpanishPanel.tsx`, `KoreanPanel.tsx`, `app/page.tsx` — UX shape unchanged (editable draft → manual confirm), but "live growing interim text" becomes "record → brief transcribing spinner → full draft appears."
- Vercel/`.env.local` env vars — needs new `GROQ_API_KEY` (see Risks).
- `package.json` — needs new dependency `@ai-sdk/groq`.

## Research Findings (with sources)

**1. Groq integration mechanics.** AI SDK v7 ships `transcribe()` (confirmed in `node_modules/ai/src/transcribe/transcribe.ts`, `node_modules/ai/docs/03-ai-sdk-core/36-transcription.mdx`), and lists Groq's `whisper-large-v3-turbo` / `whisper-large-v3` as supported transcription models via `groq.transcription('whisper-large-v3-turbo')`. **Groq does not route through the Vercel AI Gateway.** Confirmed two ways: the installed `@ai-sdk/gateway@4.0.5` type defs (`GatewayTranscriptionModelId`) list only `openai/gpt-4o-mini-transcribe`, `openai/gpt-4o-transcribe`, `openai/whisper-1`, `xai/grok-stt` — no `groq/*`; and a live fetch of `https://ai-gateway.vercel.sh/v1/models` (the authoritative no-auth catalog per [Models & Providers docs](https://vercel.com/docs/ai-gateway/models-and-providers)) returned zero `groq/` entries of any kind. Groq is instead a separate **Vercel Marketplace integration** ([vercel.com/docs/agent-resources/integrations-for-models/groq](https://vercel.com/docs/agent-resources/integrations-for-models/groq)), a different mechanism than Gateway routing. The correct package is **`@ai-sdk/groq`** ([ai-sdk.dev/providers/ai-sdk-providers/groq](https://ai-sdk.dev/providers/ai-sdk-providers/groq)), which defaults to `GROQ_API_KEY` and talks directly to `api.groq.com` — **not** the Gateway. This means the project's "zero manually-managed API keys, OIDC-only" story does not hold for transcription: the user must obtain a Groq API key and add it to Vercel env vars + `.env.local` as a new manually-managed secret.

**2. Audio capture/transport.** Groq accepts `flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm` ([console.groq.com/docs/speech-to-text](https://console.groq.com/docs/speech-to-text)) — `webm`/opus, the default Chrome/Edge `MediaRecorder` output, needs no transcoding. Limits: 25MB (free) / 100MB (dev tier), minimum billed length 10s/request. `transcribe()`'s `audio` param takes `DataContent | URL` (no native Blob type) — trivially solved server-side via `await file.arrayBuffer()`. Latency: ~216x real-time speed factor per Groq's own benchmark, with one third-party source citing ~800ms observed end-to-end for short clips — comfortably sub-2s for a several-second utterance, which is fine given the UX already has a human-in-the-loop edit/confirm step (not live captioning). **Push-to-talk is recommended over silence-detection auto-segmentation**: there's no native partial-result signal from a request/response API the way `isFinal` worked for Web Speech, building VAD adds real engineering risk (false cuts, double-triggers), and push-to-talk maps directly onto the manual-confirm gesture already required.

**3. Cost/rate-limits.** Pricing: $0.04/hour (~$0.00067/min) — trivial for a meeting. Free-tier rate limits ([console.groq.com/docs/rate-limits](https://console.groq.com/docs/rate-limits)): 20 requests/minute, 2K/day, 7.2K audio-seconds/hour. The 20 RPM ceiling is the binding constraint — fine for push-to-talk conversational pacing, but could be hit by aggressive auto-VAD segmentation (another argument for push-to-talk in the MVP). Paid-tier exact numbers weren't confirmed from the docs fetched — flag as open question if firm headroom is needed.

**4. Risks/gaps.**

- New secret `GROQ_API_KEY` breaks the established OIDC-only story — must be an explicit user-confirmed decision, not silent.
- New dependency `@ai-sdk/groq` to install.
- `Turn` model needs a recording/transcribing status instead of growing interim text.
- `MediaRecorder` needs the same mic permission + HTTPS as Web Speech API — no new permission burden, and actually has *broader* browser support (Safari included, with codec caveats) than `SpeechRecognition` (Chrome/Edge only) — but cross-browser codec negotiation is extra scope worth explicitly deferring or accepting in the proposal.
- **No live partial transcript** — the plan's "draft grows live while speaking" UX is not achievable with a request/response API; it becomes record → brief spinner → full draft. This is a real behavior change from plan.md's "Flujo de corrección" decision and must be re-confirmed with the user, not silently absorbed.
- The proposal must explicitly supersede the Fase 4 section of plan.md (Mermaid diagram + file list referencing `useSpeechRecognition.ts`).

## Approaches

1. **Direct `@ai-sdk/groq` + new `GROQ_API_KEY`, push-to-talk `MediaRecorder` capture** (recommended) — Pros: officially supported AI SDK pattern, accurate/fast/cheap, webm needs no transcoding, fits manual-confirm UX. Cons: new secret, no live partial transcript, 20 RPM ceiling to respect. Effort: Medium.
2. **Keep Web Speech API primary, Groq as background "cleanup pass"** (not requested, named as rejected alternative) — Pros: keeps live partial text. Cons: doubles complexity, still Chrome/Edge-only, doesn't fulfill the user's explicit "replace" ask. Effort: High.
3. **Silence-detection auto-segmentation instead of push-to-talk** (sub-decision within Approach 1) — Pros: hands-free. Cons: VAD false-cut risk, risks the 20 RPM ceiling, more engineering for a UX that already requires manual confirm anyway. Effort: High vs push-to-talk's Low-Medium.

## Recommendation

Approach 1: direct `@ai-sdk/groq` provider with `GROQ_API_KEY`, push-to-talk `MediaRecorder` capture feeding a new `/api/transcribe` route. This is the officially documented AI SDK v7 pattern for Groq transcription, fulfills the explicit replacement ask, and preserves the existing manual-confirm contract with only the necessary, clearly-flagged behavior change (no live partial transcript). The proposal phase should surface the `GROQ_API_KEY` requirement and the UX change as explicit decisions, and should formally supersede the Fase 4 section of plan.md.

## Risks

- New manually-managed secret breaks the "OIDC-only, zero API keys" narrative — needs explicit user confirmation.
- UX regression from live-growing draft to record-then-transcribe — needs re-confirmation against plan.md's original decision.
- Free-tier 20 RPM ceiling could bite under aggressive auto-segmentation (mitigated by recommending push-to-talk).
- Paid-tier Groq rate limits not fully confirmed from available docs — open question for proposal if firm headroom guarantees matter.
- Safari/non-Chromium `MediaRecorder` codec handling is minor scope creep if cross-browser support is required — recommend deferring unless requested.

## Ready for Proposal

Yes — proceed to `sdd-propose` for change `realtime-interpreter-completion`, pending user confirmation on the 4 open decisions below.
