# Proposal: Complete the ES↔KO Real-Time Interpreter MVP (Fases 3–5, Fase 4 redesigned)

## Intent

Phases 0–2 (scaffold, Vercel/Gateway OIDC link, echo-test `/api/interpret`) are live. The app cannot yet interpret anything: there is no real translation prompt, no glossary, no voice capture, and no two-panel UI. This change delivers ALL remaining work to make the MVP usable in a real aesthetic-medicine business meeting, with Fase 4 voice capture redesigned to drop the browser-only Web Speech API in favor of Groq Whisper transcription. **This proposal supersedes the Fase 4 section of `plan.md`** (the Mermaid STT subgraph and the `hooks/useSpeechRecognition.ts` file entry).

## Scope

### In Scope
- **Fase 3 — Translation core**: `lib/system-prompt.ts` (direction-aware ES↔KO prompt: intent over literal, registry, delimited `traducción`/`glosa`), `lib/glossary.ts` (bidirectional, placeholder entries for procedimientos/finanzas/marcas), wired into `app/api/interpret/route.ts` to replace the echo test with a real translation call. Validated both directions against real model output.
- **Fase 4 — Groq voice capture (redesigned)**: `app/api/transcribe/route.ts` (FormData audio → `@ai-sdk/groq` `groq.transcription('whisper-large-v3-turbo')` → `{ text }`); `useAudioCapture` push-to-talk hook using `MediaRecorder`; `components/DirectionToggle.tsx`.
- **Fase 5 — UI**: `lib/types.ts` (`Turn` with `record/transcribing/translating/done/error` status), `SpanishPanel`/`KoreanPanel`, two-column `app/page.tsx`, localStorage turn history, "Nueva sesión" reset.

### Out of Scope
- Live partial/interim transcript (not possible with a request/response STT API; UX becomes record → ~1–2s transcribing indicator → editable draft).
- Web Speech API fallback or dual-mode (full replacement, no `useSpeechRecognition.ts`).
- Silence-detection / VAD auto-segmentation (push-to-talk only for MVP).
- Cross-browser `MediaRecorder` codec negotiation beyond default Chrome/Edge webm/opus.
- Production Whisper backend swap, multi-device/multi-mic, auto language detection.

## Locked Decisions (confirmed by user — do not re-litigate)
1. New `GROQ_API_KEY` secret (Vercel env + `.env.local`), explicitly documented as an exception to the OIDC-only/zero-manual-keys pattern (which still holds for Gateway text models). Groq does NOT route through the AI Gateway.
2. UX: record → brief transcribing indicator (~1–2s) → full editable draft. Supersedes plan.md "Flujo de corrección" live-growing draft.
3. Push-to-talk (press-and-hold / start-stop) is the MVP capture gesture — avoids false cuts and stays under Groq free-tier 20 RPM.
4. Full Web Speech API replacement via `MediaRecorder` + Groq; `useSpeechRecognition.ts` dropped.

## Capabilities

### New Capabilities
- `translation-core`: direction-aware ES↔KO translation prompt + bidirectional glossary, served by `/api/interpret` streaming translation + verification gloss.
- `voice-capture`: push-to-talk `MediaRecorder` capture + `/api/transcribe` Groq Whisper endpoint returning draft text.
- `interpreter-ui`: two-panel layout, turn lifecycle model, direction toggle, localStorage history, session reset.

### Modified Capabilities
- None (Fases 3–5 are greenfield; `/api/interpret` echo test is replaced, not a prior spec'd capability).

## Approach

Direct `@ai-sdk/groq` provider (new dependency) keyed by `GROQ_API_KEY`, called server-side from a new `/api/transcribe` route that reads the audio Blob via `await file.arrayBuffer()`. Client `useAudioCapture` records webm/opus while the button is held, POSTs to `/api/transcribe`, and surfaces the returned text as an editable draft. Confirming a draft POSTs to the existing `/api/interpret`, now backed by `buildSystemPrompt(direction)` + `buildGlossaryBlock(direction)`, streaming `traducción` then `\n---\n` then `glosa` in the speaker's language. Text models keep OIDC Gateway routing; only transcription uses the manual Groq key.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/api/interpret/route.ts` | Modified | Echo test → real translation call |
| `lib/system-prompt.ts` | New | Direction-aware prompt builder |
| `lib/glossary.ts` | New | Bidirectional glossary + block helper |
| `lib/types.ts` | New | `Turn` model with new status enum |
| `app/api/transcribe/route.ts` | New | Groq Whisper transcription endpoint |
| `hooks/useAudioCapture.ts` | New | Push-to-talk MediaRecorder hook |
| `components/DirectionToggle.tsx` | New | Who-is-speaking ES/KO toggle |
| `components/SpanishPanel.tsx`, `KoreanPanel.tsx` | New | Per-language turn columns |
| `app/page.tsx` | New | Two-column layout + localStorage |
| `package.json` | Modified | Add `@ai-sdk/groq` |
| `.env` / `.env.local` / `.env.local.example` | Modified | Add `GROQ_API_KEY` |
| `plan.md` | Superseded (Fase 4) | STT subgraph + `useSpeechRecognition.ts` no longer apply |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Groq free-tier 20 RPM ceiling | Med | Push-to-talk pacing; flag if paid tier needed |
| New secret weakens OIDC-only story | High (accepted) | Documented exception; key scoped to transcription only |
| UX regression (no live transcript) | High (accepted) | Brief indicator + editable draft; human-in-loop confirm already required |
| Safari/non-Chromium codec issues | Low | MVP targets Chrome/Edge webm/opus; broader support deferred |
| Delimited LLM output fragile | Low | Fallback to `Output.object()` if `\n---\n` proves unreliable in testing |

## Rollback Plan

Each fase is independent. Fase 5 UI can revert to the prior empty `page.tsx`; Fase 4 transcribe route + hook + `@ai-sdk/groq` + `GROQ_API_KEY` can be removed as a unit (interpret route keeps working); Fase 3 restores the echo-test `/api/interpret`. No data migrations — turn history lives only in browser localStorage, cleared by removing the key.

## Dependencies

- New npm dependency `@ai-sdk/groq`.
- Manual `GROQ_API_KEY` provisioned in Vercel env + `.env.local`.
- Existing OIDC `VERCEL_OIDC_TOKEN` + `DEFAULT_MODEL` (already in place from Fase 1).

## Open Questions (non-blocking)

- Groq **paid-tier** rate limits not confirmed from docs — resolve only if firm headroom guarantees become a requirement.
- Cross-browser `MediaRecorder` support — deferred unless Safari/Firefox is later required.

## Success Criteria

- [ ] `/api/interpret` returns real ES→KO and KO→ES translations + verification gloss (validated against live model output, both directions).
- [ ] Push-to-talk records audio, `/api/transcribe` returns accurate draft text in ~1–2s.
- [ ] Two-panel UI shows turn lifecycle, persists history across refresh, resets via "Nueva sesión".
- [ ] No Web Speech API code remains; `GROQ_API_KEY` documented as the sole manual secret.
