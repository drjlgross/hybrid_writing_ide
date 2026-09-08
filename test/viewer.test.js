/**
 * The export viewer at /view (CLAUDE.md § The export viewer, §4), chunk 14.
 *
 * Three groups, and the division is deliberate:
 *
 *   1. ROUTING — hermetic, and it does not touch the filesystem. `/view` must not
 *      collide with `/t/{token}/{slug}` or with the API, and that has to be
 *      checkable in a fresh clone where `client/dist` does not exist. F89 is the
 *      standing reminder: a route whose test only runs in a built tree is a route
 *      nobody tests in CI, because CI runs `npm test` before `npm run build`.
 *
 *   2. READING THE BYTES — `readExport` against real exported text, and against
 *      every way a file can fail to be one. §4: "the only thing a later reader
 *      ever sees is those bytes."
 *
 *   3. THE PAGE — the Viewer rendered in jsdom, fed the bytes `buildTranscript`
 *      actually produces. Writer → JSON.stringify → reader → DOM, so the two ends
 *      of the export format are tested against each other rather than against a
 *      fixture someone hand-wrote to match.
 *
 * No network, no key, no browser. The file the viewer reads is a stub object with
 * a `text()` method, which is the whole of what the real code uses.
 */

// Before anything that reaches react-dom. See test/helpers/dom.js.
import './helpers/dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DEFAULT_TOKEN, isClientPath, isViewerAddress, VIEWER_ADDRESS } from '../src/addressing.js';
import { SCHEMA_VERSION } from '../src/schema.js';
import { createServer } from '../src/server.js';
import { indexById, readExport } from '../client/src/export-schema.js';
import { buildTranscript } from '../client/src/transcript.js';
import { Viewer } from '../client/src/Viewer.js';
import { h } from '../client/src/h.js';
import { createEditor } from './helpers/headless-editor.js';
import { render } from './helpers/render.js';

const count = (view, selector) => view.findAll(selector).length;

// ── a real session, in the shape §3 gives a turn ──────────────────────────────
//
// Written out rather than generated: every field here is one the viewer has to
// render, and a generated ledger would drift with whatever generated it.

const LEDGER = [
  {
    turn_id: 1,
    author: 'human',
    timestamp: '2026-09-07T09:00:00.000Z',
    snapshot: 'The opening line settles into place.\n',
  },
  {
    turn_id: 2,
    author: 'ai',
    timestamp: '2026-09-07T09:04:00.000Z',
    prompt: 'tighten this, and tell me what it is arguing',
    note: 'It is arguing that the record is the product. I tightened the first line only.',
    segments: [
      { id: 's1', took: 'tighten the opening line', kind: 'edit' },
      { id: 's2', took: 'what is this draft arguing?', kind: 'question' },
    ],
    context_ref: ['ctx-1', 'ctx-gone'],
    rules_ref: ['rule-1'],
    warnings: ['a heading was stripped from the response'],
    stripped: { heading: 1 },
    snapshot: 'The opening line settles.\n',
  },
  {
    turn_id: 3,
    author: 'ai',
    timestamp: '2026-09-07T09:11:00.000Z',
    prompt: 'weigh in on the change I just made — do not touch the draft',
    note: 'Shorter is right. Leave it.',
    segments: [],
    context_ref: [],
    rules_ref: [],
    // §0.9: the unchanged snapshot is a positive assertion that nothing moved.
    snapshot: 'The opening line settles.\n',
  },
];

const CONTEXT = [
  {
    id: 'ctx-1',
    filename: 'tone-reference.md',
    type: 'text/markdown',
    kind: 'text',
    bytes: 412,
    description: 'look to this for length and tone, not content',
    added_at: '2026-09-07T08:58:00.000Z',
    extraction: 'ok',
  },
];

const RULES = [{ id: 'rule-1', text: 'no em-dashes', scope: 'the whole document', source: 'human' }];

