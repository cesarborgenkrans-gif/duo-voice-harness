# The Making of Duo Voice Harness

**Five months of self-directed learning, pair-programming with AI coding agents, and building a local two-character stage.**

---

Many AI interfaces begin with a text box and a single voice. I wanted to explore what a shared character stage could add to that experience.

I wanted something different. I wanted an interface that felt alive, welcoming, and fun to have running on a desk all day. A stage where two distinct characters—**Momotamu** and **Vivi**—stand together, react to what you say, and can even debate topics with each other. 

Getting here took **five months of intense, self-directed learning**. I am not a traditional software engineer; I taught myself how to direct AI coding agents, turn creative ideas into real desktop software, integrate local models, and debug complex streaming audio systems from the ground up.

This is the story of how Duo Voice Harness was made, what I learned pair-programming with AI, and the architectural choices that brought it to life.

---

## 1. Why two companions?

For me, a plain chat window can feel like a stark room. I wanted the interface to offer a stronger sense of presence and make turn-taking visible.

In Duo, the companions have contrasting conversational roles:
- **Momotamu** (affectionately called **Tammy** or *Momo*) brings warmth, expansive possibilities, and gentle encouragement.
- **Vivi** (also answering to **Vivian** or *Viv*) brings sharp questions, concrete realities, and dry wit.

When you ask a question or drop a prompt template like *Academic Duel*, *Roast*, or *Phrase Lab*, you aren’t just getting an answer—you are starting a conversation between two distinct personalities. You can sit back and watch them trade thoughts for 2 to 12 turns, speak into your mic to join in, or address one of them directly (*“Hey Vivian, what do you think?”* or *“Tammy, explain this”*). 

Non-verbal feedback helps make the conversation visible: with both companions active, they face each other; on her own, a companion faces you. The Listener setting separately chooses who the discussion addresses. Active poses and subtle mouth cues indicate who holds the conversational floor.

---

## 2. Local-first AI: Running on real desktop hardware

I wanted Duo to work entirely on local hardware by default:
- **Language Intelligence:** Powered by local Google Gemma via a pinned Vulkan build of `llama.cpp`. It runs on consumer GPUs without expensive cloud API subscriptions.
- **Local Speech Synthesis:** Powered by VoxCPM2 running in WSL2 with ROCm acceleration. Spoken audio streams chunk-by-chunk through Electron audio worklets into your speakers.
- **Audio retention:** Generated replay audio stays in memory by default (up to 64 MiB / 24 chat takes), and **Save audio** exports a take when requested. Local synthesis can create temporary reference or continuation WAVs; conversation text is saved separately. See [Data and Storage](DATA-AND-STORAGE.md) for cleanup and storage details.

Because not everyone has an AMD GPU or Linux environment ready, we also built a clean adapter system. You can switch to **Text only**, connect a **DIY speech server**, or plug in hosted accounts like **ElevenLabs** or **Cartesia** with Windows DPAPI credential encryption.

---

## 3. What I learned pair-programming with AI coding agents

Duo was built from day one by treating AI coding agents as active pair programmers. That process taught me valuable lessons about where agents shine—and where human vision is non-negotiable:

### Agents need strong artistic and product direction
I learned to give agents specific product goals, visual references and feedback from the interface itself. The side-screen 96×96 cursor, warm color palette, Cyberpunk wireframe holodeck, prompt recipes and character animations took repeated decisions and revisions. My role was to set the direction, inspect what was built and keep the experience coherent.

### Break big problems into bounded tasks
The key to making steady progress was guiding agents through tightly bounded, verifiable steps: plant Vivi’s boots on a fixed anchor, implement a backpressured PCM worklet, build a document relevance filter, write a headless Electron test suite.

### Verification is freedom
I learned to make each change inspectable and testable. The project has a unit and regression suite plus nine headless Electron integration suites using synthetic model and voice servers. `npm test` and `npm run check` help catch regressions before the next change. Real-model behavior, voice quality and visual comfort still need separate human checks; [Verification](VERIFICATION.md) explains the distinction.

---

## 4. Document grounding and its limits

One of the most rewarding experiments in Duo is the **Document Grounding** system. When you attach a reference document (like a study guide or meeting notes), Duo's main process runs an in-process CPU scoring algorithm across passage chunks before a companion speaks.

In **Use only this text**, factual questions that fail the relevance check receive a controlled persona refusal. Summary and translation requests use a separate overview path over the supplied text. Source-focused prompts ask the model to cite line labels and decline unsupported questions; if it begins with `[ABSTAIN]`, the response stream is cancelled and replaced with a persona refusal.

These checks are designed to keep responses grounded in your reference text. They measure passage relevance and act on the model's refusal signal, providing an automated layer of oversight alongside direct human inspection. The [Document Grounding Guide](DOCUMENTS.md) explains the two modes and their practical boundaries.

---

## 5. Looking forward

Duo Voice Harness is a developer preview. It represents five months of turning curiosity into working software, learning to speak the language of code and models, and building an experience that feels personal, charming, and fun.

If you are exploring local AI, building character interfaces, or learning how to collaborate with AI coding agents yourself, I hope Duo gives you a welcoming place to start.
