/**
 * The text a claimed namespace's first document starts with (CLAUDE.md §12b).
 *
 * VERBATIM AND HUMAN-RATIFIED. This is product copy, not documentation: it is the
 * first thing a new person reads inside the tool, and it was written and approved
 * word for word. Do not reword it, retitle it, or "tidy" its punctuation.
 *
 * MARKDOWN IN THE §1 DIALECT — paragraphs and bold, and nothing else. The section
 * labels are bold because a person reading this for the first time is scanning for
 * the part that answers their question, and §1 has no heading node to give them
 * one; bold labels are the dialect's answer to that. No headings, no lists, no
 * links. Two consequences that are easy to get wrong:
 *
 *   - `wordwright.ink/view` is a BARE URL and stays plain text. §0.1 turns off GFM
 *     autolink literals precisely so a bare URL is not silently rewritten into a
 *     link the human did not make, and this file must not be the exception.
 *   - It carries NO font styling of any kind. The landing page sets every rendered
 *     "WordWright" in Allison; this is stored editor content, which the editor
 *     renders in the draft's own face like any other draft. A wordmark span here
 *     would be markup outside the dialect, and it would round-trip to nothing.
 *
 * It reaches the store as an ordinary human turn — see `claimNamespace` in
 * src/claims.js — so canonicalize runs over it on the way in like any other text,
 * and §0.3 holds without a special case.
 */

export const SEED_DOCUMENT = `Welcome to WordWright. This app exists to enable and enforce human judgment across all the writing you do with AI.

**Working Together:** This is an environment where you and your AI agent can work on a text together. Who changed what when is saved automatically in the history below this box.

**Checkpoints:** When you're ready to save a draft, hit checkpoint. It acts like save in a video game: nothing is destroyed, and you can always go back to an earlier point by clicking restore to this turn. Hand edits are safe too: if you've changed the draft yourself without clicking checkpoint, those edits are saved automatically before any AI turn touches the text.

**Using AI:** When you want to use AI, you can prompt and attach things in the prompt box on the right, then read what the model says in the model response box below. Any changes it makes to your writing based on your prompting are saved automatically in their own, clearly marked, AI turns. If you talk to the model without changing the draft, that conversation is still saved as an AI turn. You keep the exchange without it touching your writing.

**Exporting:** If you want to save the process you used to make a document, hit export transcript. You can view the exported file at wordwright.ink/view.

**New Document:** Ready to write? Hit + New document to name your first document and get started. This welcome page stays in your namespace, so you can always come back to it.

Happy Writing!
`;

/**
 * The slug the seed document is created under.
 *
 * NOT §0.5's `DEFAULT_SLUG` ('draft'), and that is the point: this document is a
 * welcome page, not the visitor's first draft, and calling it `draft` invites
 * someone to start writing on top of the instructions they have not finished
 * reading. Its own name also makes it findable again in the switcher after they
 * have made real documents — which is what the seed text promises when it says the
 * welcome page stays in your namespace.
 *
 * The consequence, stated rather than discovered: a namespace claimed this way has
 * no document at `DEFAULT_SLUG`, so trimming the URL back to /t/{token} reaches
 * the ordinary "there is no document called draft yet" screen (§0.5), which offers
 * to create it and lists what IS there. The success link and every link inside the
 * app point at the welcome page, so nothing routes a new visitor there by itself.
 */
export const SEED_SLUG = 'welcome-doc';

export default SEED_DOCUMENT;
