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
import { ModelResponse } from '../client/src/ModelResponse.js';
import { PromptBox, seedDescription } from '../client/src/PromptBox.js';
import { StandingRules } from '../client/src/StandingRules.js';
import { buildTranscript, saveJson } from '../client/src/transcript.js';
import { Toolbar } from '../client/src/Toolbar.js';
import { h } from '../client/src/h.js';
import { SCHEMA_VERSION } from '../src/schema.js';
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

/**
 * The stylesheet as TEXT.
 *
 * jsdom applies no stylesheet, so anything that is only true once CSS has been
 * applied — the two-ends layout of the prompt box's action row, the contrast of
 * lilac against the cream ground — has to be asserted against the source. A
 * rendered assertion would pass with every one of those rules deleted.
 */
const STYLESHEET = readFileSync(
  fileURLToPath(new URL('../client/src/styles.css', import.meta.url)),
  'utf8',
);

/** A rule body from the stylesheet, for the pins jsdom cannot check. */
const rule = (selector) =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`).exec(STYLESHEET)?.[0] ?? '';

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
async function mountApp({ draft = 'The stored draft.\n', api = {}, slug = 'draft', navigate, saveFile } = {}) {
  let editorInstance = null;
  const wentTo = [];
  const saved = [];

  const view = await render(
    h(App, {
      token: '0'.repeat(32),
      slug,
      navigate: navigate ?? ((href) => wentTo.push(href)),
      saveFile: saveFile ?? ((filename, data) => saved.push({ filename, data })),
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
  return { ...view, editor: () => editorInstance, wentTo, saved };
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

    await view.click(view.findByText('button', 'Submit'));

    // The request has not resolved. Everything below is what the human sees now.
    assert.ok(view.find('.lock-veil'), 'the read-only state must be visible on the draft itself');
    assert.ok(view.find('.status.pending'), 'and the panel must say why');
    assert.match(view.text(), /The model has the draft/);
    assert.match(view.text(), /read-only while the model works/);
    assert.equal(view.editor().isEditable, false, 'and the editor is genuinely read-only');

    // Every control that could start a competing turn is disabled.
    assert.equal(view.find('textarea').disabled, true);
    assert.equal(view.find('.checkpoint').disabled, true);
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

    await view.click(view.findByText('button', 'Submit'));
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
    await view.click(view.findByText('button', 'Submit'));
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
    assert.equal(view.findByText('button', 'Submit').disabled, true);

    await view.type(view.find('textarea'), '   ');
    assert.equal(view.findByText('button', 'Submit').disabled, true, 'whitespace is not an instruction');

    await view.type(view.find('textarea'), 'make it warmer');
    assert.equal(view.findByText('button', 'Submit').disabled, false);
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
    await view.click(view.find('.checkpoint'));
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
    // §12 removed the turn-count row. The count the client holds now surfaces on
    // Export transcript, which is the control that acts on it.
    const exported = () => view.findByText('button', 'Export transcript').getAttribute('title');
    assert.match(exported(), /Save all 1 turn\b/, 'one turn before');

    await view.click(view.find('.checkpoint'));
    await view.flush();

    assert.match(view.text(), /checkpointed as turn 2/);
    assert.match(exported(), /Save all 2 turns/, 'two turns after');
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
  const css = STYLESHEET;
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

  const view = await render(h(PromptBox, { state, onSubmit: async () => null }));
  try {
    assert.ok(view.find('.status.warning'), 'a committed turn with warnings must show them');
    assert.match(view.text(), /stripped: 2 headings, 1 blockquote, 1 table/);
    assert.match(view.text(), /Committed, with warnings/, 'the turn committed — say so');
  } finally {
    await view.unmount();
  }
});

test('§2.3 a committed AI turn carries its warning and counts onto the screen', async () => {
  // The other §2.3 test renders PromptBox from a hand-built state. This one goes
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
    await view.click(view.findByText('button', 'Submit'));
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
    // §12: the Documents panel is gone. The list lives behind the document name in
    // the top row, which is also the answer to "which document am I in".
    assert.equal(count(view, '.doc-list'), 0, 'the switcher is closed until asked for');
    await view.click(view.find('.doc-name'));

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
    await view.type(view.find('.new-document-form input'), 'Track C Post');
    await view.click(view.findByText('.new-document-form button', 'Create'));
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

    // The documents that DO exist are still reachable from the top row's switcher,
    // which survives the missing-slug screen because it is the way off it.
    await view.click(view.find('.doc-name'));
    assert.deepEqual(view.findAll('.doc a').map((a) => a.textContent), ['draft']);
    await view.click(view.find('.doc-name'));

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
    await view.click(view.find('.doc-name'));
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

    await view.click(view.findByText('button', 'Show history'));

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
    const clientCount = () => view.findByText('button', 'Export transcript').getAttribute('title');
    assert.match(clientCount(), /Save all 2 turns/, 'two turns before');
    await view.click(view.findByText('button', 'Show history'));

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
    assert.match(clientCount(), /Save all 3 turns/, 'and the turn count moved — restore appended, it did not rewind');
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
    await view.click(view.findByText('button', 'Show history'));
    await view.click(view.findAll('.turn-restore')[0]); // the live turn
    await view.flush();

    assert.match(view.text(), /nothing to restore/);
    assert.doesNotMatch(view.text(), /restored turn 2 as turn/);
    assert.match(
      view.findByText('button', 'Export transcript').getAttribute('title'),
      /Save all 2 turns/,
      'the count did not move',
    );
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
    await view.click(view.findByText('button', 'Show history'));
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
    await view.click(view.findByText('button', 'Show history'));
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

  // Scoped to the SWITCHER, not to the page: the client keeps a turn count of its
  // own and a page-wide regex passes on that while the listing is still showing the
  // number it was handed at page load. That is the exact bug this test is about, so
  // the assertion has to look at the server's listing alone.
  //
  // The switcher moved into the top row in step 10 (§12) but the staleness it
  // guards against did not move with it: the listing is still fetched, still
  // carries a per-document turn count, and still goes stale without a re-fetch.
  const listedCount = () => view.find('.top-drawer .doc-meta').textContent;
  // The client's own count, from `state.history`. The two must agree.
  const clientCount = () => view.findByText('button', 'Export transcript').getAttribute('title');

  try {
    await view.click(view.find('.doc-name'));
    assert.match(listedCount(), /^1 turn$/, 'the count at load');

    await view.click(view.find('.checkpoint'));
    await view.flush();
    assert.match(listedCount(), /^2 turns$/, 'a checkpoint moved the listing');
    assert.match(clientCount(), /Save all 2 turns/, 'and the client agrees with it');

    await view.type(view.find('textarea'), 'rewrite it');
    await view.click(view.findByText('button', 'Submit'));
    await view.flush();
    assert.match(listedCount(), /^3 turns$/, 'an AI turn moved the listing');
    assert.match(clientCount(), /Save all 3 turns/);

    await view.click(view.findByText('button', 'Show history'));
    await view.click(view.findAll('.turn-restore')[2]);
    await view.flush();
    assert.match(listedCount(), /^4 turns$/, 'a restore moved the listing');
    assert.match(clientCount(), /Save all 4 turns/);

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
    await view.click(view.find('.checkpoint'));
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

// ── §12: the top row ────────────────────────────────────────────────────────────

test('§12 the top row is the five named controls, in the spec\'s order, all lilac', async () => {
  const view = await mountApp({ api: { load: async () => ({ draft: 'x\n', history: [{ turn_id: 1 }] }) } });

  try {
    const row = view.findAll('.top-row button');
    assert.deepEqual(
      row.map((b) => b.textContent.trim()),
      ['Show history', 'draft', '+ New document', 'Export transcript', 'Checkpoint'],
      'Show/hide history · document name · + New document · Export transcript · Checkpoint',
    );

    // §12: lilac = global and navigation controls, and the split is what a new
    // control inherits from. A top-row button that is not lilac has left the split.
    assert.ok(
      row.every((b) => b.classList.contains('top-button')),
      'every control in the top row wears the lilac treatment',
    );

    // Forest green is the primary action INSIDE a box, and nothing in the top row
    // may wear it — that is the other half of the same rule.
    assert.equal(count(view, '.top-row .submit'), 0);
  } finally {
    await view.unmount();
  }
});

test('§12 the document name opens the switcher and closes it again', async () => {
  const view = await mountApp();

  try {
    const name = view.find('.doc-name');
    assert.equal(name.getAttribute('aria-expanded'), 'false');
    assert.equal(count(view, '.top-drawer'), 0);

    await view.click(name);
    assert.equal(view.find('.doc-name').getAttribute('aria-expanded'), 'true');
    assert.ok(view.find('.top-drawer .doc-list'), 'the documents in this namespace');

    await view.click(view.find('.doc-name'));
    assert.equal(count(view, '.top-drawer'), 0, 'and it closes again');
  } finally {
    await view.unmount();
  }
});

test('§12 only one drawer is open at a time, and neither one overlays the draft', async () => {
  const view = await mountApp();

  try {
    await view.click(view.find('.doc-name'));
    await view.click(view.findByText('button', '+ New document'));

    assert.equal(view.findAll('.top-drawer').length, 1, 'opening one closes the other');
    assert.ok(view.find('.new-document-form'), 'and it is the one that was asked for');

    // The drawer lives in the masthead, above the workspace. It cannot cover the
    // editor because it is not in the same box as it.
    assert.ok(view.find('.masthead .top-drawer'), 'the drawer is in the header');
    assert.equal(count(view, '.workspace .top-drawer'), 0);
    assert.ok(view.find('.editor .tiptap'), 'the editor is still mounted and on screen');
    assert.equal(view.editor().isEditable, true, 'and still editable');
  } finally {
    await view.unmount();
  }
});

test('§12 Checkpoint carries the uncommitted-edits signal in the button itself', async () => {
  // The status row that used to say "Uncommitted edits: yes" is gone (§12). If the
  // button did not say it, nothing on screen would.
  const view = await mountApp({ draft: 'Something to edit.\n' });

  try {
    let button = view.find('.checkpoint');
    assert.equal(button.classList.contains('checkpoint-marked'), false, 'quiet when clean');
    assert.equal(count(view, '.dirty-dot'), 0);
    assert.equal(button.getAttribute('aria-label'), 'Checkpoint');

    // A real hand edit through the real editor, which is what sets `dirty`.
    await view.act(() => {
      view.editor().commands.insertContentAt(1, 'Typed. ');
    });
    await view.flush();

    button = view.find('.checkpoint');
    assert.equal(button.classList.contains('checkpoint-marked'), true, 'marked when hand edits are unratified');
    assert.equal(count(view, '.dirty-dot'), 1, 'the sighted half of the signal');
    assert.match(
      button.getAttribute('aria-label'),
      /uncommitted hand edits/,
      'and the half a screen reader can hear — a dot alone is not a fact',
    );

    await view.click(button);
    await view.flush();
    assert.equal(
      view.find('.checkpoint').classList.contains('checkpoint-marked'),
      false,
      'and it goes quiet once the edits are committed',
    );
  } finally {
    await view.unmount();
  }
});

// ── §4 / §12: Export transcript, which replaced the raw-JSON link ───────────────

test('§4 Export transcript saves the whole ledger as JSON', async () => {
  const view = await mountApp({
    api: { load: async () => ({ draft: 'The draft.\n', history: LEDGER }) },
  });

  try {
    await view.click(view.findByText('button', 'Export transcript'));

    assert.equal(view.saved.length, 1, 'one file, from one click');
    const { filename, data } = view.saved[0];
    assert.equal(filename, 'draft-transcript.json', 'named for the document it came from');
    assert.deepEqual(
      Object.keys(data),
      ['schema_version', 'slug', 'exported_at', 'context', 'rules', 'turns'],
      '§4 pins the wrapper shape, and nothing else may join it silently',
    );
    assert.equal(data.schema_version, SCHEMA_VERSION, 'the SAME constant the store writes');
    assert.equal(data.slug, 'draft');
    assert.match(data.exported_at, /^\d{4}-\d\d-\d\dT/, '§11 K4: when it was taken is part of the record');

    // §0.4: full snapshots, every turn, verbatim. Not a summary and not a diff —
    // diffs are computed from snapshots and never stored (§5).
    assert.deepEqual(data.turns, LEDGER, 'the ledger as it stands, turn for turn');
    assert.equal(data.turns[1].prompt, 'make it punchier', 'including the exact prompt string (§3)');
    assert.ok(
      data.turns.every((turn) => typeof turn.snapshot === 'string'),
      'and the full snapshot on every turn',
    );
    assert.ok(!('diff' in data.turns[0]), 'no stored diff');

    // It must survive JSON, since that is the file it becomes.
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
  } finally {
    await view.unmount();
  }
});

test('§4 a document with no turns has no transcript, and the control says so', async () => {
  const view = await mountApp({ api: { load: async () => ({ draft: '', history: [] }) } });

  try {
    const button = view.findByText('button', 'Export transcript');
    assert.equal(button.disabled, true, 'nothing to export');
    assert.match(button.getAttribute('title'), /No turns yet/);

    await view.click(button);
    assert.equal(view.saved.length, 0, 'and a click writes no empty file');
  } finally {
    await view.unmount();
  }
});

test('the raw-JSON link is gone: §12 removed the status row it lived in', async () => {
  const view = await mountApp();

  try {
    assert.equal(count(view, '.raw-json'), 0);
    assert.equal(count(view, '.meta'), 0, 'and the Document/Turns/Uncommitted row with it');
    assert.equal(count(view, '.library'), 0, 'and the Documents panel');
    assert.equal(count(view, '.panel'), 0);
    assert.doesNotMatch(view.text(), /raw JSON/);
    assert.doesNotMatch(view.text(), /Uncommitted edits/);
  } finally {
    await view.unmount();
  }
});

test('saveJson hands the browser a named, downloadable JSON file, then lets it go', async () => {
  // The wiring the App test stubs out. jsdom implements neither an object URL nor
  // a download, so the four things saveJson touches are injected and watched.
  const revoked = [];
  const clicked = [];
  let blobParts = null;

  class FakeBlob {
    constructor(parts, options) {
      blobParts = parts;
      this.type = options?.type;
    }
  }

  const anchors = [];
  const fakeDocument = {
    body: { appendChild: (node) => anchors.push(node) },
    createElement: () => ({
      click() {
        clicked.push({ href: this.href, download: this.download, attached: anchors.includes(this) });
      },
      remove() {},
    }),
  };

  saveJson('t.json', buildTranscript('draft', LEDGER, new Date('2026-09-03T09:00:00.000Z')), {
    document: fakeDocument,
    Blob: FakeBlob,
    URL: {
      createObjectURL: () => 'blob:fake',
      revokeObjectURL: (href) => revoked.push(href),
    },
  });

  assert.equal(clicked.length, 1, 'exactly one download');
  assert.equal(clicked[0].download, 't.json', 'with the filename asked for');
  assert.equal(clicked[0].href, 'blob:fake');
  assert.equal(clicked[0].attached, true, 'attached before the click — Firefox ignores a detached one');
  assert.deepEqual(revoked, ['blob:fake'], 'and the blob is released, not left alive for the tab');

  // §0.5 / §4: the assertion is made on THE FILE, not on the object handed to the
  // writer. `schema_version` exists so a transcript can be read by a build that
  // did not write it, and the only thing that reader ever sees is these bytes.
  const written = JSON.parse(blobParts[0]);
  assert.equal(written.schema_version, SCHEMA_VERSION, 'the exported FILE carries a schema version');
  assert.equal(written.slug, 'draft');
  assert.equal(written.exported_at, '2026-09-03T09:00:00.000Z');
  assert.deepEqual(written.turns, LEDGER, 'and the whole ledger, verbatim');
  assert.match(blobParts[0], /^\{\n  "schema_version": 1,/, 'and it is readable JSON, not one long line');
});

test('§4 a transcript carries the model\'s speech, because the note is on the turn', async () => {
  // §9's S13: the conversation has the ledger's durability guarantee because it
  // IS the ledger. An export that dropped the notes would be the side channel
  // §0.7 was written to avoid.
  const spoken = [
    LEDGER[0],
    {
      ...LEDGER[1],
      note: 'I read this as a copy edit, not a reframe.',
      segments: [{ id: 's1', took: 'a copy edit', kind: 'edit' }],
    },
  ];
  const view = await mountApp({
    api: { load: async () => ({ draft: 'The version the model made worse.\n', history: spoken }) },
  });

  try {
    await view.click(view.findByText('button', 'Export transcript'));
    const { data } = view.saved[0];

    assert.equal(data.turns[1].note, 'I read this as a copy edit, not a reframe.');
    assert.deepEqual(data.turns[1].segments, [{ id: 's1', took: 'a copy edit', kind: 'edit' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), data, 'and it survives the file it becomes');
  } finally {
    await view.unmount();
  }
});

// ── §12: the right column ───────────────────────────────────────────────────────

test('§12 the right column is three boxes, top to bottom, in the spec\'s order', async () => {
  const view = await mountApp();

  try {
    const boxes = view.findAll('.rail .box');
    assert.deepEqual(
      boxes.map((box) => box.querySelector('h2').textContent),
      ['Prompt', 'Model Response', 'Standing Rules'],
    );
    // §12: "same paper treatment". One class, three boxes — not three lookalike
    // rules that can drift apart.
    assert.equal(boxes.length, 3);
    assert.equal(count(view, '.rail > *'), 3, 'and nothing else in the column');
  } finally {
    await view.unmount();
  }
});

test('§12 a box with nothing in it yet says what it is for', async () => {
  // §4 requires that a speech-only turn "must not look like a rendering failure".
  // A box that has never been filled at all is the same hazard.
  const view = await mountApp();

  try {
    assert.match(view.find('.box-response').textContent, /nothing to say yet/, 'before any turn has spoken');
    assert.match(view.find('.box-rules').textContent, /none yet/);

    // §10's human-written half is built (step 12), so the box has an add form —
    // but no RULES until she writes one, which is what the empty state is about.
    assert.equal(count(view, '.box-rules li'), 0, 'no rules yet');
    assert.ok(view.find('.rule-add input'), 'and a way to write the first one');
  } finally {
    await view.unmount();
  }
});

test('§12 the prompt box puts + bottom-left and Submit bottom-right, in forest green', async () => {
  const view = await mountApp();

  try {
    const actions = view.findAll('.box-prompt .box-actions > button');
    assert.deepEqual(actions.map((b) => b.textContent.trim()), ['+', 'Submit'], 'left to right');
    assert.equal(actions[1].classList.contains('submit'), true, 'Submit wears the forest-green treatment');

    // F48, resolved in step 12: the `+` attaches a real file. It keeps its §12
    // position; what changed is that it now does something.
    assert.equal(actions[0].disabled, false, 'the + is live');
    assert.match(actions[0].getAttribute('title'), /§8/);
    assert.ok(view.find('.box-prompt input[type="file"]'), 'and opens a file picker');
    assert.equal(count(view, '.box-prompt .chip'), 0, 'no chips until something is attached');

    // `justify-content: space-between` is what actually puts them at the two ends;
    // jsdom applies no stylesheet, so the rule is pinned here. Extracted first, so
    // a failure prints the rule rather than the whole stylesheet — the same shape
    // as the empty-state check above, and for the same reason.
    const actionsRule = /\.box-actions \{[^}]*\}/.exec(STYLESHEET)?.[0] ?? '';
    assert.match(
      actionsRule,
      /justify-content: *space-between/,
      'the two-ends layout is a real rule, not just DOM order',
    );
  } finally {
    await view.unmount();
  }
});

// ── §12: lilac, checked for contrast against the cream ground ───────────────────

/** Relative luminance of a `#rrggbb`, per WCAG 2.x. */
function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two `#rrggbb` colours. */
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The value of a custom property declared on `:root` in the stylesheet. */
function token(name) {
  const match = STYLESHEET.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'));
  assert.ok(match, `--${name} must be declared in the stylesheet`);
  return match[1];
}

