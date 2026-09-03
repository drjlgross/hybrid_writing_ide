/**
 * CLAUDE.md §2.4 turn sequence and the §5 endpoint, end to end.
 *
 * No API key, no network. Every model response is a canned object, and the HTTP
 * tests start the real Express app on an ephemeral port and use global fetch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAiEdit, humanEditDiff } from '../src/ai-edit.js';
import { buildUserMessage, SYSTEM_PROMPT } from '../src/anthropic-client.js';
import { modelResponse, rawResponse, speechOnlyResponse } from './helpers/model-response.js';
import { createServer } from '../src/server.js';
import { generateToken, resolveNamespace } from '../src/namespace.js';
import { createDocument, loadDocument, saveDocument } from '../src/storage.js';
import { commitHumanTurn } from '../src/turns.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

function freshDir() {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'ai-edit-'));
}

/**
 * A namespace root plus one token in it (§0.5). The HTTP tests address documents
 * the way the app does — through `/api/t/{token}/…` — so the routes, the token
 * check, and the one resolver function are all exercised, not bypassed.
 */
function freshNamespace() {
  const root = freshDir();
  const token = generateToken();
  return { root, token, dir: resolveNamespace(token, { root }).dir };
}

/** A well-formed §2.2 response proposing `text` as the revised draft. */
const ok = (text, overrides = {}) => modelResponse(text, overrides);

/** A document with one committed human turn. */
function seed(dir, slug, draft) {
  const doc = createDocument({ slug, dir });
  const { doc: withTurn } = commitHumanTurn(doc, draft);
  return saveDocument(withTurn, { dir });
}

/** Start the app on an ephemeral port; returns {url, close}. */
async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test('§2.4: the full sequence commits a human turn, then an AI turn', async () => {
  const dir = freshDir();
  seed(dir, 'seq', 'The cat sat on the mat. The dog barked loudly.\n');

  const seen = [];
  const result = await runAiEdit({
    slug: 'seq',
    dir,
    prompt: 'make the first sentence calmer',
    pendingDraft: 'The cat sat on the mat. The dog howled loudly.\n', // hand edit
    callModel: async (input) => {
      seen.push(input);
      return ok('The cat dozed on the mat. The dog howled loudly.\n');
    },
  });

  // Two turns from one submission, in order (§3 rule b).
  assert.deepEqual(result.doc.history.map((t) => [t.turn_id, t.author]), [
    [1, 'human'],
    [2, 'human'],
    [3, 'ai'],
  ]);
  assert.match(result.humanTurn.snapshot, /howled/, 'the human turn holds the hand edit');
  assert.match(result.humanTurn.snapshot, /cat sat/, "and not the model's change");
  assert.match(result.aiTurn.snapshot, /cat dozed/, "the AI turn holds the model's change");
  assert.match(result.aiTurn.snapshot, /howled/, 'and preserves the hand edit');
  assert.equal(result.aiTurn.prompt, 'make the first sentence calmer');

  // §2.1: the model saw the post-human-turn draft AND the diff of that turn.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].draft, 'The cat sat on the mat. The dog howled loudly.\n');
  assert.match(seen[0].humanEditDiff, /ADDED BY THE HUMAN: "howled"/);
  assert.match(seen[0].humanEditDiff, /REMOVED BY THE HUMAN: "barked"/);

  // It is on disk, and the reload matches.
  assert.deepEqual(loadDocument('seq', { dir }), result.doc);
});

test('§2.4: a failed model call leaves the human turn committed on disk', async () => {
  const dir = freshDir();
  seed(dir, 'failure', 'Original text that is long enough to matter.\n');

  await assert.rejects(
    () =>
      runAiEdit({
        slug: 'failure',
        dir,
        prompt: 'do something',
        pendingDraft: 'Hand-edited text that is long enough to matter.\n',
        callModel: async () => {
          throw new Error('the network is down');
        },
      }),
    /the network is down/,
  );

  // §2.4: the draft is at the state after step 2, and the human turn survived —
  // it represents real work.
  const after = loadDocument('failure', { dir });
  assert.equal(after.draft, 'Hand-edited text that is long enough to matter.\n');
  assert.deepEqual(after.history.map((t) => t.author), ['human', 'human']);
});

