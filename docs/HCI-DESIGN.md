# Human–Computer Interaction (HCI) and Character Design Rationale

Momotamu and Vivi are part of Duo Voice Harness’s human–computer interaction (HCI) design. The shared character stage is designed to make interacting with local AI models more welcoming and turn-taking easier to follow.

```
       ┌───────────────────────────────┐
       │   Momotamu        Vivi        │  <- Shared Stage: facing cues, floor possession
       │      (◕‿◕)        (¬‿¬)       │
       ├───────────────────────────────┤
       │ Transcript & Grounding HUD    │  <- Clear citations, routing telemetry
       ├───────────────────────────────┤
       │ Composer & Prompt Templates   │  <- Low-friction input, hold-to-talk
       └───────────────────────────────┘
```

## Companions as conversational scaffolding

Duo uses two distinct companion identities to help make system state and turn boundaries visible:

- **Distinct Roles & Voices:** Momotamu brings warm, expansive possibilities; Vivi contributes sharp questions and grounded specifics. This contrast allows users to explore a topic dialectically through conversation between two distinct viewpoints.
- **Direct Address:** You can address one companion directly (*“Vivi (or Vivian), what do you think?”* or *“Tammy, explain this”*), and the routing engine immediately hands the floor to that character first.
- **Solo vs Duet Configuration:** Selecting a single companion creates a focused one-on-one session, while bringing both companions together enables rich back-and-forth discussions with configurable turn counts (2 to 12 turns).

## Visual feedback and floor-control cues

Non-verbal communication anchors the conversational flow:

- **Facing Direction:** In duet mode, Momotamu and Vivi turn toward each other on the platform to show active engagement in their shared conversation. In solo mode, the active companion turns forward toward you.
- **Speaking and Idle Poses:** Pose shifts and mouth movements visually communicate who holds the conversational floor, when an answer is generating, and when the system is ready for user input.
- **Conduit Telemetry:** In Cyberpunk mode, glowing conduits illuminate to show which companion is actively streaming and speaking, turning routing heuristics into ambient visual feedback.

## Emotional design and the kawaii foundation

Duo's visual language draws on kawaii aesthetics and emotional design principles:

- **Approachable Interaction:** Expressive, friendly visual art is intended to make local AI models and developer tooling feel more approachable.
- **Kawaii Research:** [Nittono et al. (2012)](https://doi.org/10.1371/journal.pone.0046362), *The Power of Kawaii*, is an inspiration for the visual direction.
- **Aesthetics and Usability:** [Tractinsky et al. (2000)](https://doi.org/10.1016/S0953-5438(00)00031-X), *What is beautiful is usable*, informs the interest in aesthetics and perceived usability.

These studies inspire Duo’s visual direction. Approachable aesthetics and clear conversational cues are core design ambitions, expressed through visible system state, readable dialogue and responsive user control. A future usability study could evaluate how these choices affect attention, cognitive load and ease of use in Duo.

## Ergonomic adaptations for desktop use

- **The Stage Layout:** Placing characters on an anchored top platform leaves the transcript readable and keeps the message composer and prompt templates within easy reach.
- **Side View:** Designed specifically for secondary side-screens, which are often smaller and viewed from an angle. Side view enlarges text, characters, and menus, provides a prominent 96×96 cursor, locks the message input on screen, and scrolls auxiliary controls neatly below.
- **Cyberpunk Holodeck:** Transforms the stage into a dark 3D wireframe lattice inspired by RAG telemetry visualizers, showing real-time document match counts, relevance cutoffs, and audio routing signals.
- **Reduced Motion:** Uses system reduced-motion preferences to freeze animated ambient accents while preserving essential turn-taking feedback.

## Related documentation

- [Character Guidelines](../CHARACTER-GUIDELINES.md) — Attribution and terms for Momotamu and Vivi.
- [Asset Provenance](ASSET-PROVENANCE.md) — Provenance inventory of character illustrations, poses, and reference audio.
- [SparkleSnap Design and Research Notes](https://learnjapanese.sparklesnap.dev/how-this-was-made/#research) — Extended background on pedagogical design and character creation.
