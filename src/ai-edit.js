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
import { listContext, readContextContent } from './context-store.js';
import { formatDiffForPrompt } from './diff.js';
import { formatRulesForPrompt, resolveRules } from './rules-store.js';

/** Rule ids in scope, read through §0.11's one function. */
const resolveRuleIds = (doc) => resolveRules(doc).map((rule) => rule.id);
import { assertLedgerInvariant, loadDocument, saveDocument } from './storage.js';
import { getTurn, submitAiPrompt } from './turns.js';

/**
 * The diff of the most recent human turn (§2.1 item 2), or null.
 *
 * §2.1 says: "The word-level diff of the most recent human turn, IF THE MOST
 * RECENT TURN IS A HUMAN TURN." So the turn to diff is not only the one step 2
 * just minted — it is the last turn in the ledger whenever that turn is a human
 * one. The two differ in exactly the workflow §3 requires be verified: hand-edit,
 * Checkpoint, then prompt. The Checkpoint commits the edits, so step 2 creates
 * nothing, and reading only step 2's turn sent no diff at all for the change the
 * human had just made and was asking about. Fixed in chunk 11 and named there.
 *
 * Compared against the turn BEFORE it: that is what the human changed. On the
 * first turn of a document there is no previous snapshot, so the whole draft is
 * the human's — and sending "everything is new" as a diff tells the model
 * nothing it cannot see in the draft itself.
 */
export function humanEditDiff(doc, humanTurn) {
  const last = doc.history[doc.history.length - 1];
  const turn = humanTurn ?? (last?.author === 'human' ? last : null);
  if (!turn) return null;

  const index = doc.history.findIndex((entry) => entry.turn_id === turn.turn_id);
  if (index <= 0) return null;

  const previous = doc.history[index - 1];
  return formatDiffForPrompt(previous.snapshot, turn.snapshot);
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
export async function runAiEdit({ slug, prompt, pendingDraft, dir, filesDir, callModel, now }) {
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

      // §2.1 items 4 and 5. Content is read HERE and nowhere else — a document
      // listing must never pay for a screenshot, which is why §0.5 keeps the
      // bytes out of the document JSON.
      const files = listContext(afterHuman);
      const context = filesDir
        ? files.map((file) => {
            const loaded = readContextContent(file, { filesDir });
            return loaded.error ? { ...loaded, file } : { ...loaded, file };
          })
        : [];
      const rules = formatRulesForPrompt(afterHuman);

      // Step 4: the API call.
      const body = await callModel({ draft, prompt, humanEditDiff: diff, context, rules });

      // Step 5: every §2.3 guard. Throws rather than returning a bad draft.
      const result = validateAiResponse(body, { draft, prompt });

      // §8 C3: a file that could not be read is a warning ON THE TURN, so the
      // record says the model answered without it rather than leaving the human
      // to wonder why the context did not land.
      const unreadable = context.filter((entry) => entry.error).map((entry) => entry.error);
      return {
        ...result,
        warnings: unreadable.length > 0 ? [...result.warnings, ...unreadable] : result.warnings,
        // §3: what was in scope for this turn, by id.
        contextRef: files.map((file) => file.id),
        rulesRef: resolveRuleIds(afterHuman),
      };
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