// ── §0.7 / §12: the Model Response box ─────────────────────────────────────────

test('§12 the Model Response box populates with the model\'s note, end to end', async () => {
  // Through the whole client path — submit, commit, re-render — because the
  // question is whether the speech REACHES the screen, not whether the component
  // can display one when handed it.
  const view = await mountApp({
    draft: 'The stored draft.\n',
    api: {
      aiEdit: async () => ({
        draft: 'The revision.\n',
        human_turn: null,
        ai_turn: {
          turn_id: 2,
          author: 'ai',
          prompt: 'tighten it',
          note: 'I read this as a copy edit, not a reframe. The second paragraph is untouched.',
        },
        history: [{ turn_id: 1 }, { turn_id: 2 }],
      }),
    },
  });

  try {
    assert.match(view.find('.box-response').textContent, /nothing to say yet/, 'empty before the turn');

    await view.type(view.find('textarea'), 'tighten it');
    await view.click(view.findByText('button', 'Submit'));
    await view.flush();

    const box = view.find('.box-response');
    assert.match(box.textContent, /I read this as a copy edit/, '§0.7: the model spoke and it is on screen');
    assert.doesNotMatch(box.textContent, /nothing to say yet/, 'and the empty state is gone');

    // §12: the panel never restates the draft. The model's TEXT is in the editor,
    // and the box must not be showing it as well.
    assert.doesNotMatch(box.textContent, /The revision\./, 'the panel never restates the draft');
    assert.equal(serializeEditorMarkdown(view.editor()), 'The revision.\n', 'the text landed in the draft');

    // §12's addition (chunk 11): a white surface matching the Prompt textarea.
    assert.ok(box.querySelector('.box-surface'), 'the note is on the box surface');
  } finally {
    await view.unmount();
  }
});

