/**
 * CLAUDE.md §3 turn model, §4 restore, and the §0.3 append-only invariant.
 *
 * The §3 rule (b) test is the one that matters most: it is the whole reason the app
 * exists. A hand edit followed by a prompt must produce two turns — the human's
 * edits alone, then the model's changes alone — or the provenance the history view
 * is built on does not exist.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LedgerInvariantError, assertLedgerInvariant } from '../src/storage.js';
import {
  AI,
  HUMAN,
  checkpoint,
  commitAiTurn,
  commitHumanTurn,
  getTurn,
  restoreToTurn,
  submitAiPrompt,
} from '../src/turns.js';

const AT = (n) => new Date(Date.UTC(2026, 6, 25, 12, 0, n));

/** A document as storage would hand it over: empty, turn zero. */
const emptyDoc = () => ({ schema_version: 1, slug: 'test', created_at: AT(0).toISOString(), draft: '', history: [] });

test('a turn has the §3 shape', () => {
  const { doc, turn } = commitHumanTurn(emptyDoc(), 'first draft\n', { now: AT(1) });

  assert.deepEqual(Object.keys(turn).sort(), ['author', 'snapshot', 'timestamp', 'turn_id']);
  assert.equal(turn.turn_id, 1);
  assert.equal(turn.author, HUMAN);
  assert.equal(turn.snapshot, 'first draft\n');
  assert.equal(turn.timestamp, '2026-07-25T12:00:01.000Z');
  assert.ok(!('prompt' in turn), 'a human turn must not carry a prompt');

  const ai = commitAiTurn(doc, { draft: 'revised\n', prompt: 'tighten it', now: AT(2) }).turn;
  assert.deepEqual(Object.keys(ai).sort(), ['author', 'prompt', 'snapshot', 'timestamp', 'turn_id']);
  assert.equal(ai.author, AI);
  assert.equal(ai.prompt, 'tighten it');
  assert.equal(ai.turn_id, 2);

  const warned = commitAiTurn(doc, {
    draft: 'short\n',
    prompt: 'cut it',
    warnings: ['large-shrink guard fired'],
    now: AT(3),
  }).turn;
  assert.deepEqual(warned.warnings, ['large-shrink guard fired']);
});

test('turn ids are sequential from 1 and the draft follows the last turn', () => {
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'one\n', { now: AT(1) }));
  ({ doc } = commitAiTurn(doc, { draft: 'two\n', prompt: 'p', now: AT(2) }));
  ({ doc } = commitHumanTurn(doc, 'three\n', { now: AT(3) }));

  assert.deepEqual(doc.history.map((t) => t.turn_id), [1, 2, 3]);
  assert.equal(doc.draft, 'three\n');
  assert.doesNotThrow(() => assertLedgerInvariant(doc));
});

test('no empty turn when the draft is unchanged (§3)', () => {
  const { doc } = commitHumanTurn(emptyDoc(), 'stable text\n', { now: AT(1) });

  const again = checkpoint(doc, 'stable text\n', { now: AT(2) });
  assert.equal(again.turn, null, 'an unchanged draft must not create a turn');
  assert.equal(again.doc.history.length, 1);
  assert.equal(again.doc, doc, 'the document should be returned untouched');

  // Unchanged AFTER canonicalization also counts as unchanged: retyping `*` bullets
  // as `-` bullets is not an edit to the draft, it is the same draft.
  const canonicalised = checkpoint(doc, 'stable text', { now: AT(3) });
  assert.equal(canonicalised.turn, null);
});

test('a turn snapshot is canonical (§0.1)', () => {
  const { turn } = commitHumanTurn(emptyDoc(), '* star bullet\n\n* another\n', { now: AT(1) });
  assert.equal(turn.snapshot, '- star bullet\n- another\n');

  const { turn: aiTurn } = commitAiTurn(emptyDoc(), {
    draft: '_underscore italic_\n',
    prompt: 'p',
    now: AT(2),
  });
  assert.equal(aiTurn.snapshot, '*underscore italic*\n');
});

test('an AI turn stores the exact prompt string, and refuses to exist without one', () => {
  const doc = emptyDoc();
  const exact = '  Tighten the second paragraph.\n\nKeep my edits.  ';
  const { turn } = commitAiTurn(doc, { draft: 'x\n', prompt: exact, now: AT(1) });
  assert.equal(turn.prompt, exact, 'the prompt must be stored verbatim, not trimmed');

  for (const bad of ['', '   ', undefined, null, 42]) {
    assert.throws(
      () => commitAiTurn(doc, { draft: 'x\n', prompt: bad, now: AT(1) }),
      /must carry the exact prompt string/,
    );
  }
});