/** The bytes an export actually is: the writer's own output, stringified. */
function exportBytes({ turns = LEDGER, context = CONTEXT, rules = RULES, slug = 'draft' } = {}) {
  return JSON.stringify(
    buildTranscript(slug, turns, new Date('2026-09-07T09:20:00.000Z'), { context, rules }),
    null,
    2,
  );
}

/** A stand-in for a `File` — `name` and `text()` are all the viewer uses. */
const fileOf = (text, name = 'draft-transcript.json') => ({
  name,
  text: async () => text,
});

/** Mount the viewer with no network and a file it can read. */
async function mountViewer({ version = '0.1.1' } = {}) {
  const view = await render(
    h(Viewer, {
      createApi: () => ({ health: async () => ({ status: 'ok', version }) }),
      readFile: (file) => file.text(),
      // A real TipTap editor in jsdom, built from the same `buildExtensions()`
      // the round-trip tests run against, and read-only exactly as the page
      // builds it. The helper creates it against a detached element, so its DOM
      // is moved under the mount point to make the tree real.
      createEditor: (element, markdown) => {
        const instance = createEditor(markdown);
        instance.setEditable(false);
        element.appendChild(instance.view.dom);
        return instance;
      },
    }),
  );
  await view.flush();

  return {
    ...view,
    /** Drop a file on the page, the way a person does. */
    async drop(file) {
      await view.act(async () => {
        view.find('.viewer').dispatchEvent(
          Object.assign(new globalThis.window.Event('drop', { bubbles: true }), {
            dataTransfer: { files: [file] },
            preventDefault() {},
          }),
        );
      });
      await view.flush();
    },
  };
}

// ── 1. routing ────────────────────────────────────────────────────────────────

test('/view is the viewer, and nothing that merely looks like it is', () => {
  for (const path of ['/view', '/view/']) {
    assert.equal(isViewerAddress(path), true, `${path} is the viewer`);
  }

  // The near misses. `/viewer` is a different word; `/view/x` is a sub-path this
  // page does not have; the rest are things a URL bar produces by accident.
  for (const path of ['/viewer', '/view/x', '/views', '/VIEW', '/', '', null, undefined, '/api/view']) {
    assert.equal(isViewerAddress(path), false, `${JSON.stringify(path)} is not the viewer`);
  }

  assert.equal(VIEWER_ADDRESS, '/view', 'the address is what the spec says it is');
});

test('/view cannot collide with a document address or with the API', () => {
  // The collision requirement, checkable with no build and no server. Both kinds
  // of client path are served the same bundle; nothing else is.
  assert.equal(isClientPath(VIEWER_ADDRESS), true);
  assert.equal(isClientPath(`/t/${DEFAULT_TOKEN}/draft`), true);
  assert.equal(isClientPath(`/t/${DEFAULT_TOKEN}`), true);

  // Loose on the token ON PURPOSE: an unparseable token still gets the bundle so
  // the client can explain the link (§0.5 — rejected, never repaired).
  assert.equal(isClientPath('/t/not-a-token/draft'), true);

  // `/` joined this list in chunk 15 — it is the landing page now, and it is a
  // client path like the other two. It is asserted in test/claims.test.js.

  // Everything the client must NOT be handed.
  for (const path of [
    `/api/t/${DEFAULT_TOKEN}/documents/draft`,
    '/api/t/x/library',
    '/health',
    '/assets/index-abc.js',
    '/viewer',
    `/t/${DEFAULT_TOKEN}/draft/extra`,
  ]) {
    assert.equal(isClientPath(path), false, `${path} is not a client path`);
  }

  // And the structural claim, stated as a test rather than only as a comment: no
  // document address can ever BE the viewer address.
  assert.equal(isViewerAddress(`/t/${DEFAULT_TOKEN}/draft`), false);
  assert.equal(isClientPath('/view') && isViewerAddress('/view'), true);
});