test('§12 the surface and the Prompt textarea are ONE rule, not two that match', () => {
  // §12 asks for matching anatomy across the three boxes. Chunk 11 asserted the
  // two rules carried the same four declarations, which could only ever catch a
  // drift after it happened. They are now a single selector list, so "matching"
  // is structural and there is nothing left to drift.
  const shared = /\.box textarea,\s*\n\.box-surface \{([^}]*)\}/.exec(STYLESHEET);
  assert.ok(shared, 'the textarea and the surface must be declared together');

  for (const declaration of [
    'background: #fff',
    'border: 1px solid var(--line)',
    'border-radius: 4px',
    'padding: 0.6rem',
    'width: 100%',
  ]) {
    assert.ok(shared[1].includes(declaration), `the shared surface rule should carry "${declaration}"`);
  }

  // And the surface wraps rather than widening the rail, which a pasted URL would
  // do, and is not a sliver when it is empty.
  // Negative lookbehind so this finds the STANDALONE rule, not the shared block
  // above, whose selector list ends `,\n.box-surface {`.
  const surfaceOnly = /(?<!,\n)^\.box-surface \{([^}]*)\}/m.exec(STYLESHEET)[1];
  assert.match(surfaceOnly, /white-space: pre-wrap/, 'the note is Markdown rendered as text');
  assert.match(surfaceOnly, /overflow-wrap: anywhere/);
  assert.match(surfaceOnly, /min-height/, 'an empty surface is still a surface, not a line');

  // The empty state is muted INSIDE the surface — the textarea's placeholder,
  // exactly. If this rule went, an empty box would render as full-strength body
  // text and read as content rather than as a placeholder.
  assert.match(/\.box-surface \.box-empty \{([^}]*)\}/.exec(STYLESHEET)[1], /color: var\(--muted\)/);
});