test('§2.4: a truncated response leaves the draft where it was, with no AI turn', async () => {
  const dir = freshDir();
  const seeded = seed(dir, 'truncated', 'A draft that is quite long and should survive intact.\n');

  await assert.rejects(
    () =>
      runAiEdit({
        slug: 'truncated',
        dir,
        prompt: 'expand it',
        callModel: async () => ok('A draft that is quite', { stop_reason: 'max_tokens' }),
      }),
    /max_tokens/,
  );

  const after = loadDocument('truncated', { dir });
  assert.deepEqual(after, seeded, 'nothing at all should have changed');
  assert.equal(after.draft, 'A draft that is quite long and should survive intact.\n');
});

test('the out-of-dialect warning and its structured counts land on the turn', async () => {
  const dir = freshDir();
  seed(dir, 'stripper', 'A plain draft, long enough that the shrink guard stays quiet here.\n');

  const result = await runAiEdit({
    slug: 'stripper',
    dir,
    prompt: 'restructure it',
    callModel: async () =>
      ok('# Heading\n\nA plain draft, long enough that the shrink guard stays quiet here.\n\n> quoted\n'),
  });

  assert.deepEqual(result.aiTurn.stripped, { heading: 1, blockquote: 1 });
  assert.equal(result.aiTurn.warnings.length, 1);
  assert.match(result.aiTurn.warnings[0], /stripped: 1 blockquote, 1 heading/);

  // Structured data survives the JSON round trip to disk.
  const reloaded = loadDocument('stripper', { dir });
  assert.deepEqual(reloaded.history.at(-1).stripped, { heading: 1, blockquote: 1 });
});

test('the shrink warning lands on the turn, and the turn still commits', async () => {
  const dir = freshDir();
  seed(dir, 'shrink', 'A long draft with several sentences in it. Here is another one. And a third.\n');

  const result = await runAiEdit({
    slug: 'shrink',
    dir,
    prompt: 'make it formal',
    callModel: async () => ok('Short.\n'),
  });

  assert.equal(result.draft, 'Short.\n', 'the turn committed');
  assert.equal(result.aiTurn.warnings.length, 1);
  assert.match(result.aiTurn.warnings[0], /shorter than before this turn/);
});

test('a shrink asked for still warns on the turn, in softened words (chunk 7 item 6)', async () => {
  const dir = freshDir();
  seed(dir, 'asked-shrink', 'A long draft with several sentences in it. Here is another one. And a third.\n');

  const result = await runAiEdit({
    slug: 'asked-shrink',
    dir,
    prompt: 'tighten the second paragraph',
    callModel: async () => ok('Short.\n'),
  });

  assert.equal(result.draft, 'Short.\n', 'the turn committed');
  assert.equal(
    result.aiTurn.warnings.length,
    1,
    'a requested cut is still a 90% shrink, and the history has to say so',
  );
  assert.match(result.aiTurn.warnings[0], /did ask for cutting/);
});

test('no empty human turn when nothing was typed since the last turn', async () => {
  const dir = freshDir();
  const seeded = seed(dir, 'nopending', 'Unchanged draft that is long enough to be uninteresting.\n');

  const result = await runAiEdit({
    slug: 'nopending',
    dir,
    prompt: 'improve it',
    pendingDraft: seeded.draft,
    callModel: async (input) => {
      assert.equal(input.humanEditDiff, null, 'no human turn means no diff to send');
      return ok('Improved draft that is long enough to be uninteresting.\n');
    },
  });

  assert.equal(result.humanTurn, null);
  assert.deepEqual(result.doc.history.map((t) => t.author), ['human', 'ai']);
});

