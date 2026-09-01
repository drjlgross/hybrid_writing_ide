/**
 * CLAUDE.md §0.2 (the editor lock), §0.6 (serialize at commit boundaries only),
 * §3 (turn boundaries) and §2.4 (what a failed AI turn leaves behind), from the
 * client's side.
 *
 * The session is deliberately React-free and DOM-free, so these run in plain Node
 * against fake `api` and `editor` objects. §0.2 is the one rule in this app that
 * can silently destroy work; a rule that can only be checked by driving a browser
 * is a rule that does not get checked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDraftSession } from '../client/src/draft-session.js';

/** A fake editor that records everything the session does to it. */
function fakeEditor(initial = '') {
  return {
    markdown: initial,
    editable: true,
    serializeCount: 0,
    setContentCount: 0,

    getMarkdown() {
      this.serializeCount += 1;
      return this.markdown;
    },
    setMarkdown(md) {
      this.setContentCount += 1;
      this.markdown = md;
    },
    setEditable(value) {
      this.editable = value;
    },
  };
}

/** A promise whose resolution the test controls, so "in flight" is a real state. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const aiResult = (draft, overrides = {}) => ({
  draft,
  human_turn: null,
  ai_turn: { turn_id: 2, author: 'ai', prompt: 'p' },
  history: [{ turn_id: 2, author: 'ai' }],
  ...overrides,
});

function build({ api = {}, initial = '' } = {}) {
  const editor = fakeEditor(initial);
  const session = createDraftSession({
    slug: 'draft',
    editor,
    api: {
      load: async () => ({ draft: initial, history: [] }),
      checkpoint: async () => ({ draft: initial, turn: null, history: [] }),
      aiEdit: async () => aiResult(initial),
      ...api,
    },
  });
  return { editor, session };
}

// ── §0.2: the lock ──────────────────────────────────────────────────────────────

test('§0.2 the editor goes read-only the moment an AI turn is submitted, not when it lands', async () => {
  const gate = deferred();
  const { editor, session } = build({
    initial: 'Draft as of T.\n',
    api: { aiEdit: () => gate.promise },
  });

  const inFlight = session.submitPrompt('tighten it');

  // Before anything resolves. The request carries draft-at-T and the response
  // replaces the working draft seconds later; anything typed in between would be
  // destroyed silently and would never appear in the history.
  assert.equal(editor.editable, false, 'the editor must lock before the first await, not after');
  assert.equal(session.getState().locked, true);
  assert.equal(session.getState().pending, 'ai', 'the pending indicator must be visible immediately');

  gate.resolve(aiResult('The model’s revision.\n'));
  await inFlight;

  assert.equal(editor.editable, true, 'and unlock when it commits');
  assert.equal(session.getState().locked, false);
  assert.equal(session.getState().pending, null);
});

test('§0.2 on error the editor unlocks and the draft is unchanged', async () => {
  const failure = Object.assign(new Error('the model stopped with stop_reason "max_tokens".'), {
    draft_unchanged: true,
  });
  const { editor, session } = build({
    initial: 'The text that must survive.\n',
    api: {
      aiEdit: async () => {
        throw failure;
      },
      load: async () => ({ draft: 'The text that must survive.\n', history: [{ turn_id: 1 }] }),
    },
  });

  const result = await session.submitPrompt('expand it');

  assert.equal(result, null);
  assert.equal(editor.editable, true, 'the editor must unlock on error');
  assert.equal(session.getState().locked, false);
  assert.equal(editor.markdown, 'The text that must survive.\n', 'the draft is untouched');
  assert.equal(editor.setContentCount, 0, 'nothing replaced the editor content');
  assert.match(session.getState().error, /max_tokens/);
  assert.match(
    session.getState().error,
    /exactly as you left it/,
    'the human has to be told their text is safe — the visible symptom is a turn that did nothing',
  );

  // §2.4: the human turn from step 2 stays committed, so the stored history moved
  // even though the text did not.
  assert.equal(session.getState().history.length, 1, 'the history is refreshed after a failure');
});

test('§0.2 a second prompt while one is in flight is refused, not raced', async () => {
  const gate = deferred();
  let calls = 0;
  const { editor, session } = build({
    initial: 'Original.\n',
    api: {
      aiEdit: () => {
        calls += 1;
        return gate.promise;
      },
    },
  });

  // Not awaited: with the guard removed the second call would sit on the same
  // gate, and awaiting it here would deadlock the suite instead of failing it.
  const first = session.submitPrompt('one');
  const second = session.submitPrompt('two');

  assert.equal(calls, 1, 'exactly one request — do not build the race');
  assert.match(session.getState().notice, /already in flight/);
  assert.equal(editor.editable, false, 'and the editor stays locked meanwhile');
  assert.equal(await second, null, 'the second submission must not start');

  gate.resolve(aiResult('Revised.\n'));
  await first;
  assert.equal(editor.editable, true);
});

test('§0.2 a checkpoint cannot start while an AI turn is in flight', async () => {
  const gate = deferred();
  let checkpoints = 0;
  const { session } = build({
    initial: 'Original.\n',
    api: {
      aiEdit: () => gate.promise,
      checkpoint: async () => {
        checkpoints += 1;
        return { draft: 'x', turn: null, history: [] };
      },
    },
  });

  const inFlight = session.submitPrompt('one');
  await session.checkpoint();
  assert.equal(checkpoints, 0, 'the draft is the model’s until the turn lands');

  gate.resolve(aiResult('Revised.\n'));
  await inFlight;
});

test('a committed AI turn replaces the editor content and clears the dirty flag', async () => {
  const { editor, session } = build({
    initial: 'Before.\n',
    api: { aiEdit: async () => aiResult('After, entirely rewritten.\n') },
  });

  session.noteEdit();
  assert.equal(session.getState().dirty, true);

  await session.submitPrompt('rewrite it');

  assert.equal(editor.markdown, 'After, entirely rewritten.\n');
  assert.equal(editor.setContentCount, 1);
  assert.equal(session.getState().draft, 'After, entirely rewritten.\n');
  assert.equal(session.getState().dirty, false);
});

test('§2.3 warnings on the committed turn reach the UI state', async () => {
  const { session } = build({
    api: {
      aiEdit: async () =>
        aiResult('text\n', {
          ai_turn: {
            turn_id: 4,
            author: 'ai',
            prompt: 'p',
            warnings: ['stripped: 2 headings, 1 blockquote'],
            stripped: { heading: 2, blockquote: 1 },
          },
        }),
    },
  });

  await session.submitPrompt('do it');
  assert.deepEqual(session.getState().warnings, ['stripped: 2 headings, 1 blockquote']);
  assert.deepEqual(session.getState().stripped, { heading: 2, blockquote: 1 });
});

// ── §0.6: serialize at commit boundaries only ───────────────────────────────────

test('§0.6 typing never serializes; only a commit boundary does', async () => {
  const { editor, session } = build({ initial: 'Some prose.\n' });

  for (let i = 0; i < 50; i += 1) session.noteEdit();
  assert.equal(editor.serializeCount, 0, 'a keystroke must not serialize the document');

  await session.checkpoint();
  assert.equal(editor.serializeCount, 1, 'Checkpoint is a commit boundary');

  await session.submitPrompt('go');
  assert.equal(editor.serializeCount, 2, 'submitting a prompt is the other commit boundary');
});

test('loading is the only other time content is set, and it comes from the stored draft', async () => {
  const { editor, session } = build({
    api: { load: async () => ({ draft: 'Stored canonical text.\n', history: [{ turn_id: 1 }] }) },
  });

  await session.load();

  assert.equal(editor.markdown, 'Stored canonical text.\n');
  assert.equal(session.getState().loaded, true);
  assert.equal(session.getState().dirty, false);
  assert.equal(session.getState().history.length, 1);
});

// ── §3 / §4: turn boundaries and honest reporting ───────────────────────────────

test('§3/§4 a checkpoint that created no turn must not report one', async () => {
  const { session } = build({
    initial: 'Unchanged.\n',
    api: { checkpoint: async () => ({ draft: 'Unchanged.\n', turn: null, history: [] }) },
  });

  await session.checkpoint();

  const { notice } = session.getState();
  assert.match(notice, /nothing to checkpoint/);
  assert.doesNotMatch(notice, /turn \d/, 'the UI must not report a turn that does not exist');
});

test('a checkpoint that did create a turn names it', async () => {
  const { session } = build({
    api: {
      checkpoint: async () => ({
        draft: 'New.\n',
        turn: { turn_id: 7, author: 'human' },
        history: [{ turn_id: 7 }],
      }),
    },
  });

  await session.checkpoint();
  assert.match(session.getState().notice, /turn 7/);
  assert.equal(session.getState().history.length, 1);
});

test('a checkpoint leaves the caret alone: it never replaces the editor content', async () => {
  const { editor, session } = build({
    initial: 'Mid-sentence, the human keeps typ',
    api: {
      checkpoint: async () => ({
        // The server stores the canonical form, which may differ in escaping.
        draft: 'Mid-sentence, the human keeps typ\n',
        turn: { turn_id: 1, author: 'human' },
        history: [{ turn_id: 1 }],
      }),
    },
  });

  await session.checkpoint();
  assert.equal(editor.setContentCount, 0, 'resetting the content would throw the caret to the top');
  assert.equal(editor.markdown, 'Mid-sentence, the human keeps typ');
});

test('typing while a checkpoint is in flight leaves the draft dirty', async () => {
  const gate = deferred();
  const { session } = build({
    initial: 'A line.\n',
    api: { checkpoint: () => gate.promise },
  });

  session.noteEdit();
  const inFlight = session.checkpoint();

  // The commit boundary was at T; this keystroke is after it and belongs to the
  // next turn, so the draft must not be called clean when the response lands.
  session.noteEdit();

  gate.resolve({ draft: 'A line.\n', turn: { turn_id: 1 }, history: [] });
  await inFlight;

  assert.equal(session.getState().dirty, true, 'edits made during the request are still uncommitted');
});

test('a checkpoint with nothing typed since the last one still reaches the server', async () => {
  // The client cannot know whether the draft is canonically unchanged — only the
  // server can, after canonicalizing. Deciding locally would let a purely
  // formatting-level edit go uncommitted.
  let calls = 0;
  const { session } = build({
    initial: 'A line.\n',
    api: {
      checkpoint: async () => {
        calls += 1;
        return { draft: 'A line.\n', turn: null, history: [] };
      },
    },
  });

  await session.checkpoint();
  assert.equal(calls, 1);
});

test('an empty prompt is refused without locking anything', async () => {
  let calls = 0;
  const { editor, session } = build({
    api: {
      aiEdit: async () => {
        calls += 1;
        return aiResult('x\n');
      },
    },
  });

  assert.equal(await session.submitPrompt('   '), null);
  assert.equal(calls, 0);
  assert.equal(editor.editable, true, 'a rejected prompt must not lock the editor');
  assert.match(session.getState().error, /instruction/);
});

// ── §4: restore, from the client's side ─────────────────────────────────────────

const restoreResult = (overrides = {}) => ({
  draft: 'Turn one text.\n',
  human_turn: null,
  turn: { turn_id: 4, author: 'human' },
  restored_from: 1,
  history: [{ turn_id: 1 }, { turn_id: 2 }, { turn_id: 3 }, { turn_id: 4 }],
  ...overrides,
});

test('§4 a restore replaces the editor content and names both turn numbers', async () => {
  const { editor, session } = build({
    initial: 'Turn three text.\n',
    api: { restore: async () => restoreResult() },
  });

  const result = await session.restoreTo(1);

  assert.equal(result.turn.turn_id, 4);
  assert.equal(editor.markdown, 'Turn one text.\n', 'the editor shows the restored content');
  assert.equal(editor.setContentCount, 1);

  const state = session.getState();
  assert.equal(state.draft, 'Turn one text.\n');
  assert.equal(state.history.length, 4, 'the turn count moved');
  assert.match(state.notice, /restored turn 1 as turn 4/);
  assert.equal(state.error, null);
});

test('§4 restoring to where you already are does not report a restore that did not happen', async () => {
  const { editor, session } = build({
    initial: 'Unchanged.\n',
    api: {
      restore: async () =>
        restoreResult({ turn: null, human_turn: null, draft: 'Unchanged.\n', history: [{ turn_id: 1 }] }),
    },
  });

  await session.restoreTo(1);

  assert.equal(editor.setContentCount, 0, 'nothing changed, so the caret is left alone');
  const state = session.getState();
  assert.match(state.notice, /nothing to restore/);
  assert.doesNotMatch(state.notice, /restored turn 1 as turn/);
  assert.equal(state.history.length, 1, 'and no turn was minted');
});

test('§4 a restore commits pending hand edits first, and says both things happened', async () => {
  const sent = [];
  const { session } = build({
    initial: 'Typed but never checkpointed.\n',
    api: {
      restore: async (slug, turnId, pendingDraft) => {
        sent.push({ slug, turnId, pendingDraft });
        return restoreResult({ human_turn: { turn_id: 3, author: 'human' }, turn: { turn_id: 4 } });
      },
    },
  });

  await session.restoreTo(1);

  assert.deepEqual(sent, [
    { slug: 'draft', turnId: 1, pendingDraft: 'Typed but never checkpointed.\n' },
  ], 'the editor text goes with the request, or the server cannot save it');

  const notice = session.getState().notice;
  assert.match(notice, /hand edits committed as turn 3/);
  assert.match(notice, /restored turn 1 as turn 4/);
});

test('§0.2 the editor is read-only while a restore is in flight, and unlocks after', async () => {
  // A restore replaces the draft exactly as an AI turn does, so anything typed
  // while it is in flight would be destroyed with no record of it having existed.
  const gate = deferred();
  const { editor, session } = build({
    initial: 'Before.\n',
    api: { restore: () => gate.promise },
  });

  const running = session.restoreTo(1);
  assert.equal(editor.editable, false, 'locked synchronously, before the first await');
  assert.equal(session.getState().locked, true);
  assert.equal(session.getState().pending, 'restore');

  gate.resolve(restoreResult());
  await running;

  assert.equal(editor.editable, true);
  assert.equal(session.getState().locked, false);
  assert.equal(session.getState().pending, null);
});

test('§0.2 a failed restore unlocks the editor and leaves the draft exactly as it was', async () => {
  const { editor, session } = build({
    initial: 'The text that must survive.\n',
    api: {
      restore: async () => {
        throw new Error('the restore blew up');
      },
    },
  });

  assert.equal(await session.restoreTo(1), null);

  assert.equal(editor.editable, true, 'the editor unlocks');
  assert.equal(editor.setContentCount, 0, 'and its content was never touched');
  assert.equal(editor.markdown, 'The text that must survive.\n');
  assert.match(session.getState().error, /the restore blew up/);
});

test('a restore cannot start while an AI turn is in flight', async () => {
  const gate = deferred();
  let restores = 0;
  const { session } = build({
    api: {
      aiEdit: () => gate.promise,
      restore: async () => {
        restores += 1;
        return restoreResult();
      },
    },
  });

  const running = session.submitPrompt('rewrite it');
  assert.equal(await session.restoreTo(1), null, 'refused, not raced');
  assert.equal(restores, 0, 'and the server was never asked');
  assert.match(session.getState().notice, /already in flight/);

  gate.resolve(aiResult('x\n'));
  await running;
});
