# Voice Setup & Provider Reference

Open **Settings → Voices** to configure speech synthesis for Momotamu and Vivi. The voice setup modal allows you to choose local or cloud voice engines, assign voices to each companion, preview takes, and manage playback devices without leaving your conversation.

## Available voice routes

| Route | Engine | Requirements |
| --- | --- | --- |
| **VoiceGen / VoxCPM2** *(Featured Local)* | Local Python backend in WSL2 with ROCm acceleration | Ubuntu 22.04 in WSL2, ROCm Python virtualenv, and VoxCPM2 weights. Uses bundled companion reference audio. |
| **DIY Speech Server** | Custom HTTP server adhering to Duo's versioned streaming contract | Local or remote HTTP endpoint implementing `GET /v1/capabilities` and `POST /v1/speech`. |
| **ElevenLabs** | Hosted cloud TTS streaming 24 kHz PCM | Your own ElevenLabs account and API key. |
| **Cartesia** | Hosted cloud TTS streaming 24 kHz raw PCM | Your own Cartesia account and API key. |
| **Text Only** | No speech synthesis | No requirements. Companions reply via written transcript only. |

---

## 1. Local VoiceGen / VoxCPM2 setup

Duo includes the voice-server integration code in `runtime/voicegen-oui/`.

1. **Prerequisites:** Windows 10/11 x64, WSL2 with Ubuntu 22.04, an AMD GPU (e.g. RX 7900 XTX) with ROCm support, and downloaded VoxCPM2 weights.
2. **Virtualenv:** Set up your Python environment following the [VoiceGen Oui repository](https://github.com/cesarborgenkrans-gif/VoiceGen-Oui-ROCm-VoxCPM2).
3. **Starting the Engine:** In **Settings → Voices** (or **Settings → Local engines**), click **Start voice**, then select **Warm up**. Warm-up prepares the model in VRAM (this can take 30–60 seconds).
4. **Ports and Isolation:** The local backend runs on `127.0.0.1:3234` under service identity `duo-voice-harness-voice`. Audio synthesis is session-only by default—streaming PCM directly into memory without saving WAV files to disk.

---

## 2. Hosted providers (ElevenLabs & Cartesia)

Both ElevenLabs and Cartesia stream real-time 24 kHz mono PCM audio directly into Duo's audio worklet pipeline.

### Setup steps
1. In **Settings → Voices**, select **ElevenLabs** or **Cartesia**.
2. Paste your provider API key. Keys are encrypted via Windows DPAPI before being saved to `%APPDATA%\duo-voice-harness\credentials\`.
3. Check **Allow remote voice connections** if connecting to an external endpoint.
4. Click **Check connection & find voices**. Duo queries and displays available models and voices directly from the endpoint.
5. Choose a model ID, then select separate voices for **Momotamu** and **Vivi**.
6. Use **Preview** to verify the sound, then click **Save voices**.

### Provider specifications
* **ElevenLabs:**
  - Official API Origin: `https://api.elevenlabs.io`
  - Model discovery: `GET /v1/models` (filtering for TTS-capable models).
  - Streaming: `POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000`.
* **Cartesia:**
  - Official API Origin: `https://api.cartesia.ai`
  - Pinned API Version: `Cartesia-Version: 2026-08-14`.
  - Streaming: `POST /tts/bytes` requesting `container: "raw"`, `encoding: "pcm_s16le"`, `sample_rate: 24000`.

> [!NOTE]
> Synthesizing speech and playing previews through hosted providers consume your personal provider account credits.

---

## 3. DIY Speech Server contract

You can connect any custom speech engine (such as Piper, Coqui, Kokoro, or a custom PyTorch service) using Duo's versioned HTTP contract.

### Endpoints to implement

#### `GET /v1/capabilities`
Returns the server's identity, session retention policy, supported formats (`pcm_s16le` and/or `wav`), and available voice catalog.
```json
{
  "contractVersion": 1,
  "sessionOnly": true,
  "synthetic": true,
  "formats": ["pcm_s16le", "wav"],
  "voices": [
    { "id": "demo-momotamu", "label": "Momotamu test tone · 330 Hz" },
    { "id": "demo-vivi", "label": "Vivi test tone · 440 Hz" }
  ]
}
```

#### `POST /v1/speech`
Creates a speech generation request for the specified companion and text.
```json
{
  "contractVersion": 1,
  "requestId": "req-123456",
  "actor": "vivi",
  "voiceId": "demo-vivi",
  "text": "Hello! I am ready to converse.",
  "language": "English",
  "outputRetention": "session",
  "format": "pcm_s16le"
}
```
Returns HTTP 201 with delivery configuration:
```json
{
  "contractVersion": 1,
  "requestId": "req-123456",
  "format": "pcm_s16le",
  "delivery": "streaming",
  "sampleRate": 24000,
  "channels": 1
}
```

#### `GET /v1/speech/{requestId}/audio`
Fetches audio for the created job:
* **Streaming PCM (`pcm_s16le`):** HTTP 200 with `Content-Type: application/octet-stream` streaming raw 24 kHz 16-bit little-endian mono PCM. Requires response headers:
  - `X-Duo-Speech-Version: 1`
  - `X-Audio-Format: pcm_s16le`
  - `X-Sample-Rate: 24000`
  - `X-Audio-Channels: 1`
* **Buffered WAV (`wav`):** HTTP 200 with `Content-Type: audio/wav` containing a standard RIFF/WAVE header and 24 kHz PCM data.

#### `POST /v1/speech/{requestId}/cancel`
Cancels an in-flight speech job when playback is stopped early.

#### `GET /v1/speech/{requestId}`
Reports the current job status (`open`, `generating`, `completed`, `cancelled`, or `failed`) and sample count.

### Runnable reference server
Duo includes a reference test tone server implementing this full contract ([examples/diy-speech-server.cjs](../examples/diy-speech-server.cjs)):
```powershell
npm run diy:server
# or directly:
node examples/diy-speech-server.cjs
```
This runs a contract-compliant server on `http://127.0.0.1:3235` that generates distinct synthetic audio tones for each companion without requiring a GPU or cloud account.

---

## 4. Architecture for developers

Duo uses a unified provider adapter architecture located in `src/voice/`:
* `src/voice/provider-service.js`: Common abstraction handling route validation, device selection, volume metering, session-only buffering, Stop, Replay, and Save audio.
* `src/voice/providers/voxcpm2.js`: Adapter for the local WSL2 ROCm backend.
* `src/voice/providers/diy.js`: Adapter for the DIY HTTP contract.
* `src/voice/providers/elevenlabs.js`: Adapter for the ElevenLabs streaming API.
* `src/voice/providers/cartesia.js`: Adapter for the Cartesia streaming API.

To add a new provider, implement a client conforming to the provider interface in `src/voice/providers/` and register it in `provider-service.js`.

---

## Language & pronunciation

Open **Persona → Voice → Choose language…** to select from **39 language and dialect choices**. 

Language selection guides pronunciation during synthesis. Write or request responses in the language you wish to hear. Provider support depends on the chosen model: ElevenLabs checks the model's reported language catalog, Cartesia and DIY validate support at the endpoint, and local VoxCPM2 supports multilingual zero-shot cloning.