test('§12 all three boxes render a white content surface at first paint', async () => {
  // The rail must read as three parallel boxes before anything has happened —
  // not one form beside two captions. This is the state the screenshot in the
  // chunk-11-fix report shows.
  const view = await mountApp();

  try {
    const boxes = view.findAll('.rail .box');
    assert.equal(boxes.length, 3);

    for (const box of boxes) {
      const heading = box.querySelector('h2').textContent;
      const surface = box.querySelector('.box-surface, textarea');
      assert.ok(surface, `${heading} must have a content surface before it has content`);
    }

    // Specifically the two that had none: their anatomy is now the Prompt box's.
    assert.ok(view.find('.box-response .box-surface'), 'Model Response');
    assert.ok(view.find('.box-rules .box-surface'), 'Standing Rules');

    // And the empty-state sentence is INSIDE the surface, not standing in for it.
    for (const selector of ['.box-response', '.box-rules']) {
      const box = view.find(selector);
      const empty = box.querySelector('.box-empty');
      assert.ok(empty, `${selector} still says what it is for`);
      assert.ok(
        box.querySelector('.box-surface').contains(empty),
        `${selector}'s empty state renders inside the surface, not in place of it`,
      );
    }

    assert.match(view.find('.box-response').textContent, /nothing to say yet/);
    assert.match(view.find('.box-rules').textContent, /none yet/);
  } finally {
    await view.unmount();
  }
});

