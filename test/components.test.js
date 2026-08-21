/**
 * The editor and AI side panel (CLAUDE.md §9 step 6), rendered headlessly.
 *
 * A real TipTap editor, built from the SAME `buildExtensions()` the round-trip
 * tests run against, mounted in the jsdom approved in chunk 1. The API is a stub;
 * no server, no network, no key.
 *
 * What these are for: the §0.2 lock has a visible half and an enforced half, and
 * the enforced half is worth nothing if the human cannot see it. draft-session
 * tests cover the enforcement; these cover whether it reaches the screen, and
 * whether the toolbar can produce anything outside the §1 dialect.
 */

// Before anything that reaches react-dom. See test/helpers/dom.js.
import './helpers/dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { App } from '../client/src/App.js';
import { AiPanel } from '../client/src/AiPanel.js';
import { Toolbar } from '../client/src/Toolbar.js';
import { h } from '../client/src/h.js';
import { serializeEditorMarkdown } from '../src/tiptap-serialize.js';
import { createEditor } from './helpers/headless-editor.js';
import { render } from './helpers/render.js';

/** A promise the test resolves by hand, so "in flight" is a real state. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const okTurn = (draft, overrides = {}) => ({
  draft,
  human_turn: null,
  ai_turn: { turn_id: 2, author: 'ai', prompt: 'p' },
  history: [{ turn_id: 1 }, { turn_id: 2 }],
  ...overrides,
});

/** Mount the app with a stub API and a real TipTap editor in jsdom. */
async function mountApp({ draft = 'The stored draft.\n', api = {} } = {}) {
  let editorInstance = null;

  const view = await render(
    h(App, {
      token: '0'.repeat(32),
      slug: 'draft',
      createApi: () => ({
        load: async () => ({ draft, history: [{ turn_id: 1 }] }),
        checkpoint: async () => ({ draft, turn: null, history: [{ turn_id: 1 }] }),
        aiEdit: async () => okTurn(draft),
        ...api,
      }),
      createEditor: (element) => {
        editorInstance = createEditor('');
        // The editor is created against its own detached element by the helper;
        // move its DOM under the mount point so the component tree is real.
        element.appendChild(editorInstance.view.dom);
        return editorInstance;
      },
    }),
  );

  await view.flush();
  return { ...view, editor: () => editorInstance };
}

// ── §0.2: the lock is visible ───────────────────────────────────────────────────

test('§0.2 submitting a prompt puts the editor into a visibly read-only state', async () => {
  const gate = deferred();
  const view = await mountApp({ api: { aiEdit: () => gate.promise } });

  try {
    assert.equal(view.find('.lock-veil'), null, 'nothing is locked before a prompt is sent');
    assert.equal(view.editor().isEditable, true);

    await view.type(view.find('textarea'), 'tighten it');

    await view.click(view.findByText('button', 'Send to the model'));

    // The request has not resolved. Everything below is what the human sees now.
    assert.ok(view.find('.lock-veil'), 'the read-only state must be visible on the draft itself');
    assert.ok(view.find('.status.pending'), 'and the panel must say why');
    assert.match(view.text(), /The model has the draft/);
    assert.match(view.text(), /read-only while the model works/);
    assert.equal(view.editor().isEditable, false, 'and the editor is genuinely read-only');

    // Every control that could start a competing turn is disabled.
    assert.equal(view.find('textarea').disabled, true);
    assert.equal(view.findByText('button', 'Checkpoint').disabled, true);
    assert.equal(view.findByText('button', 'Working…').disabled, true);
    for (const button of view.findAll('.toolbar .tool')) {
      assert.equal(button.disabled, true, `toolbar button ${button.title} must be disabled`);
    }

    gate.resolve(okTurn('The model’s revision.\n'));
    await view.flush();

    assert.equal(view.find('.lock-veil'), null, 'and it all unwinds when the turn commits');
    assert.equal(view.find('.status.pending'), null);
    assert.equal(view.editor().isEditable, true);
    assert.equal(view.find('textarea').value, '', 'the prompt box clears on success');
  } finally {
    await view.unmount();
  }
});

