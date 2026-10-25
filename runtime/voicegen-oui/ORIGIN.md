# Voice backend provenance

Maintain this local backend independently. Run the speech-session regression suite after changing synthesis, cancellation, or artifact handling.

Copied on 2026-10-01 from the Live-Conversation-AI-VTuber project’s `voicegen/backend/`: server, speech sessions, VoxCPM engine, GPU cleanup, telemetry, and speech-session tests. The PCM worklet in the app root came from that app's `ui/audio-worklet.js`.

That implementation derives from VoiceGen Oui! ROCm-VoxCPM2 in the `VoiceGen-Oui-ROCm-VoxCPM2` project. Its Apache-2.0 license and notice are retained here. Model weights and third-party dependencies retain their upstream licenses. Character/reference media retain their existing ownership.

Local changes: independent service identity, environment variables, output names, generic clone modes, no bundled default character reference, request bounds, and explicit profile provenance. Warudo, VRM, motion bridges, and the original conversation server are excluded.

## Distribution scope in Duo

The PCM worklet now lives at `src/voice/voice-pcm-worklet.js` relative to the Duo repository root. It retains Apache-2.0 with this adapted backend; the root MIT application license does not replace it. The source files carry an adaptation/modification notice.

The retained upstream NOTICE refers to `docs/ASSET_LICENSE.md` in the upstream VoiceGen project. That upstream-relative reference is preserved as provenance, not a claim that the file exists in this standalone copy. Duo's media evidence and current publication status are in [ASSET-PROVENANCE.md](../../docs/ASSET-PROVENANCE.md), and its character terms are in [CHARACTER-GUIDELINES.md](../../CHARACTER-GUIDELINES.md). Do not infer rights in bundled media from the Apache code license.

Duo-specific changes also include session-only generated audio retention, owned-runtime checks and bounded speech lifecycle handling. These changes adapt the integration; underlying VoxCPM/VoxCPM2 code, weights and other dependencies retain their own upstream attribution and terms.

Original workstation paths are retained in the private audit checkpoint. Public provenance identifies the source projects and subpaths without publishing that workstation layout.