test('§12 a new prompt overwrites the response, and the pending state is not an empty box', async () => {
  const gate = deferred();
  const view = await mountApp({
    api: {
      aiEdit: async () => {
        await gate.promise;
        return okTurn('The revision.\n', {
          ai_turn: { turn_id: 2, author: 'ai', prompt: 'p', note: 'The answer.' },
        });
      },
    },
  });

  try {
    await view.type(view.find('textarea'), 'tighten it');
    await view.click(view.findByText('button', 'Submit'));

    // In flight: the box says what is happening rather than showing the state it
    // was in before the turn started, which would say nothing is.
    const pending = view.find('.box-response');
    assert.match(pending.textContent, /Waiting for the model/);
    assert.doesNotMatch(pending.textContent, /nothing to say yet/);
    // The surface does not come and go — only what is on it does (§12).
    assert.ok(pending.querySelector('.box-surface'), 'the surface is structural, not conditional');

    gate.resolve();
    await view.flush();
    assert.match(view.find('.box-response').textContent, /The answer\./);
  } finally {
    await view.unmount();
  }
});

test('§0.9 a speech-only turn shows the note and says the draft did not move', async () => {
  const view = await mountApp({
    draft: 'The biology is the reason.\n',
    api: {
      aiEdit: async () => ({
        // §0.9: the snapshot carries the prior text unchanged.
        draft: 'The biology is the reason.\n',
        human_turn: null,
        ai_turn: {
          turn_id: 2,
          author: 'ai',
          prompt: 'weigh in on the change I just made',
          note: 'You moved the claim to the front. That is the right order.',
        },
        history: [{ turn_id: 1 }, { turn_id: 2 }],
      }),
    },
  });

  try {
    await view.type(view.find('textarea'), 'weigh in on the change I just made');
    await view.click(view.findByText('button', 'Submit'));
    await view.flush();

    const box = view.find('.box-response');
    assert.match(box.textContent, /You moved the claim to the front/);
    assert.match(box.textContent, /No change to the draft/, '§0.9, stated positively');
    assert.match(box.textContent, /speech only/);

    // The turn committed and the app says so — as system reporting, in the Prompt
    // box, not in Model Response (F52).
    const notice = view.find('.box-prompt .status.notice');
    assert.ok(notice, 'the turn outcome is reported beside the control that caused it');
    assert.match(notice.textContent, /no change to the draft/);
    assert.equal(count(view, '.box-response .status'), 0, 'and no system reporting in the speech box');
    assert.equal(count(view, '.status.error'), 0, 'a speech-only turn is not a failure');

    // The draft is exactly what it was.
    assert.equal(serializeEditorMarkdown(view.editor()), 'The biology is the reason.\n');
  } finally {
    await view.unmount();
  }
});