test('§2.1 humanEditDiff is the most recent human turn, diffed against the one before it', () => {
  const doc = {
    history: [
      { turn_id: 1, author: 'human', snapshot: 'first version\n' },
      { turn_id: 2, author: 'human', snapshot: 'second version\n' },
    ],
  };

  assert.equal(humanEditDiff(doc, doc.history[0]), null, 'the first turn has nothing to diff against');
  assert.match(humanEditDiff(doc, doc.history[1]), /ADDED BY THE HUMAN: "second"/);
  assert.match(humanEditDiff(doc, doc.history[1]), /REMOVED BY THE HUMAN: "first"/);

  // §2.1 item 2: "the diff of the most recent human turn, IF THE MOST RECENT TURN
  // IS A HUMAN TURN". No turn was minted by this submission — the human had
  // already checkpointed — and the diff is still owed, because the last turn in
  // the ledger is hers. Sending nothing here is what left "weigh in on the change
  // I just made" with no change attached (chunk 11).
  assert.match(humanEditDiff(doc, null), /ADDED BY THE HUMAN: "second"/);

  // But only when the last turn IS a human turn. After an AI turn there are no
  // recent hand edits, and inventing a diff of the model's own output would tell
  // the model its work was the human's.
  const afterAi = {
    history: [
      ...doc.history,
      { turn_id: 3, author: 'ai', prompt: 'p', snapshot: 'third version\n' },
    ],
  };
  assert.equal(humanEditDiff(afterAi, null), null, 'the last turn is the model\'s, so there is no diff to send');

  assert.equal(humanEditDiff({ history: [] }, null), null, 'and an empty ledger has none either');
});

test('§3 the terminal move: hand-edit, Checkpoint, then ask the model to comment', async () => {
  // §3, added 2026-09-02: "hand-edit, Checkpoint, then prompt the model to comment
  // on the change just made. The history must show a human turn carrying the edit,
  // then an AI turn with a note, zero candidates, and an unchanged snapshot."
  // This is the workflow's terminal move and the cheapest end-to-end test of §0.7
  // and §0.9 together.
  const dir = freshDir();
  const opening = 'The pipeline runs nightly. The biology is what makes it worth running.\n';
  seed(dir, 'terminal', opening);

  // The hand edit, committed by Checkpoint — its own human turn, before any prompt.
  const edited = 'The biology is what makes it worth running. The pipeline runs nightly.\n';
  const { doc: afterCheckpoint } = commitHumanTurn(loadDocument('terminal', { dir }), edited);
  saveDocument(afterCheckpoint, { dir });

  const seen = [];
  const result = await runAiEdit({
    slug: 'terminal',
    dir,
    prompt: 'weigh in on the change I just made',
    pendingDraft: edited, // nothing typed since the checkpoint
    callModel: async (input) => {
      seen.push(input);
      return speechOnlyResponse(
        'You moved the claim to the front. That is the right order — the pipeline was ' +
          'never the reason anyone would read this.',
      );
    },
  });

  // The model was told what she changed, even though this submission minted no turn.
  assert.equal(seen.length, 1);
  assert.match(seen[0].humanEditDiff, /ADDED BY THE HUMAN/, '§2.1: the diff of her most recent hand edits');
  assert.match(seen[0].humanEditDiff, /REMOVED BY THE HUMAN/, 'both halves of the move she made');
  assert.match(seen[0].humanEditDiff, /pipeline runs nightly/, 'and it names the sentence she moved');
  assert.equal(seen[0].draft, edited, 'and the model sees the draft as it now stands');

  // A human turn carrying the edit, then an AI turn with a note and no change.
  assert.equal(result.humanTurn, null, 'the Checkpoint already committed it — no second human turn');
  assert.deepEqual(result.doc.history.map((t) => [t.turn_id, t.author]), [
    [1, 'human'],
    [2, 'human'],
    [3, 'ai'],
  ]);

  const ai = result.doc.history[2];
  assert.match(ai.note, /^You moved the claim to the front/, '§0.7: the speech is in the ledger');
  assert.equal(ai.prompt, 'weigh in on the change I just made');
  assert.equal(ai.snapshot, result.doc.history[1].snapshot, '§0.9: the snapshot is unchanged');
  assert.equal(result.draft, edited, 'and the draft the human is looking at did not move');
  assert.ok(!('warnings' in ai), 'nothing to warn about');

  // It is a real turn on disk, not a skipped one (§3: a speech-only turn is not an
  // empty turn — the prompt and the note are provenance).
  const reloaded = loadDocument('terminal', { dir });
  assert.equal(reloaded.history.length, 3);
  assert.match(reloaded.history[2].note, /right order/, 'and the speech survives the JSON round trip');
});

