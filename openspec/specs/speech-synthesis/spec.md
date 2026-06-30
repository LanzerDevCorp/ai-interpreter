# Speech Synthesis Specification

## Purpose

Server-side text-to-speech generation for completed translations via `@ai-sdk/elevenlabs` (`eleven_multilingual_v2`), exposed at `POST /api/speech`, with client-side autoplay on turn completion, a fallback control when the browser blocks autoplay, and graceful degradation when TTS is not configured.

## Requirements

### Requirement: Speech Synthesis Endpoint Contract

The system MUST expose `POST /api/speech` accepting `{ text: string, language: 'es' | 'ko' }` (or an equivalent direction-derived language indicator) and, on success, MUST respond with `audio/mpeg` byte content generated via the `eleven_multilingual_v2` model.

The route MUST call ElevenLabs server-side using `ELEVENLABS_API_KEY`; this call MUST NOT route through the AI Gateway.

#### Scenario: Successful synthesis

- GIVEN a POST with non-empty `text` and a supported `language`
- WHEN `/api/speech` processes the request and `ELEVENLABS_API_KEY` is configured
- THEN the response is `200` with an `audio/mpeg` body containing synthesized speech of `text`

#### Scenario: Missing or empty text rejected

- GIVEN a POST with empty or missing `text`
- WHEN the route processes the request
- THEN it MUST respond with an error status and MUST NOT call ElevenLabs

### Requirement: Missing API Key Fail-Soft

If `ELEVENLABS_API_KEY` is not configured, `POST /api/speech` MUST respond with a distinct, non-crashing error status (not an unhandled exception), and the rest of the application (transcription, translation, back-translation) MUST continue to function normally without TTS.

#### Scenario: Key absent does not break the app

- GIVEN `ELEVENLABS_API_KEY` is unset
- WHEN a turn completes and the client requests `/api/speech`
- THEN the route responds with a handled error (not a 500 from an unhandled exception)
- AND the turn's text panels and back-translation continue to render normally

#### Scenario: Key absent surfaces no audio, not a visible app error

- GIVEN `ELEVENLABS_API_KEY` is unset
- WHEN the client's autoplay trigger fires for a completed turn
- THEN no audio plays and no blocking error is shown to the user for that turn

### Requirement: Autoplay on Completed Translation

When the client is notified that a turn reached `done` (per `interpreter-ui`'s autoplay trigger), it MUST fetch synthesized audio for that turn's translated text and attempt playback immediately, using a recent user gesture context where available (e.g., the click that stopped capture) to satisfy browser autoplay policies.

#### Scenario: Audio plays without further interaction

- GIVEN a turn completes with translated text and TTS is configured
- WHEN the client fetches `/api/speech` and receives audio bytes
- THEN playback starts automatically, without requiring an additional click

#### Scenario: Audio for a new turn does not overlap a still-playing previous turn

- GIVEN audio for turn A is currently playing
- WHEN turn B reaches `done` and its audio becomes available
- THEN turn A's playback MUST stop (or be allowed to finish) before turn B's audio starts — overlapping simultaneous playback MUST NOT occur

### Requirement: Autoplay-Blocked Fallback Control

If the browser blocks automatic playback (the play attempt's promise rejects per browser autoplay policy), the UI MUST present a manual play control for that turn's audio instead of silently failing.

#### Scenario: Autoplay blocked shows a play button

- GIVEN the browser rejects the automatic play attempt for a turn's synthesized audio
- WHEN the rejection is detected
- THEN the UI displays a manual play control for that turn
- AND activating it plays the already-fetched audio

#### Scenario: Manual control not shown when autoplay succeeds

- GIVEN the browser allows automatic playback
- WHEN audio plays successfully without rejection
- THEN no manual play control is shown for that turn

### Requirement: Speech Generation Failure Handling

If `/api/speech` fails (network error, non-2xx response, or ElevenLabs error) for a given turn, the failure MUST be isolated to that turn's audio — it MUST NOT affect the turn's text content, status, or other turns' audio.

#### Scenario: Generation failure does not affect text display

- GIVEN a turn has reached `done` with visible translated text
- WHEN `/api/speech` fails for that turn
- THEN the translated text and turn status remain displayed and unaffected
- AND no audio plays for that turn, with no playback control shown
