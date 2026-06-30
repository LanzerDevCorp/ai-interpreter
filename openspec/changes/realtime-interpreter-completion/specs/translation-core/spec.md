# Translation Core Specification

## Purpose

Direction-aware ES↔KO translation served by `/api/interpret`, producing a business-register translation plus a verification gloss in the speaker's source language, informed by a bidirectional glossary and short conversation context.

## Requirements

### Requirement: Direction-Aware System Prompt

The system MUST build a system prompt parametrized by translation direction (`es-ko` or `ko-es`) via `buildSystemPrompt(direction)`.

The prompt MUST instruct the model to translate intent over literal wording, collapsing redundancy, and to use a formal business register in the target language.

The prompt MUST instruct the model to preserve brand/product names untranslated, and to preserve exact figures, monetary amounts, and deadlines verbatim.

#### Scenario: ES to KO direction

- GIVEN direction `es-ko`
- WHEN `buildSystemPrompt` is invoked
- THEN the returned prompt instructs translation into Korean business register
- AND instructs the gloss to be produced in Spanish

#### Scenario: KO to ES direction

- GIVEN direction `ko-es`
- WHEN `buildSystemPrompt` is invoked
- THEN the returned prompt instructs translation into Spanish business register
- AND instructs the gloss to be produced in Korean

#### Scenario: Figures and brand names preserved

- GIVEN source text containing a brand name, a monetary amount, and a deadline date
- WHEN the model translates per the system prompt instructions
- THEN the brand name MUST remain untranslated
- AND the amount and deadline MUST appear unchanged in the translation

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

### Requirement: Delimited Streaming Output Format

The `/api/interpret` route MUST stream the model output as plain delimited text: the translation (`traducción`) first, followed by the literal separator `\n---\n`, followed by the verification gloss (`glosa`).

The gloss MUST always be produced in the speaker's source language (the language of the original `text`, not the translation target).

#### Scenario: Streamed response shape

- GIVEN a confirmed turn with direction `es-ko`
- WHEN `/api/interpret` streams its response
- THEN the stream content, once fully read, contains the Korean translation, then `\n---\n`, then a Spanish gloss

#### Scenario: Gloss language matches speaker, not target

- GIVEN direction `ko-es` (speaker spoke Korean)
- WHEN the response stream completes
- THEN the gloss segment is in Korean, even though the translation segment is in Spanish

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

The system MUST expose `POST /api/interpret` accepting `{ text: string, direction: 'es-ko' | 'ko-es', history: Turn[] }` and MUST respond with a text stream (not echoed input).

#### Scenario: Valid request streams translation

- GIVEN a POST with valid `text`, `direction`, and `history`
- WHEN the request is processed
- THEN the response is a streamed text body per the delimited output format, not an echo of the input