test('the server serves /view the same bundle it serves a document', async (t) => {
  // The one build-dependent assertion in this file. CI runs `npm test` before
  // `npm run build`, so in CI there is no client/dist and this skips VISIBLY —
  // the routing claim above is what runs everywhere, and it is the one that
  // matters. Skipping loudly beats a conditional that silently asserts nothing.
  const built = existsSync(fileURLToPath(new URL('../client/dist/index.html', import.meta.url)));
  if (!built) {
    t.skip('client/dist is not built; the hermetic routing tests above cover the requirement');
    return;
  }

  const app = createServer({
    root: fileURLToPath(new URL('../.tmp-test/', import.meta.url)),
    // Never called: nothing on this page prompts a model. Supplied because
    // createServer refuses to exist without one, which is the right refusal.
    callModel: async () => {
      throw new Error('the viewer must not reach the model');
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const viewer = await fetch(`${base}/view`);
    assert.equal(viewer.status, 200, '/view is served');

    const html = await viewer.text();
    assert.match(html, /<title>WordWright<\/title>/, 'it is the app shell');

    // The SAME bytes as a document address: one bundle, two pages, and the page
    // is chosen in the client from the pathname.
    const document = await fetch(`${base}/t/${DEFAULT_TOKEN}/draft`);
    assert.equal(await document.text(), html, 'one bundle serves both addresses');

    // And it did not swallow anything: /health is still JSON, not the shell.
    const health = await fetch(`${base}/health`);
    assert.equal(health.headers.get('content-type')?.includes('json'), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ── 2. reading the bytes ──────────────────────────────────────────────────────

test('a transcript this app wrote is a transcript this app reads', () => {
  const result = readExport(exportBytes());

  assert.equal(result.ok, true, result.ok ? '' : result.error);
  assert.equal(result.transcript.schema_version, SCHEMA_VERSION);
  assert.equal(result.transcript.turns.length, 3);
  assert.equal(result.transcript.slug, 'draft');
  assert.equal(result.transcript.context[0].id, 'ctx-1');
  assert.equal(result.transcript.rules[0].text, 'no em-dashes');
});

test('every way a file fails to be an export is named, not thrown', () => {
  // Each case: the bytes, and what the sentence must tell the reader. A viewer
  // whose failure mode is an exception has a blank page as its failure mode.
  const cases = [
    ['', /empty/],
    ['   ', /empty/],
    ['{ not json', /not valid JSON/],
    ['[]', /a list/],
    ['null', /schema_version/],
    ['"a string"', /schema_version|JSON object/],
    ['{"turns": []}', /no "schema_version"/],
    [`{"schema_version": 2, "turns": []}`, /understands 1/],
    [`{"schema_version": "1", "turns": []}`, /"1"/],
    [`{"schema_version": ${SCHEMA_VERSION}}`, /no "turns" list/],
    [`{"schema_version": ${SCHEMA_VERSION}, "turns": {}}`, /no "turns" list/],
  ];

  for (const [bytes, expected] of cases) {
    const result = readExport(bytes, 'thing.json');
    assert.equal(result.ok, false, `${JSON.stringify(bytes)} must be refused`);
    assert.match(result.error, expected, `the message for ${JSON.stringify(bytes)}`);
    assert.match(result.error, /thing\.json/, 'and it names the file the visitor chose');
  }
});

test('a newer schema is refused whole, never read in part', () => {
  // The rule this encodes: a file from a later version may carry fields this
  // reader would drop, and showing a record with pieces missing is worse than
  // not showing it. So the refusal is not "unknown version, best effort".
  const future = readExport(`{"schema_version": 99, "turns": [{"turn_id": 1}]}`);

  assert.equal(future.ok, false);
  assert.match(future.error, /99/, 'it says what the file claims to be');
  assert.match(future.error, new RegExp(`understands ${SCHEMA_VERSION}`), 'and what it can read');
  assert.doesNotMatch(future.error, /upgrade|try again/i, 'and does not promise a fix it cannot make');
});

test('ids resolve through a Map, so a file cannot smuggle a prototype key', () => {
  const table = indexById([{ id: 'a', filename: 'one.md' }, { id: '__proto__' }, { nope: 1 }, 'x']);

  assert.equal(table.get('a').filename, 'one.md');
  assert.equal(table.get('constructor'), undefined, 'an object literal would answer this');
  assert.equal(table.get('toString'), undefined);
  assert.equal(table.size, 2, 'rows without a string id are not indexed');
  assert.equal(indexById(undefined).size, 0, 'a missing table is an empty one, not a crash');
});

// ── 3. the page ───────────────────────────────────────────────────────────────

test('before a file is opened, the page says what it is and that nothing is uploaded', async () => {
  const view = await mountViewer();

  try {
    assert.match(view.text(), /WordWright/, 'the lockup');
    assert.match(view.text(), /Read the History/, 'and what this page is');

    // The claim a visitor cannot verify for themselves, said first.
    assert.match(view.text(), /is uploaded|read inside your own browser/);
    assert.match(view.text(), /nothing is stored/);

    assert.ok(view.find('input[type="file"]'), 'a file-open control');
    assert.match(view.text(), /drop the file anywhere on this page/);

    // The footer, exactly as the app wears it (§ Versioning).
    assert.match(view.find('.colophon').textContent, /WordWright v0\.1\.1/);

    // Nothing that could change anything.
    assert.equal(count(view, '.editor'), 0, 'no editor');
    assert.equal(count(view, '.rail'), 0, 'no AI panel');
    assert.equal(count(view, '.top-row'), 0, 'no top row — no Checkpoint, no Export');
    assert.equal(count(view, '.turn'), 0, 'and no turns until a file is opened');
  } finally {
    await view.unmount();
  }
});

test('a real export, dropped on the page, renders end to end', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));

    // Every turn, from the file's own snapshots.
    assert.equal(count(view, '.turn'), 3, 'three turns');
    assert.deepEqual(
      view.findAll('.turn-id').map((node) => node.textContent),
      ['Turn 3', 'Turn 2', 'Turn 1'],
      'newest first, as §4 renders a timeline',
    );

    // Author badges, and the instruction as provenance.
    assert.deepEqual(
      view.findAll('.badge').map((node) => node.textContent),
      ['AI', 'AI', 'Human'],
    );
    assert.match(view.text(), /tighten this, and tell me what it is arguing/);

    // The DIFF, computed here from the two snapshots. Nothing in the file carries
    // one (§0.4, §5), so this is the client doing the work.
    const del = view.findAll('.turn del').map((node) => node.textContent);
    const ins = view.findAll('.turn ins').map((node) => node.textContent);
    assert.ok(del.some((text) => /into place/.test(text)), `a deletion is marked: ${del}`);
    assert.ok(ins.length + del.length > 0, 'the turn-2 diff rendered');

    // Speech, in its own record, not blended with the change (§0.7, §9 S12).
    const speech = view.findAll('.turn-speech').map((node) => node.textContent);
    assert.ok(speech.some((text) => /the record is the product/.test(text)));
    assert.equal(count(view, '.turn-speech .diff'), 0, 'and never inside the diff');

    // §0.9's speech-only turn: a note plus an explicit no-change marker.
    assert.match(view.text(), /Shorter is right\. Leave it\./);
    assert.match(view.text(), /No change to the draft/);

    // What the system reported about the turn — §2.3, and not speech.
    assert.match(view.find('.turn-reported').textContent, /heading was stripped/);

    // The export's own metadata, so the reader knows what they are holding.
    assert.match(view.find('.viewer-about').textContent, /draft/);
    assert.match(view.find('.viewer-about').textContent, /3 turns/);
  } finally {
    await view.unmount();
  }
});

test('the Current Draft is the last turn\'s snapshot, rendered above the history', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));

    const card = view.find('.draft-card');
    assert.ok(card, 'the card is there');
    assert.match(card.textContent, /Current Draft/, 'and it says what it is');

    // §0.3: the LAST turn's snapshot is the draft at export. Not the first, not a
    // reconstruction — turn 3's text, which differs from turn 1's.
    const rendered = view.find('.draft-render').textContent;
    assert.match(rendered, /The opening line settles\./);
    assert.doesNotMatch(rendered, /into place/, 'turn 1 is not what the draft ended as');

    // Above the history, because the bottom line goes up front.
    const main = view.find('.viewer-loaded');
    const order = [...main.children].map((node) => node.className);
    assert.ok(
      order.findIndex((c) => c.includes('draft-card')) <
        order.findIndex((c) => c.includes('history')),
      `the draft comes before the history: ${order.join(' | ')}`,
    );

    // Rendered, not raw: the app's own TipTap renderer, so the dialect's marks
    // are marks rather than asterisks a reader has to decode.
    assert.equal(view.findAll('.draft-render .tiptap').length, 1);

    // And it takes no caret. Read-only here is the document being uneditable,
    // not a control being disabled.
    assert.equal(
      view.find('.draft-render .tiptap').getAttribute('contenteditable'),
      'false',
      'the draft cannot be typed into',
    );
  } finally {
    await view.unmount();
  }
});

