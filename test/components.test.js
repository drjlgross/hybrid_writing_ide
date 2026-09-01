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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { App } from '../client/src/App.js';
import { AiPanel } from '../client/src/AiPanel.js';
import { Toolbar } from '../client/src/Toolbar.js';
import { h } from '../client/src/h.js';
import { LINK_OPTIONS } from '../src/tiptap-config.js';
import { serializeEditorMarkdown } from '../src/tiptap-serialize.js';
import { createEditor } from './helpers/headless-editor.js';
import { render } from './helpers/render.js';

/**
 * How many of these are on screen.
 *
 * Used instead of `assert.equal(view.find(sel), null)`: when that assertion
 * FAILS, node serializes a live DOM node into its diff, which takes ~23 seconds
 * and reports the whole file as failed rather than naming the test. Found while
 * mutation-checking the empty-state work in chunk 7.
 */
const count = (view, selector) => view.findAll(selector).length;

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
async function mountApp({ draft = 'The stored draft.\n', api = {}, slug = 'draft', navigate } = {}) {
  let editorInstance = null;
  const wentTo = [];

  const view = await render(
    h(App, {
      token: '0'.repeat(32),
      slug,
      navigate: navigate ?? ((href) => wentTo.push(href)),
      createApi: () => ({
        list: async () => ({ documents: [{ slug: 'draft', turns: 1, updated_at: null }] }),
        create: async (wanted) => ({ slug: wanted, draft: '', history: [] }),
        load: async () => ({ draft, history: [{ turn_id: 1 }] }),
        checkpoint: async () => ({ draft, turn: null, history: [{ turn_id: 1 }] }),
        aiEdit: async () => okTurn(draft),
        restore: async () => ({
          draft,
          human_turn: null,
          turn: null,
          restored_from: 1,
          history: [{ turn_id: 1 }],
        }),
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
  return { ...view, editor: () => editorInstance, wentTo };
}

/** The 404 an unknown slug produces, in the shape ApiError gives the session. */
const notFound = (slug) =>
  Object.assign(new Error(`no document with slug ${JSON.stringify(slug)}`), { status: 404 });

// ── §0.2: the lock is visible ───────────────────────────────────────────────────

test('§0.2 submitting a prompt puts the editor into a visibly read-only state', async () => {
  const gate = deferred();
  const view = await mountApp({ api: { aiEdit: () => gate.promise } });

  try {
    assert.equal(count(view, '.lock-veil'), 0, 'nothing is locked before a prompt is sent');
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

    assert.equal(count(view, '.lock-veil'), 0, 'and it all unwinds when the turn commits');
    assert.equal(count(view, '.status.pending'), 0);
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

    assert.equal(count(view, '.lock-veil'), 0, 'the editor unlocks');
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

// ── the empty draft is distinguishable from a broken one ────────────────────────

test('an empty draft renders a mounted, bordered, placeheld editor — not nothing', async () => {
  const view = await mountApp({ draft: '' });

  try {
    // The evidence that the editor MOUNTED, as opposed to having thrown: the
    // ProseMirror element exists, and it is what the stylesheet borders.
    const surface = view.find('.editor .tiptap');
    assert.ok(surface, 'TipTap must have mounted — this element is what carries the border');
    assert.equal(view.editor().isEmpty, true);

    // The evidence that it is EMPTY rather than failed.
    const placeholder = view.find('.editor-placeholder');
    assert.ok(placeholder, 'an empty draft must say it is empty');
    assert.match(placeholder.textContent, /Start writing/);
  } finally {
    await view.unmount();
  }
});

// One mount per test, deliberately: two mounts in one test leaves the second
// editor alive when the first assertion throws, and node --test then reports a
// hung FILE instead of a named failing test. Found while mutation-checking this.
test('a loaded draft shows no placeholder (the setContent route)', async () => {
  const view = await mountApp({ draft: 'Stored prose.\n' });
  try {
    assert.equal(count(view, '.editor-placeholder'), 0, 'a loaded draft is not empty');
    assert.ok(view.find('.editor .tiptap'));
  } finally {
    await view.unmount();
  }
});

test('typing into an empty draft clears the placeholder (the update route)', async () => {
  // `setContent` runs with emitUpdate:false, so this path and the one above
  // recompute emptiness by different means; both have to be checked.
  const view = await mountApp({ draft: '' });
  try {
    assert.ok(view.find('.editor-placeholder'), 'empty to begin with');

    await view.act(() => {
      view.editor().commands.insertContent('a word');
    });

    assert.equal(count(view, '.editor-placeholder'), 0, 'typing must clear the placeholder');
    assert.equal(view.editor().isEmpty, false);
  } finally {
    await view.unmount();
  }
});

test('the empty-state styling is pinned in the stylesheet, not only in the markup', () => {
  // An assertion on the CSS TEXT, deliberately: jsdom applies no stylesheet, so a
  // rendered assertion here would pass with every one of these rules deleted.
  // Named as a text-level check in the chunk-07 report.
  const css = readFileSync(
    fileURLToPath(new URL('../client/src/styles.css', import.meta.url)),
    'utf8',
  );
  const editorRule = /\.editor \.tiptap \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(editorRule, /min-height:/, 'the empty editor needs a minimum height');
  assert.match(editorRule, /border: *1px solid/, 'and a visible border');

  const placeholderRule = /\.editor-placeholder \{[^}]*\}/.exec(css)?.[0] ?? '';
  assert.match(
    placeholderRule,
    /pointer-events: *none/,
    'the placeholder overlays the editor and must not swallow the caret click',
  );
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

test('§2.3 a committed AI turn carries its warning and counts onto the screen', async () => {
  // The other §2.3 test renders AiPanel from a hand-built state. This one goes
  // through the whole client path — submit, commit, re-render — because the
  // question item 6 asks is whether the warning REACHES the screen, not whether
  // the panel can display one when handed it.
  const view = await mountApp({
    api: {
      aiEdit: async () => ({
        draft: 'The revision.\n',
        human_turn: null,
        ai_turn: {
          turn_id: 2,
          author: 'ai',
          prompt: 'make it formal',
          warnings: [
            'stripped: 2 headings, 1 blockquote, 1 table',
            'the draft is 63% shorter than before this turn, and the instruction did not ask for cutting',
          ],
          stripped: { heading: 2, blockquote: 1, table: 1 },
        },
        history: [{ turn_id: 1 }, { turn_id: 2 }],
      }),
    },
  });

  try {
    await view.type(view.find('textarea'), 'make it formal');
    await view.click(view.findByText('button', 'Send to the model'));
    await view.flush();

    const warning = view.find('.status.warning');
    assert.ok(warning, 'a turn that committed with warnings must show them');

    // Counts, by construct, exactly as §2.3 requires — not a generic message.
    assert.match(warning.textContent, /2 headings/);
    assert.match(warning.textContent, /1 blockquote/);
    assert.match(warning.textContent, /1 table/);
    assert.match(warning.textContent, /63% shorter/);

    assert.equal(
      view.findAll('.status.warning li').length,
      2,
      'each warning is its own line, so a second one cannot hide behind the first',
    );
    assert.equal(count(view, '.status.error'), 0, 'the turn committed — this is not an error');
  } finally {
    await view.unmount();
  }
});

// ── §0.5: the document list, and an address that names nothing ─────────────────

test('the documents in this namespace are listed, current one marked', async () => {
  const view = await mountApp({
    api: {
      list: async () => ({
        documents: [
          { slug: 'draft', turns: 7, updated_at: '2026-08-20T03:45:00.000Z' },
          { slug: 'track-c-post', turns: 2, updated_at: '2026-08-19T10:00:00.000Z' },
        ],
      }),
    },
  });

  try {
    const links = view.findAll('.doc a').map((a) => a.textContent);
    assert.deepEqual(links, ['draft', 'track-c-post']);

    const hrefs = view.findAll('.doc a').map((a) => a.getAttribute('href'));
    assert.deepEqual(hrefs, [
      `/t/${'0'.repeat(32)}/draft`,
      `/t/${'0'.repeat(32)}/track-c-post`,
    ]);

    assert.equal(
      view.find('.doc-current a').getAttribute('aria-current'),
      'page',
      'the document being edited is marked, not just styled',
    );
    assert.match(view.text(), /7 turns/, 'the list says how much is in each document');
    assert.match(view.text(), /2 turns/);
  } finally {
    await view.unmount();
  }
});

test('a document can be created, and creating another one goes there', async () => {
  const created = [];
  const view = await mountApp({
    api: {
      create: async (wanted) => {
        created.push(wanted);
        // The server sanitizes; the client must follow the slug it is GIVEN.
        return { slug: 'track-c-post', draft: '', history: [] };
      },
    },
  });

  try {
    await view.click(view.findByText('button', '+ New document'));
    await view.type(view.find('.library-form input'), 'Track C Post');
    await view.click(view.findByText('.library-form button', 'Create'));
    await view.flush();

    assert.deepEqual(created, ['Track C Post'], 'the raw name goes to the server, which sanitizes it');
    assert.deepEqual(
      view.wentTo,
      [`/t/${'0'.repeat(32)}/track-c-post`],
      'and the browser follows the slug the server chose, not the one typed',
    );
  } finally {
    await view.unmount();
  }
});

test('§0.5 an address naming a document that is not there offers to create it', async () => {
  const created = [];
  let exists = false;

  const view = await mountApp({
    slug: 'my-esay',
    api: {
      list: async () => ({ documents: [{ slug: 'draft', turns: 1, updated_at: null }] }),
      load: async () => {
        if (!exists) throw notFound('my-esay');
        return { draft: '', history: [] };
      },
      create: async (wanted) => {
        created.push(wanted);
        exists = true;
        return { slug: 'my-esay', draft: '', history: [] };
      },
    },
  });

  try {
    // Not a bare 404, and not an error: nothing has gone wrong.
    assert.ok(view.find('.missing'), 'a missing document gets a screen, not an error');
    assert.match(view.text(), /There is no document called/);
    assert.match(view.text(), /my-esay/);
    assert.equal(count(view, '.status.error'), 0, 'nothing failed, so nothing is reported as failed');

    // The documents that DO exist are still listed beside the offer.
    assert.deepEqual(view.findAll('.doc a').map((a) => a.textContent), ['draft']);

    await view.click(view.findByText('button', 'Create my-esay'));
    await view.flush();

    assert.deepEqual(created, ['my-esay']);
    assert.deepEqual(view.wentTo, [], 'the document is at this address already — no navigation');
    assert.equal(count(view, '.missing'), 0, 'and the editor takes over');
    assert.ok(view.find('.editor .tiptap'), 'the editor survived the missing screen and is mounted');
  } finally {
    await view.unmount();
  }
});

test('a failed listing does not masquerade as a failed draft', async () => {
  // Only one of these two failures means the human's text is in doubt.
  const view = await mountApp({
    api: { list: async () => { throw new Error('the listing blew up'); } },
  });

  try {
    assert.equal(count(view, '.status.error'), 0, 'a broken list must not raise a draft error');
    assert.match(view.text(), /No documents here yet/);
    assert.equal(
      serializeEditorMarkdown(view.editor()),
      'The stored draft.\n',
      'and the draft loaded regardless',
    );
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
    // Select "two" (doc positions: paragraph starts at 1). Through act(): the
    // selection change fires Toolbar's subscription, which is a setState.
    await view.act(() => editor.commands.setTextSelection({ from: 5, to: 8 }));

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
    await view.act(() => editor.commands.setTextSelection({ from: 10, to: 14 })); // "docs"

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

// ── §4: the history view, wired to a real editor ────────────────────────────────

/** The three-turn ledger the restore tests below drive. */
const LEDGER = [
  {
    turn_id: 1,
    author: 'human',
    timestamp: '2026-08-21T10:00:00.000Z',
    snapshot: 'The version that was working.\n',
  },
  {
    turn_id: 2,
    author: 'ai',
    timestamp: '2026-08-21T10:05:00.000Z',
    prompt: 'make it punchier',
    snapshot: 'The version the model made worse.\n',
  },
];

test('§4 the history is toggleable, and opening it never covers the draft', async () => {
  const view = await mountApp({
    draft: 'The version the model made worse.\n',
    api: { load: async () => ({ draft: 'The version the model made worse.\n', history: LEDGER }) },
  });

  try {
    assert.equal(count(view, '.history'), 0, 'closed by default — the draft is what you came for');

    await view.click(view.findByText('button', 'History (2 turns)'));

    assert.ok(view.find('.history'), 'the timeline opens');
    assert.equal(view.findAll('.turn').length, 2);

    // The chunk's UI constraint: no modal, no overlay. The editor is still mounted,
    // still on screen, and still editable while the history is open.
    assert.ok(view.find('.editor .tiptap'), 'the editor is still there');
    assert.equal(view.editor().isEditable, true, 'and still editable');
    assert.equal(count(view, '.lock-veil'), 0, 'nothing is veiling the draft');
    assert.match(
      serializeEditorMarkdown(view.editor()),
      /model made worse/,
      'the live draft is untouched by looking at the history',
    );

    await view.click(view.findByText('button', 'Hide history'));
    assert.equal(count(view, '.history'), 0, 'and it closes again');
  } finally {
    await view.unmount();
  }
});

test('§4 restore from the history puts the restored text in the editor and moves the count', async () => {
  // The client-path equivalent of the smoke script's step (e). The smoke script
  // proves the LEDGER is append-only; this proves the screen agrees with it.
  const asked = [];
  const restoredDraft = 'The version that was working.\n';
  const afterRestore = [
    ...LEDGER,
    { turn_id: 3, author: 'human', timestamp: '2026-08-21T10:09:00.000Z', snapshot: restoredDraft },
  ];

  const view = await mountApp({
    draft: 'The version the model made worse.\n',
    api: {
      load: async () => ({ draft: 'The version the model made worse.\n', history: LEDGER }),
      restore: async (slug, turnId, pendingDraft) => {
        asked.push({ slug, turnId, pendingDraft });
        return {
          draft: restoredDraft,
          human_turn: null,
          turn: afterRestore[2],
          restored_from: turnId,
          history: afterRestore,
        };
      },
    },
  });

  try {
    assert.match(view.text(), /Turns2/, 'two turns before');
    await view.click(view.findByText('button', 'History (2 turns)'));

    // One control per turn; the oldest entry is last, newest first.
    const buttons = view.findAll('.turn-restore');
    assert.equal(buttons.length, 2);
    await view.click(buttons[1]); // turn 1
    await view.flush();

    assert.deepEqual(
      asked.map((call) => call.turnId),
      [1],
      'the turn the human clicked, and only that one',
    );
    assert.match(
      asked[0].pendingDraft,
      /model made worse/,
      'the editor text goes with the request so a hand edit cannot be lost by restoring',
    );

    assert.equal(
      serializeEditorMarkdown(view.editor()),
      restoredDraft,
      'the editor shows the restored content',
    );
    assert.match(view.text(), /Turns3/, 'and the turn count moved — restore appended, it did not rewind');
    assert.match(view.text(), /restored turn 1 as turn 3/);
    assert.equal(count(view, '.status.error'), 0);
    assert.equal(view.findAll('.turn').length, 3, 'the timeline shows the new turn too');
  } finally {
    await view.unmount();
  }
});

test('§4 restoring to the turn the draft already is reports honestly and mints no turn', async () => {
  const view = await mountApp({
    draft: 'The version the model made worse.\n',
    api: {
      load: async () => ({ draft: 'The version the model made worse.\n', history: LEDGER }),
      restore: async (slug, turnId) => ({
        draft: 'The version the model made worse.\n',
        human_turn: null,
        turn: null,
        restored_from: turnId,
        history: LEDGER,
      }),
    },
  });

  try {
    await view.click(view.findByText('button', 'History (2 turns)'));
    await view.click(view.findAll('.turn-restore')[0]); // the live turn
    await view.flush();

    assert.match(view.text(), /nothing to restore/);
    assert.doesNotMatch(view.text(), /restored turn 2 as turn/);
    assert.match(view.text(), /Turns2/, 'the count did not move');
    assert.equal(view.findAll('.turn').length, 2);
  } finally {
    await view.unmount();
  }
});

test('§0.2 a restore in flight locks the draft, and says the reason is not the model', async () => {
  const gate = deferred();
  const view = await mountApp({
    draft: 'Before the restore.\n',
    api: {
      load: async () => ({ draft: 'Before the restore.\n', history: LEDGER }),
      restore: () => gate.promise,
    },
  });

  try {
    await view.click(view.findByText('button', 'History (2 turns)'));
    await view.click(view.findAll('.turn-restore')[1]);

    assert.ok(view.find('.lock-veil'), 'the draft is read-only while its content is being replaced');
    assert.equal(view.editor().isEditable, false);
    assert.match(view.text(), /read-only while the draft is restored/);
    assert.doesNotMatch(view.text(), /read-only while the model works/, 'no model is working');

    // And a second restore cannot start on top of the first.
    for (const button of view.findAll('.turn-restore')) {
      assert.equal(button.disabled, true);
    }

    gate.resolve({
      draft: 'The version that was working.\n',
      human_turn: null,
      turn: { turn_id: 3, author: 'human', timestamp: '2026-08-21T10:09:00.000Z', snapshot: 'The version that was working.\n' },
      restored_from: 1,
      history: LEDGER,
    });
    await view.flush();

    assert.equal(count(view, '.lock-veil'), 0, 'and it unlocks when the restore lands');
    assert.equal(view.editor().isEditable, true);
  } finally {
    await view.unmount();
  }
});

test('§4 a turn opened from the history is text a human can copy out of', async () => {
  const view = await mountApp({
    draft: 'The version the model made worse.\n',
    api: { load: async () => ({ draft: 'The version the model made worse.\n', history: LEDGER }) },
  });

  try {
    await view.click(view.findByText('button', 'History (2 turns)'));
    await view.click(view.findByText('button', 'Open turn 1 read-only'));

    const snapshot = view.find('.turn-snapshot pre');
    assert.equal(snapshot.textContent, LEDGER[0].snapshot, 'the whole draft as of turn 1');

    // §4 and this chunk's UI constraint: the live draft is editable, a snapshot
    // never is. Both are on screen at once, so the difference has to be real.
    assert.equal(view.editor().isEditable, true, 'the live draft is editable');
    assert.equal(
      view.find('.editor .tiptap').getAttribute('contenteditable'),
      'true',
      'and the DOM says so on the editor',
    );
    assert.equal(snapshot.getAttribute('contenteditable'), null, 'the snapshot says nothing of the kind');
    assert.equal(snapshot.getAttribute('aria-readonly'), 'true');
    assert.equal(
      view.find('.turn-snapshot').querySelectorAll('[contenteditable], input, textarea').length,
      0,
      'nothing inside the snapshot can take a caret',
    );
  } finally {
    await view.unmount();
  }
});

// ── the four things the browser found that jsdom could not ─────────────────────

test('the document list refreshes on every turn boundary, so its count cannot go stale', async () => {
  // The sidebar said "4 turns" while the panel said 13, because the listing was
  // only ever fetched at load. Every commit is a turn boundary and must re-fetch.
  let turns = 1;
  const listCalls = [];

  const view = await mountApp({
    api: {
      list: async () => {
        listCalls.push(turns);
        return { documents: [{ slug: 'draft', turns, updated_at: null }] };
      },
      checkpoint: async () => {
        turns = 2;
        return { draft: 'y\n', turn: { turn_id: 2, author: 'human' }, history: [{ turn_id: 1 }, { turn_id: 2 }] };
      },
      aiEdit: async () => {
        turns = 3;
        return okTurn('z\n', { ai_turn: { turn_id: 3, author: 'ai', prompt: 'p' }, history: [1, 2, 3].map((turn_id) => ({ turn_id })) });
      },
      restore: async () => {
        turns = 4;
        return {
          draft: 'w\n',
          human_turn: null,
          turn: { turn_id: 4, author: 'human' },
          restored_from: 1,
          history: [1, 2, 3, 4].map((turn_id) => ({ turn_id })),
        };
      },
    },
  });

  // Scoped to the SIDEBAR, not to the page: the history toggle and the panel both
  // print turn counts of their own, and a page-wide regex passes on those while the
  // library is still showing the number it was handed at page load. That is the exact
  // bug this test is about, so the assertion has to look at the library alone.
  const sidebarCount = () => view.find('.library .doc-meta').textContent;
  const panelCount = () => view.find('.meta').textContent;

  try {
    assert.match(sidebarCount(), /^1 turn$/, 'the count at load');

    await view.click(view.findByText('button', 'Checkpoint'));
    await view.flush();
    assert.match(sidebarCount(), /^2 turns$/, 'a checkpoint moved the sidebar');
    assert.match(panelCount(), /Turns2/, 'and the panel agrees with it');

    await view.type(view.find('textarea'), 'rewrite it');
    await view.click(view.findByText('button', 'Send to the model'));
    await view.flush();
    assert.match(sidebarCount(), /^3 turns$/, 'an AI turn moved the sidebar');
    assert.match(panelCount(), /Turns3/);

    await view.click(view.findByText('button', 'History (3 turns)'));
    await view.click(view.findAll('.turn-restore')[2]);
    await view.flush();
    assert.match(sidebarCount(), /^4 turns$/, 'a restore moved the sidebar');
    assert.match(panelCount(), /Turns4/);

    assert.equal(listCalls.length, 4, 'one listing at load, then one per turn boundary — no polling');
  } finally {
    await view.unmount();
  }
});

test('a commit that created no turn does not re-fetch the listing', async () => {
  // The other half of "on every turn boundary": a checkpoint with nothing to
  // commit changed no count, and asking again could only confirm what is on screen.
  let listCalls = 0;
  const view = await mountApp({
    api: {
      list: async () => {
        listCalls += 1;
        return { documents: [{ slug: 'draft', turns: 1, updated_at: null }] };
      },
      checkpoint: async () => ({ draft: 'x\n', turn: null, history: [{ turn_id: 1 }] }),
    },
  });

  try {
    assert.equal(listCalls, 1, 'the load');
    await view.click(view.findByText('button', 'Checkpoint'));
    await view.flush();
    assert.match(view.text(), /nothing to checkpoint/);
    assert.equal(listCalls, 1, 'no turn, no boundary, no request');
  } finally {
    await view.unmount();
  }
});

test('a link in the draft is a new-tab anchor, and a plain click opens it', async () => {
  const view = await mountApp({
    draft: 'Read [the docs](https://example.com/docs) before starting.\n',
  });

  try {
    const anchor = view.find('.editor .tiptap a');
    assert.ok(anchor, 'the link renders as an anchor');
    assert.equal(anchor.getAttribute('href'), 'https://example.com/docs');

    // Always a new tab, never a navigation of the app. TipTap's click handler
    // calls `window.open(href, link.target)`, so this attribute IS the guarantee.
    assert.equal(anchor.getAttribute('target'), '_blank');
    assert.match(anchor.getAttribute('rel') ?? '', /noopener/);

    // And the plain click is wired at all — it was `openOnClick: false`, so a
    // single click did nothing and only ⌘/Ctrl-click worked.
    assert.equal(LINK_OPTIONS.openOnClick, true, 'a single plain click must open the link');

    // Nothing is overlaid on the draft by having a link in it.
    assert.equal(count(view, '.lock-veil'), 0);
    assert.equal(view.editor().isEditable, true, 'and the draft is still editable around it');
  } finally {
    await view.unmount();
  }
});

test('a javascript: href never becomes a link, so opening one on click is not reachable', async () => {
  // openOnClick hands `link.href` to window.open, so what may become a link is now
  // load-bearing. The guard is TipTap's own scheme allowlist, NOT `LINK_OPTIONS.
  // protocols` — that option can only ADD to TipTap's base list and cannot narrow
  // it, so it is asserted here as documentation and the real check is behavioural.
  assert.deepEqual(LINK_OPTIONS.protocols, ['http', 'https', 'mailto']);

  // What must not exist is an ANCHOR. The URL text itself survives as ordinary
  // prose, which is fine and is not what window.open is ever handed.
  for (const trap of [
    'A [trap](javascript:alert(1)) here.\n',
    'A [trap](JaVaScRiPt:alert(1)) here.\n',
    'A [trap](data:text/html,hello) here.\n',
    'A [trap](vbscript:msgbox) here.\n',
  ]) {
    const editor = createEditor(trap);
    try {
      const html = editor.getHTML();
      assert.doesNotMatch(html, /<a\b/, `${trap.trim()} must not become a link at all`);
      assert.match(editor.getText(), /trap/, 'and its text survives as prose rather than vanishing');
    } finally {
      editor.destroy();
    }
  }

  // The allowed three still do become anchors, or the check above would pass by
  // making nothing a link.
  for (const [ok, href] of [
    ['A [doc](https://example.com/) here.\n', 'https://example.com/'],
    ['A [doc](http://example.com/) here.\n', 'http://example.com/'],
    ['A [doc](mailto:a@example.com) here.\n', 'mailto:a@example.com'],
  ]) {
    const editor = createEditor(ok);
    try {
      assert.match(editor.getHTML(), new RegExp(`href="${href.replace(/[/.]/g, '\\$&')}"`), ok);
    } finally {
      editor.destroy();
    }
  }
});

test('the panel links to the stored document as raw JSON, in a new tab', async () => {
  const view = await mountApp({ slug: 'draft' });

  try {
    const raw = view.find('.raw-json');
    assert.ok(raw, 'the stored file must be reachable from the UI');

    // The endpoint the app already loads from (§5). No new route.
    assert.equal(raw.getAttribute('href'), `/api/t/${'0'.repeat(32)}/documents/draft`);
    assert.equal(raw.getAttribute('target'), '_blank', 'never navigates the draft away');
    assert.match(raw.getAttribute('rel') ?? '', /noopener/);

    // Read-only by construction: it is a plain GET link, not a form or a button.
    assert.equal(raw.tagName, 'A');
  } finally {
    await view.unmount();
  }
});

test('the raw JSON link follows the slug it is looking at, and escapes it', async () => {
  const view = await mountApp({ slug: 'track-c-post', api: { load: async () => ({ draft: 'x\n', history: [] }) } });
  try {
    assert.equal(
      view.find('.raw-json').getAttribute('href'),
      `/api/t/${'0'.repeat(32)}/documents/track-c-post`,
    );
  } finally {
    await view.unmount();
  }
});