test('§9 S12 the panel never blends speech with the system\'s own reporting', async () => {
  // Both at once: the model said something AND the response tripped a §2.3 guard.
  // They are different records and they go to different boxes (F52, kept).
  const view = await mountApp({
    api: {
      aiEdit: async () =>
        okTurn('The revision.\n', {
          ai_turn: {
            turn_id: 2,
            author: 'ai',
            prompt: 'restructure it',
            note: 'I have left the second paragraph alone; you did not ask about it.',
            warnings: ['stripped: 2 headings, 1 blockquote'],
            stripped: { heading: 2, blockquote: 1 },
          },
        }),
    },
  });

  try {
    await view.type(view.find('textarea'), 'restructure it');
    await view.click(view.findByText('button', 'Submit'));
    await view.flush();

    const response = view.find('.box-response');
    const warning = view.find('.box-prompt .status.warning');
    assert.ok(response && warning);

    assert.match(response.textContent, /left the second paragraph alone/);
    assert.doesNotMatch(response.textContent, /stripped/, 'a validation warning is not speech');
    assert.match(warning.textContent, /2 headings/);
    assert.doesNotMatch(warning.textContent, /second paragraph alone/, 'and speech is not a warning');

    // Different boxes, not merely different paragraphs.
    assert.equal(response.contains(warning), false);
    assert.equal(warning.contains(response), false);
  } finally {
    await view.unmount();
  }
});

test('a turn that spoke and said nothing is not rendered as a box that failed to load', async () => {
  // §0.7 requires a note on every turn, so an empty one is an anomaly rather than
  // a state — and §4's rule that a no-change turn must not look like a rendering
  // failure applies with more force here, not less.
  const view = await render(h(ModelResponse, { note: '' }));
  try {
    assert.match(view.text(), /the model said nothing/);
    assert.ok(view.find('.box-surface'), 'the surface stays; what is on it is the sentence');
    assert.ok(
      view.find('.box-surface').contains(view.find('.box-empty')),
      'and the sentence is on the surface, not in place of it',
    );
  } finally {
    await view.unmount();
  }

  const never = await render(h(ModelResponse, { note: null }));
  try {
    assert.match(never.text(), /nothing to say yet/, 'and "not yet" is a different sentence from "nothing"');
  } finally {
    await never.unmount();
  }
});

// ── §0.5: the capability disclosure (F51, resolved) ────────────────────────────

test('§0.5 the capability disclosure is on the surface, not behind a click', async () => {
  // F51. Chunk 10 moved this sentence into the switcher drawer; step 14 is deploy
  // and real people will hold real links, so it is back on the page. A disclosure
  // you have to go looking for does not stop anyone treating a capability URL as
  // private, which is the one thing it is for.
  const view = await mountApp();

  try {
    const disclosure = view.find('.masthead .capability');
    assert.ok(disclosure, 'visible without opening anything');
    assert.match(disclosure.textContent, /the link .*is.* the key/s);
    assert.match(disclosure.textContent, /no login/i);
    assert.match(disclosure.textContent, /read and edit/, 'and says what the link actually grants');

    // Not inside a drawer, and not in the workspace where it would compete with
    // the draft. It is a permanent part of the header.
    assert.equal(count(view, '.top-drawer .capability'), 0);
    assert.equal(count(view, '.workspace .capability'), 0);

    // One copy, not two: with the sentence on the surface, repeating it inside the
    // switcher would be noise in a menu.
    await view.click(view.find('.doc-name'));
    assert.equal(count(view, '.capability'), 1, 'still exactly one, with the switcher open');
  } finally {
    await view.unmount();
  }
});

