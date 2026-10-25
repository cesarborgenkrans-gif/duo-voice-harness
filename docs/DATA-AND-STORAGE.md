# Data and Storage on Your Machine

Duo Voice Harness is designed as a local-first desktop application. A fresh clone contains only application source code, configuration and selected reference assets. Your personal conversations, audio takes, settings, and model runtimes are created on your machine and stored in standard Windows user directories.

Duo keeps conversation histories, settings and diagnostic logs in local storage, with zero built-in analytics or telemetry. You choose the model and voice endpoints. When you connect a remote provider, requests send the inputs needed for the selected feature: these can include conversation context, attached text or media for a model, and reply text for speech synthesis. The provider’s policies govern its handling and retention of those inputs. Installation and runtime setup download dependencies and selected engine components; Windows folder sync follows your own system settings.

## Where conversations are saved

When you start a conversation, Duo creates a unique UUID directory and saves its `session.json` state. Solo chats and two-character discussions use separate subfolders:

```text
<Windows Documents>/duo-voice-harness/
├── chats/<session-uuid>/session.json          # Solo conversation history
└── discussions/<session-uuid>/session.json    # Duo conversation history
```

### What `session.json` contains

- The conversation message history, participants, and ISO timestamps.
- Any attached reference document, short name, and its active grounding policy (`document-only` or `general`).
- Associated metadata and session settings.

### Optional transcript exports

- Solo chats can export a human-readable `chat.md` beside `session.json`.
- Duo discussions can export an `ai-discussion.md` transcript beside `session.json`.
- When Backstage notebooks are enabled for a conversation, their Markdown files are saved in that same session directory.
- Exporting transcript files saves them directly to your local drive for personal reading or backup.

> [!NOTE]
> Windows Documents directories can be redirected by Windows or synced with cloud services like OneDrive. If your Documents folder is redirected to cloud storage, conversations saved there will participate in your personal cloud sync rules.

## Storage and runtime file layout

| Files or data | Default location | When created |
| --- | --- | --- |
| Settings, drafts, last-open-session pointers, provider settings with credential references, browser storage and caches | `%APPDATA%\duo-voice-harness` and its Electron profile subfolders | While using the interface |
| OS-protected credential records; voice connection metadata and local-only policy | AppData `credentials/` and `voice-connections.json` | Saving a protected key or configuring a connection; session-only keys stay in memory |
| `free-form-window.json` and diagnostic JSON files | AppData root and `diagnostics/` | Window placement and diagnostics |
| Startup/error logs and `voice-decisions.jsonl` | AppData `logs/` | Launching and troubleshooting |
| Shared context `context.md` and `context.previous.md` | AppData `worktrees/<name>/` | Creating or editing a shared context |
| `backend.log` | AppData `voicegen/` | Starting the voice backend |
| Legacy or explicitly archived speech WAVs, text-bearing JSON manifests, and `metadata.json` | AppData `voicegen/outputs/` | Archived generation outputs from legacy workflows; current playback operates entirely in memory |
| Model/kernel caches | AppData `voicegen/cache/` | Loading and running the voice engine |
| Unsaved imported media | AppData `image-drafts/<window-id>/` | When inherited import APIs are used |
| Chat/Speech exported with **Save audio**; explicitly exported transcript copies | The path selected in the save dialog | Exporting a file |
| Temporary reference/continuation WAVs | The WSL environment's OS temporary directory | During synthesis; normal cleanup removes them, but abrupt termination can leave temporary files |
| Installed Node packages | Checkout `node_modules/` | `npm ci` or launcher dependency setup |
| Downloaded llama.cpp runtime, installer staging/archive and provenance | Checkout `runtime/llama.cpp/` | `npm run setup:llama` |
| Optional manually supplied GGUF files | AppData `models/gemma-4-12b/`, LM Studio folder, or custom path | Model setup; existing weights are read in place |
| Reports, screenshots and isolated test profiles | Checkout `artifacts/` | Desktop/live smoke scripts |

## Audio lifecycle & session-only streaming

**Generated replay audio is session-only by default.** Chat replies and Speech takes stream through Electron audio worklets and remain in memory unless you choose **Save audio**. This describes playback storage: local synthesis can also create temporary reference or continuation WAVs in the WSL environment. Normal cleanup removes them, but an abrupt shutdown can leave temporary files. Saved conversation text and diagnostic logs have separate lifecycles, described above.

