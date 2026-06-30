# Voice Capture Specification

## Purpose

Push-to-talk audio capture via `MediaRecorder`, transcribed server-side through Groq Whisper at `/api/transcribe`, producing editable draft text. Explicitly request/response based — no live partial transcripts or automatic voice-activity segmentation.

## Requirements

### Requirement: Push-to-Talk Recording Lifecycle

The `useAudioCapture` hook MUST start `MediaRecorder` recording when the user begins a press-and-hold gesture (or presses a start button) and MUST stop recording when the gesture ends (or the stop button is pressed).

The hook MUST NOT auto-segment or auto-stop recording based on silence/voice-activity detection.

#### Scenario: Press and hold starts and stops recording

- GIVEN the user has granted microphone permission
- WHEN the user presses and holds the capture control
- THEN `MediaRecorder` transitions to a recording state
- AND WHEN the user releases the control
- THEN `MediaRecorder` stops and the recorded audio Blob is finalized

#### Scenario: No auto-stop on silence

- GIVEN the user is holding the capture control with several seconds of silence in the middle
- WHEN no voice activity is detected during that silence
- THEN recording continues uninterrupted until the user releases the control

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
- WHEN the user attempts to start recording
- THEN the UI displays a permission-denied error
- AND no recording or transcription request is attempted

#### Scenario: Transcription request fails

- GIVEN a recorded audio Blob is POSTed to `/api/transcribe`
- WHEN the Groq API call fails (network error or non-2xx response)
- THEN `/api/transcribe` MUST respond with an error status
- AND the client MUST display a transcription-failed error instead of an empty draft

#### Scenario: Empty or silent audio

- GIVEN the user holds the capture control briefly with no speech captured
- WHEN the resulting audio is transcribed and yields empty or whitespace-only text
- THEN the UI MUST indicate that no speech was detected rather than presenting an empty editable draft as if it were valid

### Requirement: Record-to-Draft UX Flow

The capture flow MUST proceed: recording → transcribing indicator → editable draft text, with no intermediate live/partial transcript shown during recording or transcription.

#### Scenario: Transcribing indicator shown while awaiting result

- GIVEN the user has released the capture control and the audio was POSTed to `/api/transcribe`
- WHEN the response has not yet returned
- THEN the UI displays a transcribing indicator (not a live-growing transcript)

#### Scenario: Result becomes an editable draft

- GIVEN `/api/transcribe` returns `{ text }`
- WHEN the response is received
- THEN the UI replaces the transcribing indicator with the full text as an editable draft, ready for user confirmation or edit before submission to `/api/interpret`

### Requirement: Out of Scope Behaviors

The system MUST NOT implement live/interim partial transcripts during recording, and MUST NOT implement voice-activity-detection (VAD) based auto-segmentation of turns.

#### Scenario: No interim results during recording

- GIVEN the user is actively recording
- WHEN audio is being captured
- THEN no partial or growing transcript text is displayed before the recording stops and transcription completes