test('§0.7 the note and §2.2 the segments land on the AI turn', async () => {
  const dir = freshDir();
  seed(dir, 'spoken', 'A draft long enough that the shrink guard has nothing to say about it.\n');

  const result = await runAiEdit({
    slug: 'spoken',
    dir,
    prompt: 'tighten the opening, and what is this actually arguing?',
    callModel: async () =>
      modelResponse('A tightened draft, still long enough that the shrink guard stays quiet.\n', {
        note: 'It is arguing that the ordering is the claim. The edit below rests on that.',
        segments: [
          { id: 's1', took: 'a copy edit to the opening', kind: 'edit' },
          { id: 's2', took: 'a question about what the draft argues', kind: 'question' },
        ],
      }),
  });

  assert.match(result.aiTurn.note, /the ordering is the claim/);
  assert.deepEqual(result.aiTurn.segments, [
    { id: 's1', took: 'a copy edit to the opening', kind: 'edit' },
    { id: 's2', took: 'a question about what the draft argues', kind: 'question' },
  ]);
  assert.match(result.aiTurn.snapshot, /A tightened draft/, 'and the text change is a separate record');

  // Both survive the JSON round trip to disk — §9's S13: the conversation has the
  // ledger's durability because it is IN the ledger.
  const reloaded = loadDocument('spoken', { dir }).history.at(-1);
  assert.equal(reloaded.note, result.aiTurn.note);
  assert.deepEqual(reloaded.segments, result.aiTurn.segments);
});

test('§2.3 a response that is not the §2.2 envelope fails the turn and keeps the draft', async () => {
  const dir = freshDir();
  const seeded = seed(dir, 'malformed', 'A draft that must survive a model ignoring the contract.\n');

  await assert.rejects(
    () =>
      runAiEdit({
        slug: 'malformed',
        dir,
        prompt: 'revise it',
        // The old contract: the complete revised draft as raw Markdown. It is not
        // JSON, so there is nothing to recover and nothing is committed.
        callModel: async () => rawResponse('A revised draft, as raw Markdown, with no envelope.\n'),
      }),
    /not the JSON object/,
  );

  assert.deepEqual(loadDocument('malformed', { dir }), seeded, 'nothing at all should have changed');
});

