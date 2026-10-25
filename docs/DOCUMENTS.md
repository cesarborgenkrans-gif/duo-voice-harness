# Bring a document into the conversation

Use **Document** in the controls below the composer to give Momotamu and Vivi a shared text reference. The editor opens above the conversation while keeping the mascot platform and writing field visible.

1. Paste text, or choose a UTF-8 `.txt`, `.md`, or `.markdown` file.
2. Give it a short name and select a conversation boundary.
3. Select **Use text**, then ask your question in the composer.

One source is attached to each saved chat or discussion. Reopening that conversation restores its source. Opening the editor creates a draft: closing it discards unapplied changes, and **Use text** saves them. **Detach** removes the source reference from subsequent turns in the current conversation.

## Choose the boundary

| Choice | What happens |
| --- | --- |
| **Use only this text** | Factual questions run a local relevance check. A failed match produces an in-character refusal; a passing match allows generation with instructions to use the text and cite its line labels. Summary and translation requests take a separate overview path over the supplied text. |
| **Also use outside knowledge** | The text serves as a reference, with instructions to distinguish source claims from general knowledge. Broader conversation continues when outside knowledge is enabled. |

Both companions receive the complete bounded text with line labels such as `[L2]` and instructions to cite those labels for source claims. Document turns evaluate each reply independently against the reference text.

Ask questions by typing or dictating into the composer. Sending an attached source with an empty composer requests an automatic summary.

## How relevance scoring works

The scorer evaluates lexical overlap, word stems, character n-grams, and term proximity on the CPU against a `0.60` relevance threshold. When a factual query meets the threshold, the check returns `ANSWERABLE` and passes the context to the model with labeled lines for inline citation.

- **Threshold check:** The `0.60` cutoff estimates topical overlap before generation. A passing score confirms topical alignment; verify detailed factual claims against the source text.
- **Persona refusals:** When a passage mentions related keywords without answering the specific inquiry, companions are prompted to politely decline and state what the text actually covers.
- **Dedicated tasks:** Recognized summary and translation requests use an overview path over the attached text without requiring the factual-question cutoff. Overview tasks synthesize the broader document context.
- **Early stream cancellation:** When a model starts a reply with the `[ABSTAIN]` marker, the main process immediately aborts the response stream, clears accompanying tokens, and speaks a friendly persona refusal.

Relevance scoring provides an initial automated filter to keep conversations focused on the supplied text. Companions are instructed to cite line labels such as `[L2]`, giving you a quick way to compare a response with its source. Treat a passing score as a relevance signal, then confirm important claims and cited lines directly against your text.

Open **Document** anytime to inspect the latest check score and status; the button tooltip also displays the current result.

## Input specifications & storage

- **Format:** Plain text files formatted in UTF-8 (`.txt`, `.md`, `.markdown`). For formatted PDFs or long reports, paste the relevant plain-text excerpt into the editor.
- **Capacity:** Supports up to **12,000 characters, 400 lines, and 64 KiB**.
- **Storage:** Text is stored locally in the conversation's `session.json` file under Windows Documents → `duo-voice-harness/chats/<id>/` or `discussions/<id>/`. Set `DUO_VOICE_SESSION_ROOT` to customize this location.
- **Model routing:** The attached text is sent to your selected language-model endpoint during document turns. Spoken audio routes only the final response text to your chosen voice provider.
- **Updates & Detach:** Replacing or detaching a document updates the active reference for upcoming turns while preserving your previous transcript history.

## Developer verification

Run `npm run test:grounding` to execute the automated grounding test suite in headless Electron. It verifies document attachment, session reopening, detach, dual companions, strict and general check boundaries, early stream cancellation, and in-character spoken refusals using local synthetic fixtures.