test('the Current Draft renders the dialect as marks, not as Markdown source', async () => {
  const view = await mountViewer();

  try {
    const draft =
      'A **bold** claim and an *aside*, with [the docs](https://example.com/docs).\n\n- one\n- two\n';
    await view.drop(
      fileOf(
        exportBytes({
          turns: [{ turn_id: 1, author: 'human', timestamp: '2026-09-07T09:00:00.000Z', snapshot: draft }],
        }),
      ),
    );

    const card = view.find('.draft-render');
    assert.equal(card.querySelectorAll('strong').length, 1, 'bold is bold');
    assert.equal(card.querySelectorAll('em').length, 1, 'italic is italic');
    assert.equal(card.querySelectorAll('li').length, 2, 'the bullets are a list');

    const link = card.querySelector('a');
    assert.equal(link.getAttribute('href'), 'https://example.com/docs');

    // The source markers are gone from the text, which is the whole point of
    // "a clean render".
    assert.doesNotMatch(card.textContent, /\*\*/);
    assert.doesNotMatch(card.textContent, /\]\(https/);
  } finally {
    await view.unmount();
  }
});

test('a session that ended with an empty draft says so, and does not look broken', async () => {
  const view = await mountViewer();

  try {
    await view.drop(
      fileOf(
        exportBytes({
          turns: [{ turn_id: 1, author: 'human', timestamp: '2026-09-07T09:00:00.000Z', snapshot: '' }],
        }),
      ),
    );

    assert.match(view.find('.draft-card').textContent, /empty at the end of this session/);
    assert.equal(count(view, '.viewer-error'), 0, 'an empty draft is not an error');
  } finally {
    await view.unmount();
  }
});

