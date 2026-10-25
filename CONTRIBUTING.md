# Build Duo with us

Thanks for taking an interest in Duo Voice Harness. This is a developer preview built through learning, iteration and agent-assisted development. Small, well-explained improvements are welcome: a clearer setup step, a reproducible bug report, an accessibility fix or an example showing where document relevance fails can all help.

For a substantial change, open an issue with the user problem and proposed approach before investing in a large implementation. [The Making of Duo](docs/THE-MAKING-OF-DUO.md) explains the background and architectural direction.

## Run the source

Use Windows and Node.js 22.12 or newer. From the repository folder:

```powershell
npm ci
npm run doctor
npm start
```

The interface can open before models are installed. Conversation still needs a configured language model. Voice output and native microphone understanding have their own requirements; follow the [README setup](README.md#set-up-your-engines). A hosted voice account is optional.

## Pick a useful check

Start with `npm run check:source` for repository checks and `npm test` for unit and regression tests. Neither command needs a running model or paid API credentials.

| Change | Relevant verification |
| --- | --- |
| Layout, character stage or small-screen controls | `npm run test:interface`, plus human visual review at the relevant window size |
| Saved conversation, IPC, playback or replay/export | `npm run test:desktop` and relevant unit tests |
| Voice adapter or its setup UI | Its unit suite and `test:diy`, `test:elevenlabs` or `test:cartesia`; use `test:voice-settings` for visible setup changes |
| Credentials or connection policy | `npm run test:credentials` and relevant credential unit tests |
| Document import, relevance or refusal handling | `npm run test:grounding` and the document unit tests |
| Discussion pacing, partner context or solo/duet behavior | `npm run test:discussion` and relevant unit tests |
| Media files | `npm run audit:assets`; review provenance before refreshing the manifest |

`npm run check` runs the unit suite and all nine Electron checks (`test:desktop`, `test:interface`, `test:credentials`, `test:diy`, `test:elevenlabs`, `test:cartesia`, `test:voice-settings`, `test:grounding`, `test:discussion`). These integration checks use synthetic model/provider responses and muted audio. They exercise actual UI, IPC, and player behavior deterministically using synthetic loopback fixtures.

`npm run test:live` starts real engines and plays a duet. Run it when you have compatible hardware and the local models configured. Live hosted-provider checks require your own account and may cost money. Keep fixture results, real-model results and human observations separate in your report. For the backend retention code, the [Verification Guide](docs/VERIFICATION.md) lists its Python regression command (`python -m unittest discover -s runtime/voicegen-oui/backend -p test_speech_sessions.py`). The [verification suite](docs/VERIFICATION.md) records the full test matrix and human checklist; hosted CI is configured separately from local results.

## Keep examples shareable

Use synthetic or redacted prompts, documents and recordings. Keep API keys, private conversations, downloaded weights, generated audio and local test profiles out of a pull request. The supported scratch area `artifacts/` is ignored. Check screenshots and logs before attaching them; a saved chat or a provider error can contain personal context.

Run storage and deletion tests inside isolated, test-owned temporary folders. Keep existing user data, other applications, archives and saved exports untouched. The [Data and Storage Guide](docs/DATA-AND-STORAGE.md) describes the storage contract; code that changes it should update that explanation.

## Add a voice route

Start with the [voice provider and adapter guide](docs/VOICE-SETUP.md). The included DIY example server (`npm run diy:server`, running [examples/diy-speech-server.cjs](examples/diy-speech-server.cjs)) produces synthetic tones, making it useful for testing custom speech contracts without installing a speech model.

Keep provider-specific HTTP, audio formats, authentication and error handling inside its adapter. Explicitly declare supported audio formats, languages and streaming capabilities. Preserve cancellation, bounded buffering and cleanup, and reject unsupported options clearly. Replaying a completed take should use its cached audio. Requests that can consume provider credits should not retry automatically or switch to another provider after failure.

Add deterministic success/error/cancellation fixtures first. Demonstrate that the new route works with the bundled WSL speech backend unavailable. Document setup, outgoing data, credentials, limits and which real-engine checks remain untested. For a hosted adapter, keep credentials in the main-process connection boundary and use mocked HTTP for ordinary tests.

## Send a focused pull request

Explain the user-visible problem, resulting behavior and the checks you actually ran. Include a small synthetic reproduction or relevant before/after screenshot when it helps. State unresolved limits and untested configurations. AI-assisted contributions are welcome; review the result and verify its claims before submitting it.

Preserve attribution and the existing [license boundaries](NOTICE). Original application code uses MIT; the identified backend/worklet components retain Apache-2.0. Media has separate [character and brand terms](CHARACTER-GUIDELINES.md). For new artwork or audio, include its creator/source, tool or commission details, reference/input rights and proposed reuse terms; document the creation tool and reuse terms, and update the [asset guide](docs/ASSET-PROVENANCE.md) after review. Code-only contributions are welcome.
