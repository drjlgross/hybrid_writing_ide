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
import { createServer } from '../src/server.js';
import { createDocument, loadDocument, saveDocument } from '../src/storage.js';
import { commitHumanTurn } from '../src/turns.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

function freshDir() {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'ai-edit-'));
}

const ok = (text, overrides = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  ...overrides,
});

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

test('humanEditDiff compares against the previous turn, and is null for the first', () => {
  const doc = {
    history: [
      { turn_id: 1, author: 'human', snapshot: 'first version\n' },
      { turn_id: 2, author: 'human', snapshot: 'second version\n' },
    ],
  };

  assert.equal(humanEditDiff(doc, null), null, 'no human turn, no diff');
  assert.equal(humanEditDiff(doc, doc.history[0]), null, 'the first turn has nothing to diff against');
  assert.match(humanEditDiff(doc, doc.history[1]), /ADDED BY THE HUMAN: "second"/);
  assert.match(humanEditDiff(doc, doc.history[1]), /REMOVED BY THE HUMAN: "first"/);
});

test('§6: the payload carries the system prompt, the diff, the instruction, and the draft', () => {
  assert.match(SYSTEM_PROMPT, /Return ONLY the complete revised draft as raw Markdown/);
  assert.match(SYSTEM_PROMPT, /Treat the human's recent hand edits as deliberate/);
  assert.match(SYSTEM_PROMPT, /reproduced byte-for-byte identically/);

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
  const dir = freshDir();
  seed(dir, 'endpoint', 'The endpoint draft, long enough to keep the shrink guard quiet.\n');

  const app = createServer({
    dir,
    callModel: async () => ok('The revised endpoint draft, long enough to keep things quiet.\n'),
  });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/ai-edit`, {
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
  const dir = freshDir();
  seed(dir, 'guarded', 'The guarded draft, which must survive a bad response intact.\n');

  const app = createServer({
    dir,
    callModel: async () => ok('cut off half way', { stop_reason: 'max_tokens' }),
  });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/ai-edit`, { slug: 'guarded', prompt: 'expand it' });

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
  const dir = freshDir();
  const app = createServer({ dir, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    assert.equal((await post(`${url}/ai-edit`, { prompt: 'p' })).status, 400);
    assert.equal((await post(`${url}/ai-edit`, { slug: 's' })).status, 400);
    assert.equal((await post(`${url}/ai-edit`, { slug: 's', prompt: '   ' })).status, 400);
    assert.equal((await post(`${url}/ai-edit`, { slug: 'no-such-doc', prompt: 'p' })).status, 404);
  } finally {
    await close();
  }
});

test('the server never needs an API key to be constructed', () => {
  // createServer takes the caller as an argument; nothing reads the environment.
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.doesNotThrow(() => createServer({ callModel: async () => ok('x\n'), dir: freshDir() }));
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});
