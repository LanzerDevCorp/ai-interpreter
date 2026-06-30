# Interpreter UI Specification

## Purpose

Two-panel ES/KO interpreter UI tracking per-turn lifecycle (including round-trip verification and spoken playback), a direction toggle for who-is-speaking, chronologically unified per-language panels, and session history persisted in `localStorage`.

## Requirements

### Requirement: Turn Lifecycle States

Each `Turn` MUST carry a `status` field with one of the values: `recording`, `transcribing`, `translating`, `back-translating`, `done`, or `error`, and the UI MUST visually distinguish each state.

A turn MUST progress `recording` → `transcribing` → `translating` → `back-translating` → `done`, or transition to `error` from `transcribing` or `translating`. Failure of the back-translation step MUST NOT transition the turn to `error`; it MUST still reach `done` (see `translation-verification` for the failure contract).

(Previously: lifecycle ended at `translating` → `done` with no verification step between them.)

#### Scenario: Happy path progression

- GIVEN a new turn is created when the user starts recording
- WHEN recording stops, transcription succeeds, translation succeeds, and back-translation succeeds in sequence
- THEN the turn's status transitions `recording` → `transcribing` → `translating` → `back-translating` → `done`, in order, with no skipped or reordered states

#### Scenario: Error during transcription

- GIVEN a turn in `transcribing` status
- WHEN `/api/transcribe` fails
- THEN the turn's status becomes `error`
- AND the turn is NOT silently dropped from the panel history

#### Scenario: Error during translation

- GIVEN a turn in `translating` status with a confirmed draft already submitted
- WHEN `/api/interpret` fails or the stream errors
- THEN the turn's status becomes `error`
- AND the original (untranslated) text remains visible on the turn

#### Scenario: Back-translation failure does not error the turn

- GIVEN a turn in `back-translating` status with a successfully completed translation
- WHEN the back-translation request fails
- THEN the turn's status still becomes `done`
- AND the translated text remains displayed; only the verification text is absent

### Requirement: Direction Toggle

The `DirectionToggle` component MUST let the user select who is currently speaking (ES or KO), and the selected value MUST determine the `direction` (`es-ko` or `ko-es`) sent on the next turn's `/api/interpret` request.

#### Scenario: Toggle changes next turn's direction

- GIVEN the toggle is set to "ES speaking"
- WHEN the user switches it to "KO speaking" and then records a new turn
- THEN the new turn is submitted with direction `ko-es`

#### Scenario: Toggle does not retroactively affect prior turns

- GIVEN a turn already exists with direction `es-ko`
- WHEN the toggle is switched afterward
- THEN the existing turn's direction and displayed content remain unchanged

### Requirement: Chronological Unified Panels

`SpanishPanel` MUST display, in a single chronological list, both turns originally spoken in Spanish and turns translated into Spanish from Korean. `KoreanPanel` MUST do the same symmetrically for Korean.

#### Scenario: Mixed-direction turns appear in order

- GIVEN turns alternate between `es-ko` and `ko-es` directions across a session
- WHEN the panels render
- THEN `SpanishPanel` shows all Spanish-original and Spanish-translated content in chronological order
- AND `KoreanPanel` shows all Korean-original and Korean-translated content in chronological order, independent of `SpanishPanel`'s ordering logic

### Requirement: Back-Translation Display on Target Panel

The verification (back-translation) text for a turn MUST render on the TARGET panel — the panel showing the translated text — directly beneath that translation, never on the speaker's own (source) panel.

While a turn is in `back-translating` status, the target panel MUST show an in-progress indicator beneath the already-visible translation. Once back-translation completes, the indicator MUST be replaced by the literal back-translated text.

(Previously: the verification "gloss" rendered on the speaker's own source-language panel, beneath the original transcript.)

#### Scenario: Verification renders under the translation, not the original

- GIVEN a turn with direction `es-ko` that has reached `done` with a back-translation present
- WHEN the panels render
- THEN the back-translation text appears under the Korean translation on `KoreanPanel`
- AND no verification text appears on `SpanishPanel` for that turn

#### Scenario: In-progress indicator while back-translating

- GIVEN a turn in `back-translating` status with its translation already fully rendered
- WHEN the target panel renders that turn
- THEN it shows the completed translation plus a back-translation-in-progress indicator beneath it

### Requirement: LocalStorage Persistence

The turn history MUST be persisted to `localStorage` on every turn update and MUST be restored on page load, surviving an accidental browser refresh.

#### Scenario: History survives refresh

- GIVEN a session has at least one `done` turn
- WHEN the user refreshes the page
- THEN the previously recorded turns are restored and displayed in their original chronological order and status

#### Scenario: No persisted history on first load

- GIVEN `localStorage` has no prior turn data
- WHEN the page loads
- THEN the UI renders empty panels without error

### Requirement: Session Reset

The UI MUST provide a "Nueva sesión" action that clears all turn history from both panels and from `localStorage`.

#### Scenario: Reset clears panels and storage

- GIVEN a session with existing turns
- WHEN the user activates "Nueva sesión"
- THEN both panels become empty
- AND the corresponding `localStorage` entry no longer contains the prior turns

### Requirement: Autoplay Trigger on Turn Completion

When a turn's status transitions to `done`, the UI MUST automatically request synthesized speech for that turn's translated text and play it without requiring an explicit user action, unless the browser blocks autoplay (see `speech-synthesis` for the generation/fallback contract owned by that capability).

#### Scenario: Audio plays automatically on completion

- GIVEN a turn transitions to `done` with non-empty translated text
- WHEN the transition occurs
- THEN the UI triggers speech synthesis and playback for that turn's translation without further user interaction

#### Scenario: Autoplay trigger does not block status display

- GIVEN a turn just transitioned to `done`
- WHEN speech synthesis has not yet returned audio
- THEN the turn's `done` status and translated text remain fully visible, unaffected by pending audio generation
