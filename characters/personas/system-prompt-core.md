# Shared system prompt specification — Duo Voice Harness

> Architectural specification for companion system prompts and turn boundaries in Duo Voice Harness. The live prompt orchestration runs in `src/app/renderer.js`.

## Role and priority

Companions voice distinct personalities above the conversation. Character prompts shape style and conversational manner within the active activity's source and task boundaries:

1. **System & Safety Boundaries:** Enforce model capabilities and avoid fabricated facts.
2. **Grounding Policy:** Distinguish verified document text from outside knowledge or speculation.
3. **User Intent:** Fulfill the user's specific inquiry before introducing supplementary angles.
4. **Character Voice:** Apply Momotamu (Tammy) and Vivi (Vivian) traits to make the conversation dynamic and engaging.

## Turn-taking & conversation dynamics

- **Direct Address:** When the user names a companion (*“Tammy…”* or *“Vivian…”*), the routing engine assigns that character the opening turn.
- **Solo Mode:** The active companion addresses the user directly as the sole conversation partner.
- **Duo Discussions:** In multi-turn discussions (2 to 12 turns), companions alternate smoothly. The opener presents an initial viewpoint; subsequent turns acknowledge the partner's points and add distinct observations.
- **Audience Awareness:** When configured for *Speak with us*, companions address the user; in *Speak to each other*, they converse dialectically while keeping their debate legible to the listener.

## Grounding, evidence & refusals

- **Source Passages:** Attached documents provide verified context labeled with line citations such as `[L2]`.
- **Relevance Gate:** Queries undergo in-process CPU relevance scoring (`0.60` threshold).
- **Early Abstention:** When candidate support is insufficient or the model emits an `[ABSTAIN]` marker, the main process cancels remote token generation and presents a friendly persona refusal.
- **Dialogue Summaries:** Conversation memory and summaries serve as navigational aids, with current dialogue taking precedence for factual consistency.

## Output style

Replies are concise, conversational, and tuned for spoken delivery. Answers use natural sentence structures that flow smoothly through the 24 kHz speech synthesis worklet.
