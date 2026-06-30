# Voice Capture Specification

## Purpose

Click-to-toggle audio capture via `MediaRecorder`, transcribed server-side through Groq Whisper at `/api/transcribe`, producing editable draft text. Explicitly request/response based — no live partial transcripts or automatic voice-activity segmentation. A tab-visibility safety net force-stops capture if the user navigates away mid-recording.

## Requirements

### Requirement: Click-Toggle Recording Lifecycle

The `useAudioCapture` hook MUST start `MediaRecorder` recording on a single click of the capture control while idle, and MUST stop recording on a subsequent click of the same control while recording — replacing press-and-hold as the interaction model.

The hook MUST NOT auto-segment or auto-stop recording based on silence/voice-activity detection.

A click while the hook is in the `transcribing` state MUST be ignored (no new recording starts until the in-flight transcription resolves).

#### Scenario: Click starts and a second click stops recording

- GIVEN the user has granted microphone permission and capture is `idle`
- WHEN the user clicks the capture control
- THEN `MediaRecorder` transitions to a recording state
- AND WHEN the user clicks the control again
- THEN `MediaRecorder` stops and the recorded audio Blob is finalized

#### Scenario: No auto-stop on silence

- GIVEN the user has toggled recording on, with several seconds of silence in the middle
- WHEN no voice activity is detected during that silence
- THEN recording continues uninterrupted until the user clicks the control again

#### Scenario: Click ignored while transcribing

- GIVEN the hook is in the `transcribing` state after a prior recording was stopped
- WHEN the user clicks the capture control
- THEN no new recording starts until the transcription request resolves

### Requirement: Visibility-Loss Auto-Stop

The `useAudioCapture` hook MUST listen for the document `visibilitychange` event and, if the document becomes hidden while a recording is in progress, MUST force-stop the recording and proceed exactly as if the user had clicked stop (finalizing and transcribing the captured audio).

If the document becomes hidden while the hook is `idle` or `transcribing`, this MUST be a no-op.

#### Scenario: Tab hidden during active recording

- GIVEN the hook is in the `recording` state
- WHEN the document's `visibilityState` becomes `hidden`
- THEN the hook stops the recording exactly as a manual stop would
- AND the audio captured up to that point is finalized and sent for transcription

#### Scenario: Tab hidden while idle

- GIVEN the hook is `idle` (not recording)
- WHEN the document's `visibilityState` becomes `hidden`
- THEN no recording-related state change occurs

### Requirement: Transcription Endpoint Contract

The system MUST expose `POST /api/transcribe` accepting a `FormData` payload containing the recorded audio file, and MUST respond with JSON `{ text: string }` containing the transcription.

The route MUST call the Groq transcription model (`whisper-large-v3-turbo`) server-side using `GROQ_API_KEY`; this call MUST NOT route through the AI Gateway.

#### Scenario: Successful transcription

- GIVEN a valid audio Blob is POSTed as FormData
- WHEN `/api/transcribe` processes the request
- THEN the response is `200` with JSON body `{ text: "<transcribed text>" }`

#### Scenario: Missing audio in request

- GIVEN a POST to `/api/transcribe` with no audio file present
- WHEN the route processes the request
- THEN it MUST respond with an error status and MUST NOT call the transcription model

### Requirement: Error Handling

The system MUST surface a distinct, user-visible error state for each of: microphone permission denied, transcription request failure, and empty/silent audio that yields no transcribable speech.

#### Scenario: Microphone permission denied

- GIVEN the browser denies microphone access when requested
- WHEN the user clicks to start recording
- THEN the UI displays a permission-denied error
- AND no recording or transcription request is attempted

#### Scenario: Transcription request fails

- GIVEN a recorded audio Blob is POSTed to `/api/transcribe`
- WHEN the Groq API call fails (network error or non-2xx response)
- THEN `/api/transcribe` MUST respond with an error status
- AND the client MUST display a transcription-failed error instead of an empty draft

#### Scenario: Empty or silent audio

- GIVEN the user toggles a brief recording with no speech captured
- WHEN the resulting audio is transcribed and yields empty or whitespace-only text
- THEN the UI MUST indicate that no speech was detected rather than presenting an empty editable draft as if it were valid

### Requirement: Record-to-Draft UX Flow

The capture flow MUST proceed: recording → transcribing indicator → editable draft text, with no intermediate live/partial transcript shown during recording or transcription.

#### Scenario: Transcribing indicator shown while awaiting result

- GIVEN the user has stopped (manually or via visibility auto-stop) and the audio was POSTed to `/api/transcribe`
- WHEN the response has not yet returned
- THEN the UI displays a transcribing indicator (not a live-growing transcript)

#### Scenario: Result becomes an editable draft

- GIVEN `/api/transcribe` returns `{ text }`
- WHEN the response is received
- THEN the UI replaces the transcribing indicator with the full text as an editable draft, ready for user confirmation or edit before submission to `/api/interpret`

### Requirement: Out of Scope Behaviors

The system MUST NOT implement live/interim partial transcripts during recording, MUST NOT implement voice-activity-detection (VAD) based auto-segmentation of turns, and MUST NOT retain a press-and-hold interaction mode alongside the click-toggle mode.

#### Scenario: No interim results during recording

- GIVEN the user is actively recording
- WHEN audio is being captured
- THEN no partial or growing transcript text is displayed before the recording stops and transcription completes
