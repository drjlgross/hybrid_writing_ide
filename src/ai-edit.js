/**
 * The §2.4 turn sequence, end to end.
 *
 *   1. Lock the editor            — the client does this; the server is stateless
 *   2. Commit pending human edits as a human turn, canonicalized. Skip if unchanged.
 *   3. Compute the diff for that human turn, if one was created
 *   4. Call the API with the §2.1 payload
 *   5. Validate per §2.3. Strip fences. Canonicalize.
 *   6. Commit the AI turn with the exact prompt string
 *   7. Assert the §0.3 invariant
 *   8. Unlock the editor          — the client, on the response
 *
 * Any failure between 4 and 6 leaves the draft at the state after step 2 and the
 * human turn stays committed. That is enforced by persisting the human turn
 * before the model call, not by hoping the caller retries.
 */

import { validateAiResponse } from './ai-response.js';
import { formatDiffForPrompt } from './diff.js';
import { assertLedgerInvariant, loadDocument, saveDocument } from './storage.js';
import { getTurn, submitAiPrompt } from './turns.js';

/**
 * The diff of the most recent human turn (§2.1 item 2), or null.
 *
 * Compared against the turn BEFORE it: that is what the human changed. On the
 * first turn of a document there is no previous snapshot, so the whole draft is
 * the human's — and sending "everything is new" as a diff tells the model
 * nothing it cannot see in the draft itself.
 */
export function humanEditDiff(doc, humanTurn) {
  if (!humanTurn) return null;

  const index = doc.history.findIndex((turn) => turn.turn_id === humanTurn.turn_id);
  if (index <= 0) return null;

  const previous = doc.history[index - 1];
  return formatDiffForPrompt(previous.snapshot, humanTurn.snapshot);
}

/**
 * Run one AI edit against a stored document.
 *
 * @param {{
 *   slug: string,
 *   prompt: string,
 *   pendingDraft?: string,
 *   dir?: string,
 *   callModel: Function,
 *   now?: () => Date,
 * }} options
 * @returns {Promise<{doc: object, draft: string, humanTurn: object|null, aiTurn: object}>}
 */
export async function runAiEdit({ slug, prompt, pendingDraft, dir, callModel, now }) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('an AI edit needs a prompt string');
  }

  const doc = loadDocument(slug, dir ? { dir } : undefined);
  const save = (next) => saveDocument(next, dir ? { dir } : undefined);

  const result = await submitAiPrompt(doc, {
    pendingDraft: pendingDraft ?? doc.draft,
    prompt,
    now,

    // Step 2 lands on disk before the model is called, so a failure in steps 4-6
    // cannot take the human's work with it.
    onHumanTurn: ({ doc: afterHuman, turn }) => {
      if (turn) save(afterHuman);
    },

    callModel: async ({ doc: afterHuman, draft, humanTurn }) => {
      // Step 3: the diff of the human turn just committed.
      const diff = humanEditDiff(afterHuman, humanTurn);

      // Step 4: the API call.
      const body = await callModel({ draft, prompt, humanEditDiff: diff });

      // Step 5: every §2.3 guard. Throws rather than returning a bad draft.
      return validateAiResponse(body, { draft, prompt });
    },
  });

  // Step 6 happened inside submitAiPrompt. Step 7: assert before the write, and
  // saveDocument asserts again on the way to disk.
  assertLedgerInvariant(result.doc);
  const saved = save(result.doc);

  return {
    doc: saved,
    draft: saved.draft,
    humanTurn: result.humanTurn,
    aiTurn: getTurn(saved, result.aiTurn.turn_id),
  };
}
