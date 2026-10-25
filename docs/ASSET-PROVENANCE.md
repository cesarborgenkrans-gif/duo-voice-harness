# Artwork, voices and reuse

This guide explains where the bundled media comes from, which reuse terms apply, and how to check the inventory. Code, artwork, reference recordings and downloaded model weights have separate license boundaries.

Audit date: **2026-10-24**. The current repository contains **33 media files**. [ASSET-INVENTORY.json](ASSET-INVENTORY.json) lists every path, size, SHA-256 hash, and category, with measured PNG dimensions and WAV audio parameters. Asset hashes in the inventory establish bit-for-bit file integrity.

**Creator confirmation:** The creator confirms that the bundled character artwork, stage textures, branding graphics and reference recordings were created or generated for SparkleSnap. Outfit visual designs were created in VRoid Studio based on legally purchased designs from BOOTH (detailed below). The inventory records this confirmation for the 31 media files covered by it. Stage textures share the character artwork’s credited, noncommercial terms; the two SVG cursor vectors are application-code assets under MIT.

## Applicable terms

| Material | Current terms | Practical guidance |
| --- | --- | --- |
| Original application code, motion/animation logic, docs and two SVG cursors | [MIT](../LICENSE), subject to component exceptions in [NOTICE](../NOTICE) | Preserve upstream attribution when adapting code. |
| Adapted VoiceGen backend and PCM AudioWorklet | [Apache-2.0](../runtime/voicegen-oui/LICENSE), [retained notice](../runtime/voicegen-oui/NOTICE), [origin record](../runtime/voicegen-oui/ORIGIN.md) | Duo integrates the open-source VoxCPM backend under Apache-2.0. |
| 17 Momotamu sheets and 5 Vivi sheets | [Character Guidelines](../CHARACTER-GUIDELINES.md) | SparkleSnap noncommercial reuse with attribution. |
| 2 Momotamu presence textures | [Character Guidelines](../CHARACTER-GUIDELINES.md) | SparkleSnap stage props under character art terms. |
| 5 brand/identity images (icons, preview banner, Settings logo) | [Character Guidelines](../CHARACTER-GUIDELINES.md#the-sparklesnap-brand) | SparkleSnap brand assets with attribution terms. |
| 2 reference WAVs | [Character Guidelines](../CHARACTER-GUIDELINES.md) | Reference voice samples with generation logs below. |
| Downloaded model weights and inference runtimes | Respective upstream licenses | Downloaded separately; preserve upstream notices. |

Application code is licensed under MIT, while character art and reference audio follow the terms in [Character Guidelines](../CHARACTER-GUIDELINES.md). Contributors can freely develop and extend the application code; keep artwork attribution intact when adapting.

## Reference voice audio

The runtime selects reference audio for each companion from [profiles.json](../assets/voice/profiles.json). Original generation records are preserved verbatim alongside the audio:

| Companion | Original record | Measured WAV | Manifest summary |
| --- | --- | --- | --- |
| Momotamu | [momotamu-voice-text-jp.md](../assets/voice/momotamu/momotamu-voice-text-jp.md) | 48 kHz, mono, 16-bit PCM; 8.96 seconds | Voice-design mode, Japanese script, stored language setting `English`, seed `42425` |
| Vivi | [vivi-voice-text-jp.md](../assets/voice/vivi/vivi-voice-text-jp.md) | 48 kHz, mono, 16-bit PCM; 8.8 seconds | Voice-design mode, Japanese script, stored language setting `English`, seed `32521` |

Measured duration and sample rates match the original generation records. The runtime applies `recordingLanguage: jp` to select Japanese pronunciation for character scripts.

Hosted ElevenLabs and Cartesia adapters stream speech through your personal account voices. Synthesized streams connect directly to standard provider endpoints.

## Visual assets

- **Character sheets:** 22 PNGs are bundled as active animation art. [Vivi registration](../characters/vivi/registration.json) records current hashes and measured anchors to ensure precise alignment. Front-facing sprite sheets intentionally serve multiple animation states.
- **Presence textures:** Two WebP files in `characters/momotamu-presence/assets/gen/` render the stage's frosted disc and kiln light under character art reuse terms.
- **Brand assets:** Launcher logotype, icons, and Settings imagery represent official SparkleSnap/Duo branding under the attribution guide.
- **Cursor source:** Two SVG vectors (64×64 and 96×96) provide high-visibility pointers as MIT-licensed source assets.

### Character design and outfit inspirations

The companions' visual designs and 2.5D sprite sheets were modeled using VRoid Studio, drawing artistic inspiration from outfits purchased by the creator on BOOTH for non-commercial project use:

* **Momotamu (Tammy):** Her dress and aesthetic were modeled after the VRoid outfit [【色差分＋オマケ付き】刺繍とフリルのワンピースセット【XWear対応】](https://nadeflat.booth.pm/items/6096249) by **nadeflat** on BOOTH.
* **Vivi (Vivian):** Her off-the-shoulder top and pants were modeled after [【VRoid Dress Set】オフショルダーパンツ6色 Off-the-shoulder pants in 6 colors](https://udukitatumi.booth.pm/items/8392791) by **卯デザインラボ (Uduki Tatsumi)** on BOOTH.

Duo Voice Harness and its companion artwork are shared as a free, non-commercial developer preview with zero monetization, respecting the artistic craftsmanship of the original BOOTH designers.

## External runtimes & models

| Component | Source and license | Distribution |
| --- | --- | --- |
| VoxCPM code | [OpenBMB license](https://github.com/OpenBMB/VoxCPM/blob/main/LICENSE): Apache-2.0 | Installed via Python dependencies |
| VoxCPM2 weights | [OpenBMB model card](https://huggingface.co/openbmb/VoxCPM2): Apache-2.0 | Downloaded separately |
| Featured Gemma 4 12B QAT GGUF | [Google model card](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf), [Gemma 4 license](https://ai.google.dev/gemma/apache_2): Apache-2.0 | Downloaded separately |
| llama.cpp | [Upstream license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE): MIT | Downloaded separately via setup script |

## Git repository management

The first public release starts from a clean initial commit, with earlier development history preserved privately on the creator’s machine.

## Inventory verification

Run `npm run audit:assets` to verify media file integrity against the asset inventory. Use `npm run audit:assets -- --write` after adding verified assets to refresh the manifest.
