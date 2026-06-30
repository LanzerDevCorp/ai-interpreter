# Translation Verification Specification

## Purpose

Literal, non-blocking round-trip back-translation of an already-completed translation via `POST /api/backtranslate`, letting the speaker confirm the translation preserved their meaning. Triggered only after the main translation finishes; rendered on the target panel beneath the translation with an in-progress state. Kept as a capability distinct from `translation-core` because it has its own contract (translation text in, literal translation back), its own prompt (strictly literal, not natural-paraphrase), its own trigger point (post-completion, not part of the streaming call), and its own failure mode (must never affect the already-displayed translation).

> **Design note**: this is a separate capability rather than folded back into `translation-core`. `translation-core`'s contract, after this change, is "produce one business-register translation" with no secondary output. Verification is a distinct concern: a second model call, on a different input (the translation, not the original), with an opposite prompt philosophy (strictly literal, not intent-preserving), triggered by a different lifecycle event (stream completion, not request receipt), with independent success/failure semantics (verification failing must not fail the turn). Modeling it as its own capability keeps each spec's requirements testable in isolation and matches the proposal's own architectural choice to give it a dedicated, non-streaming route.

## Requirements

### Requirement: Backtranslate Endpoint Contract

The system MUST expose `POST /api/backtranslate` accepting `{ text: string, direction: 'es-ko' | 'ko-es' }`, where `text` is the already-translated text (the target-language output of `/api/interpret`), and MUST respond with JSON containing the literal back-translation of `text` into the original source language.

#### Scenario: Successful back-translation

- GIVEN a POST with the translated text from a completed turn and its direction
- WHEN `/api/backtranslate` processes the request
- THEN the response is `200` with a JSON body containing the literal back-translation in the speaker's original source language

#### Scenario: Missing text rejected

- GIVEN a POST with empty or missing `text`
- WHEN the route processes the request
- THEN it MUST respond with an error status and MUST NOT call the model

### Requirement: Literal (Non-Paraphrase) Translation Builder

The back-translation MUST be produced using a dedicated system prompt that instructs strictly literal, word-for-word-faithful translation back into the source language, and MUST NOT reuse or inherit the natural-paraphrase, business-register, or first-person framing instructions used by `translation-core`'s main prompt.

#### Scenario: Literal prompt is structurally distinct

- GIVEN any direction
- WHEN the back-translation system prompt is built
- THEN it instructs literal fidelity to the input text
- AND it does not include the main prompt's intent-over-literal-wording instruction

#### Scenario: Literal output differs in purpose from main translation

- GIVEN a translated sentence that was naturally rephrased for fluency by the main translation
- WHEN that sentence is back-translated
- THEN the back-translation MUST prioritize literal correspondence to the translated sentence over producing idiomatic phrasing

### Requirement: Trigger Timing

`/api/backtranslate` MUST be invoked by the client only after the main `/api/interpret` stream has fully completed for a turn (i.e., the translation is already final), and MUST NOT block or delay the display of the completed translation.

#### Scenario: Back-translation starts only after translation completes

- GIVEN a turn's translation stream is still in progress
- WHEN the client is processing incoming translation chunks
- THEN `/api/backtranslate` MUST NOT yet be called for that turn

#### Scenario: Translation display is not delayed by verification

- GIVEN a turn's translation stream just completed
- WHEN the client triggers `/api/backtranslate`
- THEN the completed translation is already visible to the user before the back-translation request resolves

### Requirement: In-Progress and Completed UI State

While `/api/backtranslate` is in flight for a turn, the UI MUST show a back-translation-in-progress indicator beneath the translation on the target panel. Once the response resolves, the indicator MUST be replaced by the literal back-translated text.

#### Scenario: In-progress indicator shown

- GIVEN a turn just transitioned to its back-translation step
- WHEN `/api/backtranslate` has not yet responded
- THEN the target panel shows the translation plus a back-translation-in-progress indicator

#### Scenario: Indicator replaced by literal text on completion

- GIVEN the back-translation-in-progress indicator is showing for a turn
- WHEN `/api/backtranslate` resolves successfully
- THEN the indicator is replaced by the literal back-translation text beneath the translation

### Requirement: Verification Failure Handling

If `/api/backtranslate` fails (network error, non-2xx response, or model error) for a turn, the turn MUST still reach a terminal `done` state with its translation fully visible; only the back-translation text MUST be absent (or replaced by a non-blocking "verification unavailable" indicator).

#### Scenario: Backtranslate failure does not affect the visible translation

- GIVEN a turn's translation is already displayed and back-translation is in flight
- WHEN `/api/backtranslate` fails
- THEN the translation remains fully visible and unchanged
- AND the turn proceeds to `done` without a back-translation present

#### Scenario: No retry blocks turn completion

- GIVEN `/api/backtranslate` has failed for a turn
- WHEN the turn is marked `done`
- THEN the application does not retry indefinitely or hold the turn in a non-terminal state waiting for verification
