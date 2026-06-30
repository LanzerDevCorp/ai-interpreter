# Interpreter UI Specification

## Purpose

Two-panel ES/KO interpreter UI tracking per-turn lifecycle, a direction toggle for who-is-speaking, chronologically unified per-language panels, and session history persisted in `localStorage`.

## Requirements

### Requirement: Turn Lifecycle States

Each `Turn` MUST carry a `status` field with one of the values: `record`, `transcribing`, `translating`, `done`, or `error`, and the UI MUST visually distinguish each state.

A turn MUST progress `record` → `transcribing` → `translating` → `done`, or transition to `error` from `transcribing` or `translating` on failure.

#### Scenario: Happy path progression

- GIVEN a new turn is created when the user starts recording
- WHEN recording stops, transcription succeeds, and translation succeeds in sequence
- THEN the turn's status transitions `record` → `transcribing` → `translating` → `done`, in order, with no skipped or reordered states

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