test('§0.2 a failed turn unlocks the editor and says the draft survived', async () => {
  const failure = Object.assign(new Error('the model stopped with stop_reason "max_tokens".'), {
    draft_unchanged: true,
  });
  const view = await mountApp({
    draft: 'The text that must survive.\n',
    api: {
      aiEdit: async () => {
        throw failure;
      },
    },
  });

  try {
    await view.type(view.find('textarea'), 'expand it');

    await view.click(view.findByText('button', 'Send to the model'));
    await view.flush();

    assert.equal(view.find('.lock-veil'), null, 'the editor unlocks');
    assert.equal(view.editor().isEditable, true);
    assert.ok(view.find('.status.error'), 'the failure is surfaced, not swallowed');
    assert.match(view.text(), /max_tokens/);
    assert.match(view.text(), /exactly as you left it/);

    // The draft on screen is untouched.
    assert.match(serializeEditorMarkdown(view.editor()), /The text that must survive/);
    // And the instruction is still there to retry with.
    assert.equal(view.find('textarea').value, 'expand it');
  } finally {
    await view.unmount();
  }
});

// ── the editor itself ───────────────────────────────────────────────────────────

test('the editor loads the stored draft and serializes it back unchanged', async () => {
  const stored = 'An **opening** with *emphasis* and [a link](https://example.com/docs).\n';
  const view = await mountApp({ draft: stored });

  try {
    assert.match(view.text(), /An opening with emphasis and a link/);
    assert.equal(
      serializeEditorMarkdown(view.editor()),
      stored,
      'canonical in, canonical out — a human turn that changed nothing must produce no diff',
    );
  } finally {
    await view.unmount();
  }
});

test('a committed AI turn replaces what is on screen', async () => {
  const view = await mountApp({
    draft: 'Before the turn.\n',
    api: { aiEdit: async () => okTurn('After the turn, entirely rewritten.\n') },
  });

  try {
    await view.type(view.find('textarea'), 'rewrite it');
    await view.click(view.findByText('button', 'Send to the model'));
    await view.flush();

    assert.equal(serializeEditorMarkdown(view.editor()), 'After the turn, entirely rewritten.\n');
    assert.match(view.text(), /After the turn, entirely rewritten/);
  } finally {
    await view.unmount();
  }
});

test('the send button is dead until an instruction is typed', async () => {
  const view = await mountApp();
  try {
    assert.equal(view.findByText('button', 'Send to the model').disabled, true);

    await view.type(view.find('textarea'), '   ');
    assert.equal(view.findByText('button', 'Send to the model').disabled, true, 'whitespace is not an instruction');

    await view.type(view.find('textarea'), 'make it warmer');
    assert.equal(view.findByText('button', 'Send to the model').disabled, false);
  } finally {
    await view.unmount();
  }
});

// ── §3 / §4: the UI must not report a turn that did not happen ──────────────────

test('§4 Checkpoint with nothing changed reports exactly that', async () => {
  const view = await mountApp({
    api: { checkpoint: async () => ({ draft: 'x\n', turn: null, history: [{ turn_id: 1 }] }) },
  });

  try {
    await view.click(view.findByText('button', 'Checkpoint'));
    await view.flush();

    assert.match(view.text(), /nothing to checkpoint/);
    assert.doesNotMatch(view.text(), /checkpointed as turn/);
  } finally {
    await view.unmount();
  }
});

test('Checkpoint that made a turn names it, and the turn count moves', async () => {
  const view = await mountApp({
    api: {
      checkpoint: async () => ({
        draft: 'y\n',
        turn: { turn_id: 2, author: 'human' },
        history: [{ turn_id: 1 }, { turn_id: 2 }],
      }),
    },
  });

  try {
    assert.match(view.text(), /Turns1/, 'one turn before');
    await view.click(view.findByText('button', 'Checkpoint'));
    await view.flush();

    assert.match(view.text(), /checkpointed as turn 2/);
    assert.match(view.text(), /Turns2/, 'two turns after');
  } finally {
    await view.unmount();
  }
});

