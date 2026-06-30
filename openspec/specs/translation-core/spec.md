# Translation Core Specification

## Purpose

Direction-aware ES↔KO translation served by `/api/interpret`, producing a single business-register translation in first person, informed by a bidirectional glossary and short conversation context. Round-trip verification is NOT part of this capability's output contract (see `translation-verification`).

> **Design note**: `/api/interpret`'s output contract drops the trailing `\n---\n<glosa>` segment entirely — it now streams ONLY the translation. The prior embedded "gloss" was a parallel summary, not a literal back-translation, and could not actually verify accuracy (the problem the parent proposal opens with). Round-trip verification is now a dedicated, independently-triggered capability (`translation-verification`) with its own literal-translation contract. Keeping a redundant embedded gloss alongside a real back-translation would duplicate verification mechanisms, increase per-turn latency/tokens, and risk the two verification signals disagreeing. Removing it from translation-core is the direct fix, not an unrelated simplification.

## Requirements

### Requirement: Direction-Aware System Prompt

The system MUST build a system prompt parametrized by translation direction (`es-ko` or `ko-es`) via `buildSystemPrompt(direction)`.

The prompt MUST instruct the model to translate intent over literal wording, collapsing redundancy, and to use a formal business register in the target language.

The prompt MUST instruct the model to preserve brand/product names untranslated, and to preserve exact figures, monetary amounts, and deadlines verbatim.

The prompt MUST instruct the model to output ONLY the translation, with no gloss, summary, or secondary segment.

#### Scenario: ES to KO direction

- GIVEN direction `es-ko`
- WHEN `buildSystemPrompt` is invoked
- THEN the returned prompt instructs translation into Korean business register
- AND does not instruct production of any gloss or secondary output

#### Scenario: KO to ES direction

- GIVEN direction `ko-es`
- WHEN `buildSystemPrompt` is invoked
- THEN the returned prompt instructs translation into Spanish business register

#### Scenario: Figures and brand names preserved

- GIVEN source text containing a brand name, a monetary amount, and a deadline date
- WHEN the model translates per the system prompt instructions
- THEN the brand name MUST remain untranslated
- AND the amount and deadline MUST appear unchanged in the translation

### Requirement: First-Person, Anti-Meta Translation Style

The prompt MUST instruct the model to restate the speaker's idea in first person, as if the model itself were speaking the translated sentence, never as a third-person description of the source utterance.

The prompt MUST explicitly prohibit meta-commentary or summary framing (e.g., "Explicación del funcionamiento…", "El hablante dice que…") and MUST include at least one contrastive Mal/Bien (wrong/right) example illustrating the prohibited pattern versus the required first-person pattern.

#### Scenario: First-person restatement instructed

- GIVEN any direction
- WHEN `buildSystemPrompt` is invoked
- THEN the prompt instructs first-person restatement of the speaker's message
- AND the prompt contains a Mal/Bien contrastive example

#### Scenario: Meta-summary explicitly prohibited

- GIVEN the source text is a direct statement made by the speaker
- WHEN the model follows the system prompt
- THEN the translation MUST NOT begin with a third-person meta-description of what the speaker said
- AND MUST instead restate the content directly, in first person

### Requirement: Bidirectional Glossary

The system MUST maintain a single glossary (`lib/glossary.ts`) organized into categories `procedimientos`, `finanzas`, and `marcas`, where each entry has the shape `{ es, ko, nota? }`.

The system MUST expose `buildGlossaryBlock(direction)` that renders glossary entries as injectable prompt text, with the entry order/labeling oriented toward the active direction (source term first).

#### Scenario: Glossary block reflects direction

- GIVEN the glossary contains at least one entry per category
- WHEN `buildGlossaryBlock('es-ko')` is called
- THEN the block lists each entry with the Spanish term as source and Korean term as target
- WHEN `buildGlossaryBlock('ko-es')` is called instead
- THEN the block lists each entry with the Korean term as source and Spanish term as target

#### Scenario: Empty glossary does not break prompt construction

- GIVEN the glossary array is empty
- WHEN `buildGlossaryBlock(direction)` is called
- THEN it returns a valid (possibly empty) string without throwing

### Requirement: Translation-Only Streaming Output Format

The `/api/interpret` route MUST stream the model output as plain text containing ONLY the translation — no delimiter, no secondary segment, no gloss.

(Previously: streamed `<traducción>\n---\n<glosa>`, with the gloss in the speaker's source language; see Purpose design note for why the gloss segment was removed.)

#### Scenario: Streamed response shape

- GIVEN a confirmed turn with direction `es-ko`
- WHEN `/api/interpret` streams its response
- THEN the stream content, once fully read, contains only the Korean translation
- AND contains no `---` delimiter or trailing segment

#### Scenario: Client does not need to split the stream

- GIVEN the streamed response for any direction
- WHEN the client renders the streaming text as it arrives
- THEN the full accumulated text is the translation itself, requiring no delimiter parsing

### Requirement: Conversation Context Window

The `/api/interpret` route MUST accept a `history` parameter and include only the last 6 to 10 prior turns (spanning both directions) in the context sent to the model.

#### Scenario: History exceeds window

- GIVEN a `history` array of 15 prior turns
- WHEN `/api/interpret` is invoked
- THEN the request to the model includes at most the 10 most recent turns

#### Scenario: History empty on first turn

- GIVEN an empty `history` array
- WHEN `/api/interpret` is invoked
- THEN the request proceeds with no prior-turn context and does not error

### Requirement: Interpret Endpoint Contract

The system MUST expose `POST /api/interpret` accepting `{ text: string, direction: 'es-ko' | 'ko-es', history: Turn[] }` and MUST respond with a text stream containing only the translation (not echoed input, not a delimited multi-segment payload).

(Previously: response stream was a delimited `<traducción>\n---\n<glosa>` payload.)

#### Scenario: Valid request streams translation

- GIVEN a POST with valid `text`, `direction`, and `history`
- WHEN the request is processed
- THEN the response is a streamed text body containing only the translation, not an echo of the input

#### Scenario: Invalid request rejected

- GIVEN a POST missing `text` or with an invalid `direction` value
- WHEN the request is processed
- THEN the route MUST respond with an error status and MUST NOT invoke the model