- **In-Memory Cache:** The chat window keeps up to **24 reply takes or 64 MiB** in memory, releasing the oldest takes first.
- **Replay:** Clicking **Replay** on a spoken chat reply plays the original in-memory take immediately without generating new speech or spending provider tokens.
- **Switching Chats:** Cached replay audio survives switching between saved chats in the same active window. Reloading or closing the window releases the in-memory cache.
- **Save Audio:** Clicking **Save audio** prompts you for a destination path and writes the WAV file only where you specify. Chat audio export filenames automatically include the session ID and reply ID.
- **Speech Activity:** In **Activities → Speech**, the latest generated take maintains its own in-memory take. Editing the prompt or generating a new take clears the previous copy.
- **Microphone Buffers:** Real-time microphone audio recordings are buffered in memory with a default ten-minute expiration and a maximum of four clips per speaker. Saved sessions retain transcript text and timestamp metadata, keeping spoken audio private to the active session.
- **Clear Audio:** Open **Settings → Resources → Your data on this device** to access shortcuts for **Open chats folder**, **Open app data**, and **Clear chat replay audio**. Clearing replay audio frees chat RAM while preserving text histories, exports, and the current Speech take.

## Environment variable overrides

You can redirect storage locations by setting standard environment variables prior to launching the application:

| Variable | Description |
| --- | --- |
| `DUO_VOICE_DATA_ROOT` | Overrides the Electron AppData and profile root |
| `DUO_VOICE_SESSION_ROOT` | Overrides the conversation root (defaults to `<Documents>/duo-voice-harness`) |
| `DUO_VOICE_MODEL_PATH` | Windows path to the local VoxCPM2 model directory |
| `DUO_VOICE_WSL_DISTRO` | WSL distribution name for the voice runtime |
| `DUO_VOICE_WSL_USER` | Linux user inside WSL (defaults to `root`) |
| `DUO_VOICE_WSL_VENV` | Linux filesystem path to the Python virtual environment |
| `DUO_VOICE_LLAMA_BINARY` | Windows path to a custom `llama-server.exe` |

If you set storage overrides inside the project checkout, use the pre-ignored `.local-data/` or `sessions/` directories to prevent personal chats from appearing in Git status.

## Credentials, privacy & request security

API keys for hosted voice providers (ElevenLabs, Cartesia) or OpenAI-compatible endpoints are managed with strong local isolation:

### OS-backed DPAPI encryption
- Protected credentials live in `%APPDATA%\duo-voice-harness\credentials\credential-<uuid>.json`.
- Electron's `safeStorage` API encrypts keys using Windows DPAPI. Encryption is bound to the local Windows user profile.
- Ordinary application settings store only an opaque `credentialRef`. Main-process isolation keeps raw keys securely sequestered away from the renderer.

### Session-only keys
- When saving an API key, you can check **Keep a new key only until the app closes**.
- Session-only keys are held strictly in main-process RAM and expire immediately when the application process exits.

### Origin binding & request boundaries
- Every saved credential is cryptographically bound to its authorized provider and origin URL (e.g. `https://api.elevenlabs.io` or `https://api.cartesia.ai`). Saved keys remain strictly bound to their original endpoint domain.
- **Local-only by default:** Voice connections default to local-only mode (`localOnly: true`). Outbound remote requests are blocked until you explicitly check **Allow remote voice connections**.
- **Redirect rejection:** Outbound requests bearing authentication headers reject HTTP redirects to prevent token leakage to untrusted endpoints.
- Remote endpoints must use HTTPS (HTTP is allowed only for loopback addresses: `localhost`, `127.0.0.1`, `[::1]`).

## Git & repository boundaries

The repository is configured to prevent accidental commits of personal data or large binaries:

- `.gitignore` explicitly excludes `.local-data/`, `sessions/`, `chats/`, `discussions/`, `credentials/`, `logs/`, `artifacts/`, `runtime/llama.cpp/`, `runtime/models/`, and `runtime/voicegen-oui/cache/`.
- `npm run check:source` checks tracked files and nonignored candidate files for credential patterns, workspace-path disclosures, ignore rules, and JavaScript syntax integrity. The GitHub Actions workflow runs this check automatically alongside unit and integration tests.
- Reference assets and character artwork are tracked under `assets/` and documented in the [Asset Provenance Audit](ASSET-PROVENANCE.md).
