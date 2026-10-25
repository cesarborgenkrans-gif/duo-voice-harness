# Verification and Testing Suite

Duo Voice Harness uses a multi-tiered verification suite combining static repository checks, pure unit tests, headless Electron UI and IPC integration suites with synthetic loopbacks, Python backend tests, and human-in-the-loop validation checklists.

The unit and Electron fixture suites run locally without external API credentials or running model servers. Electron audio is muted and voice responses use synthetic tones. The separate opt-in `test:live` command starts real engines and plays audio.

## The main gate: `npm run check`

To run the full automated verification gate before committing code, execute:

```powershell
npm run check
```

This runs the unit test suite (`npm test`) followed by nine Electron integration suites covering desktop UI, interface layout, credential encryption, DIY voice loopbacks, hosted voice adapters, voice configuration settings, document grounding and discussion flow. Source hygiene and Python backend tests are separate commands; the GitHub Actions workflow runs those alongside `npm run check`.

## Test matrix

| Command | What it exercises | Requirements |
| --- | --- | --- |
| `npm run check:source` | Selected-file hygiene, JavaScript syntax, asset identity, local Markdown link integrity, ignore rules, and credential patterns | Node.js, Git |
| `npm test` | Pure JavaScript unit and regression tests: passage scoring, retry/overview paths, routing prefixes, direct address parser | Node.js |
| `npm run test:desktop` | Real Electron UI, IPC communication, and audio worklets with controlled local model/audio fixtures | Electron (local) |
| `npm run test:interface` | Rendered side-view layout, control tray scrolling, 96×96 cursor, Vivi anchors and facing cues, and reduced motion | Electron (local) |
| `npm run test:credentials` | Real Electron key migration, OS DPAPI encryption, session-only recovery, origin/redirect boundaries, and replacement/removal | Electron (local) |
| `npm run test:diy` | Real Electron chat/Speech, two DIY voices, Replay, Stop, and buffered WAV with synthetic loopback servers | Electron (local) |
| `npm run test:elevenlabs` | Real Electron chat/Speech with simulated ElevenLabs responses, protected credentials, local-only policy, Replay, and Stop | Electron (local) |
| `npm run test:cartesia` | Real Electron chat/Speech with simulated Cartesia responses, versioned requests, protected credentials, Replay, and Stop | Electron (local) |
| `npm run test:voice-settings` | Visible provider setup, protected keys, discovery, preview/Stop, text-only mode, saved voices, and short/portrait layouts | Electron (local) |
| `npm run test:grounding` | Saved text attachment, both companions, strict/general check failures, early abstention, spoken refusals, Stop, and bounded editor layout | Electron (local) |
| `npm run test:discussion` | Bounded duet exchanges, partner context, follow-up turns, explicit depth requests, solo recipe behavior and legacy speech-setting migration using a synthetic model | Electron (local) |
| `npm run check` | Runs `npm test` followed by all nine Electron test suites above | Electron (local) |
| `python -m unittest discover -s runtime/voicegen-oui/backend -p test_speech_sessions.py` | Backend speech session lifecycle and retention with synthetic audio fixtures; requires NumPy, no model or GPU needed | Python 3.10+, NumPy |
| `npm run test:live` | Opt-in hardware run that starts real local engines (llama.cpp and VoxCPM2) and plays a live spoken duet | Local Vulkan GPU, ROCm/WSL2 |

## Synthetic fixtures vs real hardware

Automated test suites use synthetic fixtures and loopback HTTP/IPC servers to verify protocols, state transitions, and error handling deterministically:

- **Language Model Fixtures:** Return canned, bounded streaming tokens or controlled `[ABSTAIN]` signals to verify client parsing and cancellation without running a heavy neural model.
- **Voice Fixtures:** Generate synthetic sine wave tones or mocked PCM chunks to verify the audio worklet pipeline, stream buffering, Replay cache, and Stop controls without spending API credits or spinning up GPU backends.
- **Muted Audio:** Automated Electron runs mute audio output to prevent blaring tones during development.

These fixtures verify application behavior, IPC protocols and state transitions using controlled synthetic responses. Complement the automated suites with real-engine runs to assess answer quality and end-to-end latency, and the human verification pass below to evaluate conversational flow, natural voice timbre and room acoustics.

## The human verification pass

Before tagged releases or significant visual/audio changes, conduct this manual evaluation:

- **Conversation Flow:**
  - Verify a complete spoken duet where Momotamu and Vivi take natural alternating turns.
  - Test direct address (e.g. “Vivi, what do you think?”) to verify initial turn selection.
  - Test native microphone transcription and push-to-talk.
- **Document Grounding:**
  - Test supported and unsupported questions against an attached text document.
  - Test summaries, translations, and misleading near-matches to observe persona refusals.
- **Audio & Interruption:**
  - Run room and speaker calibration in Audio Settings.
  - Test short spoken acknowledgments and sustained hands-free interruptions while audio is playing.
  - Listen with both headphones and desktop speakers.
  - Verify speech pronunciation in the languages you intend to use, with each selected provider and model, as synthesis capability and accent quality vary by provider.
- **Device Management:**
  - Switch playback devices and microphones during an active session.
  - Test microphone disconnect/reconnect and system sleep/resume.
- **Desktop Lifecycle:**
  - Launch via `Start-Duo-Voice.cmd`.
  - Verify restart, session save, session reopen from the header dropdown, and WAV export with Save audio.
  - Verify that closing the app cleanly stops any background engines it launched.
- **Visuals & Accessibility:**
  - Verify companion facing cues (facing each other in a duet, facing user when solo).
  - Toggle Cyberpunk mode on/off and observe conduit telemetry.
  - Test Side view layout on smaller displays and verify that controls scroll cleanly.
  - Verify that reduced motion stops animated visual accents.

## Acceptance documentation

For detailed architecture notes, grounding rules, and testing procedures, refer to:

- [Document Grounding Guide](DOCUMENTS.md)
- [Voice Setup & Provider Reference](VOICE-SETUP.md)
- [The Making of Duo](THE-MAKING-OF-DUO.md)
- [Contributing Guide](../CONTRIBUTING.md)