// ── §2.3: stripped constructs must be legible ───────────────────────────────────

test('§2.3 warnings from a committed turn are shown, named, with counts', async () => {
  const state = {
    slug: 'draft',
    history: [{ turn_id: 1 }],
    pending: null,
    locked: false,
    dirty: false,
    error: null,
    notice: null,
    warnings: ['stripped: 2 headings, 1 blockquote, 1 table'],
    stripped: { heading: 2, blockquote: 1, table: 1 },
  };

  const view = await render(h(AiPanel, { state, onSubmit: async () => null, onCheckpoint: () => {} }));
  try {
    assert.ok(view.find('.status.warning'), 'a committed turn with warnings must show them');
    assert.match(view.text(), /stripped: 2 headings, 1 blockquote, 1 table/);
    assert.match(view.text(), /Committed, with warnings/, 'the turn committed — say so');
  } finally {
    await view.unmount();
  }
});

// ── §1 / §5: the toolbar offers the dialect and nothing else ────────────────────

test('§1 the toolbar offers exactly bold, italic, bullet list and link', async () => {
  const editor = createEditor('Some prose.\n');
  const view = await render(h(Toolbar, { editor, disabled: false }));

  try {
    const titles = view.findAll('.toolbar .tool').map((button) => button.title);
    assert.deepEqual(titles, ['Bold', 'Italic', 'Bullet list', 'Link']);

    // Not a list of what is missing for its own sake: every one of these is a
    // construct TipTap has no node for, so a button would produce text the store
    // cannot keep (§0.1, §7).
    for (const absent of ['Heading', 'Numbered list', 'Quote', 'Code', 'Table', 'Strikethrough']) {
      assert.equal(
        titles.includes(absent),
        false,
        `${absent} is outside the v1 dialect and must not be offered`,
      );
    }
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

test('§1 the toolbar buttons produce dialect Markdown, and reflect the caret', async () => {
  const editor = createEditor('one two three\n');
  const view = await render(h(Toolbar, { editor, disabled: false }));

  try {
    // Select "two" (doc positions: paragraph starts at 1).
    editor.commands.setTextSelection({ from: 5, to: 8 });

    await view.click(view.findByText('button', 'B'));
    assert.equal(serializeEditorMarkdown(editor), 'one **two** three\n');
    assert.equal(
      view.findByText('button', 'B').getAttribute('aria-pressed'),
      'true',
      'the button reflects the caret being inside bold',
    );

    await view.click(view.findByText('button', 'I'));
    assert.equal(serializeEditorMarkdown(editor), 'one ***two*** three\n');

    await view.click(view.findByText('button', 'I'));
    await view.click(view.findByText('button', 'B'));
    assert.equal(serializeEditorMarkdown(editor), 'one two three\n', 'and toggle back off');

    await view.click(view.findByText('button', '•'));
    assert.equal(serializeEditorMarkdown(editor), '- one two three\n');
  } finally {
    await view.unmount();
    editor.destroy();
  }
});

test('§1 the link control sets and clears a link, serializing as [text](url)', async () => {
  const editor = createEditor('read the docs\n');
  const view = await render(h(Toolbar, { editor, disabled: false }));

  try {
    editor.commands.setTextSelection({ from: 10, to: 14 }); // "docs"

    await view.click(view.findByText('button', '🔗'));
    const input = view.find('.link-form input');
    assert.ok(input, 'the link field opens inline — no modal dialog');

    await view.type(input, 'https://example.com/docs');

    await view.click(view.findByText('.link-form button', 'set'));
    assert.equal(serializeEditorMarkdown(editor), 'read the [docs](https://example.com/docs)\n');

    // Reopening prefills the current href, and an empty value removes the link.
    await view.click(view.findByText('button', '🔗'));
    assert.equal(view.find('.link-form input').value, 'https://example.com/docs');
    await view.type(view.find('.link-form input'), '');
    await view.click(view.findByText('.link-form button', 'set'));

    assert.equal(serializeEditorMarkdown(editor), 'read the docs\n');
  } finally {
    await view.unmount();
    editor.destroy();
  }
});