test('segments and refs resolve against the export, and an unresolved id is shown', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));

    const provenance = view.find('.turn-provenance').textContent;

    // §2.2's decomposition: what the model took the prompt to be asking. In a
    // transcript this is the only account of it.
    assert.match(provenance, /tighten the opening line/);
    assert.match(provenance, /what is this draft arguing\?/);
    assert.deepEqual(
      view.findAll('.segment-kind').map((node) => node.textContent),
      ['edit', 'question'],
    );

    // §3's context_ref, resolved through the export's own table (§4) — filename
    // and the human's description, which is metadata and never file bytes (§0.5).
    assert.match(provenance, /tone-reference\.md/);
    assert.match(provenance, /look to this for length and tone/);

    // An id the export did not carry is SHOWN. A turn that cited something the
    // file does not have must not render as though it cited nothing.
    assert.match(provenance, /ctx-gone/);
    assert.match(provenance, /not in this export/);

    // §0.11: a rule without its scope is a different rule.
    assert.match(provenance, /no em-dashes/);
    assert.match(provenance, /scope: the whole document/);
  } finally {
    await view.unmount();
  }
});

test('the viewer is read-only: no Restore, on any turn, ever', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));

    assert.equal(count(view, '.turn'), 3, 'the turns are there');
    assert.equal(count(view, '.turn-restore'), 0, 'and not one Restore control');
    assert.doesNotMatch(view.text(), /Restore to This Turn/);

    // The read-only snapshot view survives, because reading is the whole point.
    await view.click(view.findByText('button', 'Open Turn 1 Read-Only'));
    assert.match(view.find('.snapshot-text').textContent, /settles into place/);
  } finally {
    await view.unmount();
  }
});