test('§6: the payload carries the system prompt, the diff, the instruction, and the draft', () => {
  // §6's rewritten text, and the parts of it that are §0.7 rather than decoration.
  assert.match(SYSTEM_PROMPT, /Treat the human's recent hand edits as deliberate/);
  assert.match(SYSTEM_PROMPT, /Propose an edit only where one was asked for/);
  assert.match(SYSTEM_PROMPT, /Many good turns propose nothing at all/);
  assert.match(SYSTEM_PROMPT, /Say what is useful and stop/);
  assert.match(SYSTEM_PROMPT, /Decompose it and say what you took from it before you act/);
  assert.match(SYSTEM_PROMPT, /must be left exactly as it is/);

  // §2.2's interim contract, spelled out because the model cannot read the spec.
  assert.match(SYSTEM_PROMPT, /YOUR ENTIRE REPLY IS ONE JSON OBJECT/);
  assert.match(SYSTEM_PROMPT, /"note"/);
  assert.match(SYSTEM_PROMPT, /"segments"/);
  assert.match(SYSTEM_PROMPT, /"draft"/);
  assert.doesNotMatch(SYSTEM_PROMPT, /"candidates"/, 'candidates are step 13, not this contract');
  assert.match(SYSTEM_PROMPT, /"note" is where you speak to her/, '§0.7');
  assert.match(SYSTEM_PROMPT, /"draft" is null whenever you are proposing no change/, '§0.7: a revision is optional');
  assert.match(SYSTEM_PROMPT, /never the draft: do not paste the\nrevised text into it/, '§12: the panel never restates the draft');
  assert.doesNotMatch(
    SYSTEM_PROMPT,
    /Return ONLY the complete revised draft as raw Markdown/,
    'the pre-§0.7 contract must be gone, not merely added to',
  );

  const withDiff = buildUserMessage({
    draft: 'the draft\n',
    prompt: 'the instruction',
    humanEditDiff: 'ADDED BY THE HUMAN: "howled"',
  });
  assert.match(withDiff, /most recent hand edits/, 'the diff must be labelled as the human\'s');
  assert.match(withDiff, /ADDED BY THE HUMAN: "howled"/);
  assert.match(withDiff, /the instruction/);
  assert.match(withDiff, /the draft/);
  assert.ok(
    withDiff.indexOf('hand edits') < withDiff.indexOf('the instruction'),
    'the diff comes before the instruction',
  );

  const withoutDiff = buildUserMessage({ draft: 'the draft\n', prompt: 'the instruction' });
  assert.doesNotMatch(withoutDiff, /hand edits/, 'no diff section when there was no human turn');
});

test('POST /ai-edit runs the sequence and returns the draft with turn metadata', async () => {
  const { root, token, dir } = freshNamespace();
  seed(dir, 'endpoint', 'The endpoint draft, long enough to keep the shrink guard quiet.\n');

  const app = createServer({
    root,
    callModel: async () => ok('The revised endpoint draft, long enough to keep things quiet.\n'),
  });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/api/t/${token}/ai-edit`, {
      slug: 'endpoint',
      prompt: 'tighten it',
      pendingDraft: 'The endpoint draft, hand edited, long enough to keep things quiet.\n',
    });

    assert.equal(status, 200);
    assert.match(body.draft, /The revised endpoint draft/);
    assert.equal(body.human_turn.author, 'human');
    assert.equal(body.ai_turn.author, 'ai');
    assert.equal(body.ai_turn.prompt, 'tighten it');
    assert.deepEqual(body.history.map((t) => t.author), ['human', 'human', 'ai']);
  } finally {
    await close();
  }
});

test('POST /ai-edit surfaces a §2.3 failure as an error, saying the draft is unchanged', async () => {
  const { root, token, dir } = freshNamespace();
  seed(dir, 'guarded', 'The guarded draft, which must survive a bad response intact.\n');

  const app = createServer({
    root,
    callModel: async () => ok('cut off half way', { stop_reason: 'max_tokens' }),
  });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/api/t/${token}/ai-edit`, {
      slug: 'guarded',
      prompt: 'expand it',
    });

    assert.equal(status, 502);
    assert.equal(body.draft_unchanged, true, 'the UI has to be able to tell the human their text is safe');
    assert.equal(body.reason, 'stop_reason');
    assert.equal(body.stop_reason, 'max_tokens');

    // And it really is unchanged on disk.
    assert.equal(
      loadDocument('guarded', { dir }).draft,
      'The guarded draft, which must survive a bad response intact.\n',
    );
  } finally {
    await close();
  }
});

test('POST /ai-edit validates its inputs and reports a missing document', async () => {
  const { root, token } = freshNamespace();
  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    assert.equal((await post(`${base}/ai-edit`, { prompt: 'p' })).status, 400);
    assert.equal((await post(`${base}/ai-edit`, { slug: 's' })).status, 400);
    assert.equal((await post(`${base}/ai-edit`, { slug: 's', prompt: '   ' })).status, 400);
    assert.equal((await post(`${base}/ai-edit`, { slug: 'no-such-doc', prompt: 'p' })).status, 404);
  } finally {
    await close();
  }
});

test('the server never needs an API key to be constructed', () => {
  // createServer takes the caller as an argument; nothing reads the environment.
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.doesNotThrow(() => createServer({ callModel: async () => ok('x\n'), root: freshDir() }));
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});