test('§12 the rail is reachable at any scroll depth, and still overlays nothing', () => {
  // F65. jsdom applies no stylesheet and has no layout, so the two rules that
  // make this true are pinned against the source; the behaviour itself is
  // verified in a real browser and recorded in reports/chunk-11a.md.
  const railRule = /(?<!\})\n\.rail \{([^}]*)\}/.exec(STYLESHEET)[1];

  // `position: sticky` only holds an element inside its own containing block,
  // which for a grid item is its grid area. Without spanning every row, the
  // rail's area ended where the editor ended and the panel scrolled away as
  // soon as the history got long. This is the fix.
  assert.match(railRule, /position: sticky/);
  assert.match(railRule, /grid-row: 1 \/ -1/, 'the containing block must span the whole workspace');

  // A sticky element taller than the viewport pins its TOP, leaving Submit
  // unreachable at every scroll position. The cap plus internal scrolling is
  // what makes every control in the column reachable, not just the first screen.
  assert.match(railRule, /max-height: calc\(100vh/);
  assert.match(railRule, /overflow-y: auto/);

  // It stays in column 2. The chunk-08 bug was the history spanning 1 / -1 and
  // sliding UNDER the sticky rail because they shared columns; these two are
  // pinned to different columns so spanning rows cannot make them overlap.
  assert.match(railRule, /grid-column: 2/);
  assert.match(rule('.history'), /grid-column: 1/);

  // §12 forbids anything overlaying the draft. Sticky is not fixed, and the rail
  // must not have become an overlay while nobody was looking.
  assert.doesNotMatch(railRule, /position: fixed/);
  assert.doesNotMatch(railRule, /z-index/);

  // Below the breakpoint the rail is a band under the draft, not a column beside
  // it, and every one of the rules above is wrong there.
  const narrow = /@media \(max-width: 60rem\) \{\s*\n\s*\.rail \{([^}]*)\}/.exec(STYLESHEET);
  assert.ok(narrow, 'the stacked layout must unset the sticky column rules');
  assert.match(narrow[1], /position: static/);
  assert.match(narrow[1], /max-height: none/);
});

// ── §8: context chips ──────────────────────────────────────────────────────────

/** A state object shaped like the session's, with context attached. */
const withContext = (context, extra = {}) => ({
  slug: 'draft',
  history: [{ turn_id: 1 }],
  pending: null,
  locked: false,
  dirty: false,
  error: null,
  notice: null,
  warnings: [],
  stripped: null,
  note: null,
  speechOnly: false,
  busyContext: false,
  rules: [],
  context,
  ...extra,
});

test('§8 an attached file shows as a chip with its editable description', async () => {
  const described = [];
  const view = await render(
    h(PromptBox, {
      state: withContext([
        { id: 'a1', filename: 'tone-reference.md', type: 'text/markdown', kind: 'text', bytes: 419, description: 'house style — tone, not content', extraction: 'ok' },
      ]),
      onSubmit: async () => null,
      onDescribe: (id, description) => described.push([id, description]),
    }),
  );

  try {
    const chip = view.find('.chip');
    assert.ok(chip, 'the file is on screen');
    assert.match(chip.textContent, /tone-reference\.md/);
    assert.ok(chip.classList.contains('chip-text'));

    // §8 C2: freeform and editable IN PLACE, not a dropdown and not read-only.
    const description = chip.querySelector('.chip-description');
    assert.equal(description.value, 'house style — tone, not content');
    await view.type(description, 'actually: source material');
    assert.deepEqual(described.at(-1), ['a1', 'actually: source material']);
  } finally {
    await view.unmount();
  }
});

test('§8 C3 extraction failure surfaces ON THE CHIP', async () => {
  // §8 is explicit: extraction failure is never a silent degradation to an unread
  // attachment. The file is kept — she may still want it — and the chip says so.
  const view = await render(
    h(PromptBox, {
      state: withContext([
        { id: 'b1', filename: 'truncated.png', type: 'image/png', kind: 'image', bytes: 900, description: '', extraction: 'failed', extraction_error: 'the bytes are not a valid PNG' },
      ]),
      onSubmit: async () => null,
    }),
  );

  try {
    const chip = view.find('.chip');
    assert.ok(chip.classList.contains('chip-failed'));
    assert.match(chip.querySelector('.chip-error').textContent, /not a valid PNG/);
    assert.match(chip.textContent, /truncated\.png/, 'and the file is still listed');
  } finally {
    await view.unmount();
  }
});

test('§8 C5 discard is available individually AND wholesale', async () => {
  const removed = [];
  let cleared = 0;
  const view = await render(
    h(PromptBox, {
      state: withContext([
        { id: 'a1', filename: 'one.md', type: 'text/markdown', kind: 'text', bytes: 10, description: '', extraction: 'ok' },
        { id: 'a2', filename: 'two.png', type: 'image/png', kind: 'image', bytes: 20, description: '', extraction: 'ok' },
      ]),
      onSubmit: async () => null,
      onRemove: (id) => removed.push(id),
      onClearContext: () => { cleared += 1; },
    }),
  );

  try {
    assert.equal(view.findAll('.chip').length, 2);
    await view.click(view.findAll('.chip-remove')[0]);
    assert.deepEqual(removed, ['a1'], 'one at a time');

    // Wholesale is a FIRST-CLASS operation, not a hidden one: two of the three
    // records the spec came from destroy context on purpose.
    const clear = view.find('.chip-clear');
    assert.match(clear.textContent, /Discard all 2 context files/);
    await view.click(clear);
    assert.equal(cleared, 1);
  } finally {
    await view.unmount();
  }
});

test('§8 C2a the description is seeded from the prompt where she said it inline', () => {
  assert.match(
    seedDescription('Look to these for length and tone, not content. Tighten the second paragraph.'),
    /^Look to these for length and tone, not content\.$/,
  );
  assert.match(
    seedDescription("For color, here's what they said in the thread. Work it in."),
    /For color, here's what they said/,
  );
  assert.match(seedDescription('Attached is the style guide.'), /Attached is the style guide/);

  // No inline statement: the first sentence is the best available guess, and being
  // wrong costs her one edit. A blank field is the thing to avoid (§8 C2a).
  assert.equal(seedDescription(''), '');
  assert.match(seedDescription('Tighten the second paragraph.'), /Tighten the second paragraph/);
});