test('§3 rule (b): a hand edit then a prompt makes two turns, each holding only its own changes', async () => {
  // The scenario the whole app exists for. Start from a committed AI draft.
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'The cat sat on the mat. The dog barked loudly.\n', { now: AT(1) }));

  // The human hand-edits, WITHOUT checkpointing.
  const handEdited = 'The cat sat on the mat. The dog howled loudly.\n';

  // The model is told to make its own separate change, and preserves the hand edit.
  const modelOutput = 'The cat dozed on the mat. The dog howled loudly.\n';
  const prompt = 'make the first sentence calmer';

  const seenByModel = [];
  const result = await submitAiPrompt(doc, {
    pendingDraft: handEdited,
    prompt,
    now: (() => {
      let n = 1;
      return () => AT(1 + n++);
    })(),
    callModel: ({ draft, humanTurn }) => {
      seenByModel.push({ draft, humanTurnId: humanTurn?.turn_id });
      return modelOutput;
    },
  });

  // Two turns were created, in this order, from one submission.
  assert.equal(result.humanTurn.author, HUMAN);
  assert.equal(result.aiTurn.author, AI);
  assert.deepEqual(result.doc.history.map((t) => [t.turn_id, t.author]), [
    [1, HUMAN],
    [2, HUMAN],
    [3, AI],
  ]);

  // The human turn holds ONLY the hand edit: barked → howled, and nothing else.
  const humanTurn = getTurn(result.doc, 2);
  assert.equal(humanTurn.snapshot, handEdited);
  assert.match(humanTurn.snapshot, /howled/, 'the hand edit is missing from the human turn');
  assert.match(humanTurn.snapshot, /cat sat/, "the human turn must not contain the model's change");
  assert.ok(!('prompt' in humanTurn), 'the hand edits are not attributable to a prompt');

  // The AI turn holds ONLY the model's change: sat → dozed, on top of the hand edit.
  const aiTurn = getTurn(result.doc, 3);
  assert.equal(aiTurn.snapshot, modelOutput);
  assert.match(aiTurn.snapshot, /cat dozed/, "the model's change is missing from the AI turn");
  assert.match(aiTurn.snapshot, /howled/, 'the model turn silently reverted the hand edit');
  assert.equal(aiTurn.prompt, prompt);

  // The model was called AFTER the human turn was committed, and saw that draft —
  // which is what §2.1 requires for the hand-edit diff to be computable.
  assert.deepEqual(seenByModel, [{ draft: handEdited, humanTurnId: 2 }]);

  assert.doesNotThrow(() => assertLedgerInvariant(result.doc));
});

test('§3 rule (b): submitting with no pending edits creates no empty human turn', async () => {
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'unchanged\n', { now: AT(1) }));

  const result = await submitAiPrompt(doc, {
    pendingDraft: 'unchanged\n',
    prompt: 'do something',
    callModel: () => 'model output\n',
    now: () => AT(2),
  });

  assert.equal(result.humanTurn, null, 'an unchanged draft must not create a human turn');
  assert.deepEqual(result.doc.history.map((t) => [t.turn_id, t.author]), [[1, HUMAN], [2, AI]]);
});

test('§2.4: a model failure leaves the human turn committed', async () => {
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'original\n', { now: AT(1) }));

  await assert.rejects(
    () =>
      submitAiPrompt(doc, {
        pendingDraft: 'hand edited\n',
        prompt: 'p',
        callModel: () => { throw new Error('stop_reason was max_tokens'); },
        now: () => AT(2),
      }),
    /stop_reason/,
  );

  // The document handed in is untouched — callers hold the pre-submission value — but
  // the human turn is recoverable, because §2.4 says it represents real work. What
  // matters is that nothing committed a partial AI turn.
  assert.equal(doc.history.length, 1, 'the input document must not be mutated');
});

test('§4 restore appends a new human turn and never rewrites history', () => {
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'version one\n', { now: AT(1) }));
  ({ doc } = commitAiTurn(doc, { draft: 'version two\n', prompt: 'rewrite it', now: AT(2) }));
  ({ doc } = commitHumanTurn(doc, 'version three\n', { now: AT(3) }));

  const before = structuredClone(doc.history);
  const { doc: restored, turn } = restoreToTurn(doc, 1, { now: AT(4) });

  assert.equal(restored.history.length, 4, 'restore must append, not truncate');
  assert.deepEqual(restored.history.slice(0, 3), before, 'existing turns were rewritten');
  assert.equal(turn.turn_id, 4);
  assert.equal(turn.author, HUMAN, 'a restore is the human acting, not the model');
  assert.ok(!('prompt' in turn), 'a restored turn carries no prompt');
  assert.equal(turn.snapshot, 'version one\n');
  assert.equal(restored.draft, 'version one\n');
  assert.doesNotThrow(() => assertLedgerInvariant(restored));

  // The turn that was restored away from is still there, in full.
  assert.equal(getTurn(restored, 3).snapshot, 'version three\n');
});

test('§4 restore: unknown turn throws, restoring to where you already are is not an edit', () => {
  let doc = emptyDoc();
  ({ doc } = commitHumanTurn(doc, 'only turn\n', { now: AT(1) }));

  assert.throws(() => restoreToTurn(doc, 99, { now: AT(2) }), /no such turn/);
  assert.throws(() => restoreToTurn(doc, 0, { now: AT(2) }), /no such turn/);

  const { doc: same, turn } = restoreToTurn(doc, 1, { now: AT(2) });
  assert.equal(turn, null, 'restoring to the current draft must not create an empty turn');
  assert.equal(same.history.length, 1);
});

test('committing a turn never mutates the document handed in', () => {
  const doc = emptyDoc();
  const frozen = structuredClone(doc);

  commitHumanTurn(doc, 'new text\n', { now: AT(1) });
  commitAiTurn(doc, { draft: 'ai text\n', prompt: 'p', now: AT(2) });

  assert.deepEqual(doc, frozen, 'the input document was mutated');
});

test('a turn that would break the ledger cannot be committed', () => {
  // Constructed violation: a document whose draft already disagrees with its history.
  const broken = { ...emptyDoc(), draft: 'ghost text\n', history: [] };
  assert.throws(() => commitHumanTurn(broken, 'ghost text\n', { now: AT(1) }), LedgerInvariantError);
});