test('the last turn is not called "the live draft" — in a transcript there is none', async () => {
  // Found in the browser, not here, and then pinned. The app marks the newest turn
  // "the live draft" because it IS the text on screen. Opened at /view that is
  // simply false: the session may be over, or on someone else's machine. The
  // marker stays — which turn ends the session is worth knowing either way — and
  // says something true instead.
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));

    const marker = view.find('.turn-current');
    assert.ok(marker, 'the newest turn is still marked');
    assert.match(marker.textContent, /where the draft stood at export/);
    assert.doesNotMatch(view.text(), /the live draft/, 'nothing here claims a live draft');
  } finally {
    await view.unmount();
  }
});

test('a file that is not an export shows a calm error, and no blank page', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf('{ oh no', 'notes.json'));

    const error = view.find('.viewer-error');
    assert.ok(error, 'the error is on the page, not in the console');
    assert.equal(error.getAttribute('role'), 'alert');
    assert.match(error.textContent, /not valid JSON/);
    assert.match(error.textContent, /notes\.json/, 'it names the file');
    assert.match(error.textContent, /Nothing was sent anywhere/, 'and reassures');

    assert.equal(count(view, '.turn'), 0, 'nothing is rendered from a file that failed');
    assert.ok(view.find('input[type="file"]'), 'and the way to try again is still there');
  } finally {
    await view.unmount();
  }
});

test('a second file replaces the first — no stale error, no stale transcript', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes()));
    assert.equal(count(view, '.turn'), 3);

    await view.drop(fileOf('nonsense', 'broken.json'));
    assert.equal(count(view, '.turn'), 0, 'the previous transcript is gone');
    assert.ok(view.find('.viewer-error'), 'and the failure is shown');

    await view.drop(fileOf(exportBytes({ turns: [LEDGER[0]] })));
    assert.equal(count(view, '.viewer-error'), 0, 'the stale error is gone');
    assert.equal(count(view, '.turn'), 1, 'and the new file is what is shown');
  } finally {
    await view.unmount();
  }
});

test('an export with no turns says so, rather than looking like a failure', async () => {
  const view = await mountViewer();

  try {
    await view.drop(fileOf(exportBytes({ turns: [], context: [], rules: [] })));

    assert.equal(count(view, '.viewer-error'), 0, 'an empty session is not an error');
    assert.match(view.text(), /This session recorded no turns/);
    assert.match(view.find('.viewer-about').textContent, /0 turns/);
    // No turns, no draft: there is no snapshot to show, and a "Current Draft"
    // heading over nothing would be worse than its absence.
    assert.equal(count(view, '.draft-card'), 0);
  } finally {
    await view.unmount();
  }
});

test('the viewer makes exactly one network call, and it carries nothing', async () => {
  // The privacy claim, as a test rather than a comment: the page's only fetch is
  // the version in the footer. If an upload ever appears, this fails.
  const calls = [];
  const view = await render(
    h(Viewer, {
      createApi: (options) => {
        calls.push(options);
        return { health: async () => ({ status: 'ok', version: '0.1.1' }) };
      },
      readFile: (file) => file.text(),
    }),
  );
  await view.flush();

  try {
    await view.act(async () => {
      view.find('.viewer').dispatchEvent(
        Object.assign(new globalThis.window.Event('drop', { bubbles: true }), {
          dataTransfer: { files: [fileOf(exportBytes())] },
          preventDefault() {},
        }),
      );
    });
    await view.flush();

    assert.equal(count(view, '.turn'), 3, 'the file was read');
    assert.equal(calls.length, 1, 'and reading it added no call of any kind');
    // No real token was involved: `health()` is the one call outside the
    // namespace base, which is why this page works for someone holding no link.
    assert.notEqual(calls[0].token, DEFAULT_TOKEN);
  } finally {
    await view.unmount();
  }
});
