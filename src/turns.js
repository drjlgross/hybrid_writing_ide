/**
 * The turn model (CLAUDE.md §3) — edit provenance.
 *
 * Pure over documents: every function takes a document and returns a new one,
 * never mutating the input and never touching disk. Persistence is the caller's
 * job (`saveDocument`), which asserts the §0.3 invariant again on the way out.
 *
 * History is append-only (§0.3). Nothing here removes or edits a committed turn,
 * including restore, which appends a new human turn holding the old snapshot.
 */

import { canonicalize } from './canonicalize.js';
import { assertLedgerInvariant } from './storage.js';

export const HUMAN = 'human';
export const AI = 'ai';

/** Turn ids are sequential from 1 and never reused, even after a restore. */
function nextTurnId(doc) {
  if (doc.history.length === 0) return 1;
  return doc.history[doc.history.length - 1].turn_id + 1;
}

/**
 * Append a turn and move the working draft to its snapshot, then assert §0.3.
 * The assertion is here rather than only in storage because a turn that breaks the
 * ledger should fail at the moment it is committed, not later at the write.
 */
function appendTurn(doc, turn) {
  const next = { ...doc, draft: turn.snapshot, history: [...doc.history, turn] };
  assertLedgerInvariant(next);
  return next;
}

/**
 * Commit accumulated human edits as one turn (§3).
 *
 * This is both turn boundaries (a) and (b): the human clicking Checkpoint, and the
 * human submitting an AI prompt. Returns `turn: null` when the draft is unchanged —
 * §3 forbids an empty turn.
 *
 * @param {object} doc
 * @param {string} draftText the editor's current text, not necessarily canonical
 * @param {{now?: Date}} [options]
 * @returns {{doc: object, turn: object|null}}
 */
export function commitHumanTurn(doc, draftText, { now = new Date() } = {}) {
  // On entry as well as on exit: a document that arrives already broken must fail
  // here, not silently pass through the unchanged-draft shortcut below.
  assertLedgerInvariant(doc);

  const snapshot = canonicalize(draftText);
  if (snapshot === doc.draft) return { doc, turn: null };

  const turn = {
    turn_id: nextTurnId(doc),
    timestamp: now.toISOString(),
    author: HUMAN,
    snapshot,
  };
  return { doc: appendTurn(doc, turn), turn };
}

/** Turn boundary (a): the human clicked Checkpoint. */
export const checkpoint = commitHumanTurn;

/**
 * Commit one AI turn with the exact prompt string (§3, §2.4 step 6).
 *
 * Unlike a human turn this is committed even when the draft is unchanged: the
 * prompt is provenance, and a prompt that changed nothing is a fact about the
 * session worth keeping. See the report for the §3/§2.4 tension.
 *
 * @param {object} doc
 * @param {{draft: string, prompt: string, warnings?: string[], now?: Date}} options
 * @returns {{doc: object, turn: object}}
 */
export function commitAiTurn(doc, { draft, prompt, warnings, now = new Date() }) {
  assertLedgerInvariant(doc);

  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('an AI turn must carry the exact prompt string (§3)');
  }
  if (typeof draft !== 'string') {
    throw new TypeError(`an AI turn needs the revised draft as a string, got ${typeof draft}`);
  }

  const turn = {
    turn_id: nextTurnId(doc),
    timestamp: now.toISOString(),
    author: AI,
    prompt, // exactly as the human typed it — never trimmed or normalized
    snapshot: canonicalize(draft),
  };
  if (warnings?.length) turn.warnings = [...warnings];

  return { doc: appendTurn(doc, turn), turn };
}

/**
 * The §2.4 turn sequence, minus the API call itself: commit pending human edits
 * first, then call the model, then commit the AI turn.
 *
 * §3 rule (b) is load-bearing — the human turn must exist before the AI turn, or
 * the hand edits are silently absorbed into the model's turn and the provenance is
 * gone. Making the model call an injected argument is what enforces the ordering:
 * there is no way to reach the AI turn without the human turn having been committed
 * first, and `callModel` receives the document as it stands at that point, which is
 * what §2.1 needs for the diff.
 *
 * @param {object} doc
 * @param {{pendingDraft: string, prompt: string, callModel: Function, now?: Date}} options
 * @returns {Promise<{doc: object, humanTurn: object|null, aiTurn: object}>}
 */
export async function submitAiPrompt(doc, { pendingDraft, prompt, callModel, now = () => new Date() }) {
  if (typeof callModel !== 'function') {
    throw new TypeError('submitAiPrompt needs a callModel function');
  }

  // Step 2: pending human edits become their own turn. Skipped when unchanged.
  const { doc: afterHuman, turn: humanTurn } = commitHumanTurn(doc, pendingDraft, { now: now() });

  // Steps 4-5: the model sees the draft as of the human turn.
  const result = await callModel({ doc: afterHuman, draft: afterHuman.draft, prompt, humanTurn });
  const revised = typeof result === 'string' ? { draft: result } : result;

  // Step 6: the AI turn. A failure above leaves the human turn committed (§2.4).
  const { doc: afterAi, turn: aiTurn } = commitAiTurn(afterHuman, {
    draft: revised.draft,
    prompt,
    warnings: revised.warnings,
    now: now(),
  });

  return { doc: afterAi, humanTurn, aiTurn };
}

/** Find a committed turn by id. */
export function getTurn(doc, turnId) {
  return doc.history.find((turn) => turn.turn_id === turnId);
}

/**
 * Restore the working draft to a turn's snapshot (§4).
 *
 * Appends a NEW human turn holding that snapshot. History is never rewritten and
 * never truncated — the turns after the restored one stay exactly where they are,
 * which is what makes a bad AI turn recoverable instead of destructive.
 *
 * Returns `turn: null` if the draft already equals that snapshot, since §3 forbids
 * an empty turn — restoring to where you already are is not an edit.
 *
 * @param {object} doc
 * @param {number} turnId
 * @param {{now?: Date}} [options]
 * @returns {{doc: object, turn: object|null}}
 */
export function restoreToTurn(doc, turnId, { now = new Date() } = {}) {
  const target = getTurn(doc, turnId);
  if (!target) {
    const ids = doc.history.map((turn) => turn.turn_id).join(', ');
    throw new Error(`cannot restore to turn ${turnId}: no such turn. History holds: ${ids || 'nothing'}`);
  }
  return commitHumanTurn(doc, target.snapshot, { now });
}