test('§0.10 the editor stays live while context is being written', async () => {
  // `busyContext` is a different flag from `pending` on purpose. Locking the
  // editor because a screenshot is uploading would be §0.10's failure in
  // miniature: treating "she gave me a file" as "she asked for an edit".
  const view = await mountApp();
  try {
    assert.equal(view.editor().isEditable, true);
    assert.equal(count(view, '.lock-veil'), 0, 'no read-only veil for a context write');
  } finally {
    await view.unmount();
  }
});

// ── §10: the Standing Rules box ────────────────────────────────────────────────

test('§10 rules render as an editable list, individually revocable', async () => {
  const removed = [];
  const updated = [];
  const view = await render(
    h(StandingRules, {
      state: {
        busyContext: false,
        rules: [
          { id: 'r1', text: 'no em-dashes', scope: 'this document', source: 'human' },
          { id: 'r2', text: 'open on the biology, not the pipeline', scope: 'openings', source: 'human' },
        ],
      },
      onRemove: (id) => removed.push(id),
      onUpdate: (id, patch) => updated.push([id, patch]),
    }),
  );

  try {
    assert.equal(view.findAll('.rule').length, 2);
    // The text lives in an input's value, not its textContent — it is editable in
    // place, which is the point.
    assert.deepEqual(
      view.findAll('.rule-text').map((input) => input.value),
      ['no em-dashes', 'open on the biology, not the pipeline'],
    );

    // Editable in place: a rule you cannot edit is one you delete and retype.
    await view.type(view.findAll('.rule-text')[0], 'no em-dashes anywhere');
    assert.deepEqual(updated.at(-1), ['r1', { text: 'no em-dashes anywhere' }]);

    await view.click(view.findAll('.rule-remove')[1]);
    assert.deepEqual(removed, ['r2'], 'individually revocable');

    // Said out loud, because §0.10's separation is invisible unless stated.
    assert.match(view.text(), /Editing them never runs one/);
  } finally {
    await view.unmount();
  }
});

test('§10 a rule can be added, and the field clears only on success', async () => {
  const added = [];
  let succeed = false;
  const view = await render(
    h(StandingRules, {
      state: { busyContext: false, rules: [] },
      onAdd: (text) => { added.push(text); return succeed; },
    }),
  );

  try {
    const field = view.find('.rule-add input');
    await view.type(field, 'no em-dashes');
    await view.click(view.find('.rule-submit'));
    assert.deepEqual(added, ['no em-dashes']);
    assert.equal(view.find('.rule-add input').value, 'no em-dashes', 'a failed write keeps what she typed');

    succeed = true;
    await view.click(view.find('.rule-submit'));
    assert.equal(view.find('.rule-add input').value, '', 'and a successful one clears it');
  } finally {
    await view.unmount();
  }
});

test('§10 step 16 is an addition: a proposed rule needs no second list', async () => {
  // The store carries `source` already, so a model-proposed rule renders in the
  // same list with its own treatment. This is what "an addition, not a migration"
  // has to mean at the UI layer too.
  const view = await render(
    h(StandingRules, {
      state: {
        busyContext: false,
        rules: [
          { id: 'r1', text: 'no em-dashes', source: 'human' },
          { id: 'p1', text: 'open on the finding', source: 'proposed' },
        ],
      },
    }),
  );

  try {
    assert.equal(view.findAll('.rule').length, 2, 'one list');
    assert.ok(view.find('.rule-human'), 'and the source is on the element');
    assert.ok(view.find('.rule-proposed'));
    assert.match(rule('.rule-proposed'), /border-left/, 'with a treatment ready for it');
  } finally {
    await view.unmount();
  }
});

test('§12 lilac is checked for contrast against the cream ground, not eyeballed', () => {
  const paper = token('paper');
  const ink = token('ink');
  const lilac = token('lilac');
  const edge = token('lilac-edge');
  const deep = token('lilac-deep');

  // The label on every top-row button. WCAG AA text.
  assert.ok(
    contrast(ink, lilac) >= 4.5,
    `ink on lilac is ${contrast(ink, lilac).toFixed(2)}:1, below the 4.5:1 AA text minimum`,
  );

  // The fill alone does NOT separate the button from the page — this is the whole
  // reason the border exists, and it is asserted so nobody "simplifies" it away.
  assert.ok(
    contrast(lilac, paper) < 3,
    'if the lilac fill ever clears 3:1 against the paper on its own, the border is no longer load-bearing and this test should be revisited',
  );
  assert.ok(
    contrast(edge, paper) >= 3,
    `the button edge is ${contrast(edge, paper).toFixed(2)}:1 against the paper, below the 3:1 WCAG 1.4.11 minimum for a control boundary`,
  );

  // The dirty marker on Checkpoint, against the button it sits on.
  assert.ok(
    contrast(deep, lilac) >= 3,
    `the dirty marker is ${contrast(deep, lilac).toFixed(2)}:1 on lilac, below 3:1`,
  );

  // Forest green keeps its half of the split.
  assert.ok(contrast('#ffffff', token('accent')) >= 4.5, 'white on forest green');
});
