/**
 * The history view (CLAUDE.md §4, §9 step 8), rendered headlessly.
 *
 * These test the component in isolation — a plain `history` array in, DOM out, no
 * session and no api. The end-to-end path (toggle, restore, the editor showing the
 * restored text, the turn count moving) lives in components.test.js, where the app
 * is mounted around a real TipTap editor.
 *
 * What is actually at stake here:
 *
 *   - The diff must come from the SNAPSHOTS, at display time. A turn that carried a
 *     stored diff would be a second copy of the same fact, free to drift (§0.4).
 *   - Model speech and model edits must not blend. A stripped table renders in the
 *     diff as run-together prose, so if the warning about it sits inside the diff
 *     the reader has no way to tell the report from the text (§2.3).
 *   - A snapshot must not be mistakable for the live draft (§4).
 */

// Before anything that reaches react-dom. See test/helpers/dom.js.
import './helpers/dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { History } from '../client/src/History.js';
import { h } from '../client/src/h.js';
import { render } from './helpers/render.js';

const CSS = readFileSync(fileURLToPath(new URL('../client/src/styles.css', import.meta.url)), 'utf8');

/** A rule body from the stylesheet, for the pins jsdom cannot check. */
const rule = (selector) =>
  new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`).exec(CSS)?.[0] ?? '';

const human = (id, snapshot, extra = {}) => ({
  turn_id: id,
  author: 'human',
  timestamp: `2026-08-2${id}T10:00:00.000Z`,
  snapshot,
  ...extra,
});

const ai = (id, snapshot, prompt, extra = {}) => ({
  turn_id: id,
  author: 'ai',
  timestamp: `2026-08-2${id}T10:05:00.000Z`,
  prompt,
  snapshot,
  ...extra,
});

/** The three-turn session most of these run against. */
const SESSION = [
  human(1, 'The opening line carries some weight.\n'),
  ai(2, 'The opening line settles quietly.\n', 'make the opening calmer'),
  // A hand edit on top of the AI output that both cuts a word and adds several, so
  // the diff exercises insertions and deletions rather than only one of them.
  human(3, 'The line settles, quietly, into place.\n'),
];

const mount = (props = {}) =>
  render(h(History, { history: SESSION, onRestore: () => {}, ...props }));

// ── §4: the turn log ────────────────────────────────────────────────────────────

test('§4 every turn is listed, newest first, with id, author and timestamp', async () => {
  const view = await mount();

  try {
    const turns = view.findAll('.turn');
    assert.equal(turns.length, 3, 'every turn in the ledger gets an entry');

    assert.deepEqual(
      view.findAll('.turn-id').map((node) => node.textContent),
      ['Turn 3', 'Turn 2', 'Turn 1'],
      'newest first',
    );
    assert.deepEqual(
      view.findAll('.badge').map((node) => node.textContent),
      ['Human', 'AI', 'Human'],
      'each entry names its author, and the badge is text — not colour alone',
    );

    // A machine-readable timestamp beside the human-readable one, so the exact
    // instant survives whatever the locale does to the display string.
    assert.deepEqual(
      view.findAll('time').map((node) => node.getAttribute('datetime')),
      [
        '2026-08-23T10:00:00.000Z',
        '2026-08-22T10:05:00.000Z',
        '2026-08-21T10:00:00.000Z',
      ],
    );
  } finally {
    await view.unmount();
  }
});

test('§3/§4 an AI turn shows its exact prompt; a human turn shows none', async () => {
  const view = await mount();

  try {
    const prompts = view.findAll('.turn-prompt');
    assert.equal(prompts.length, 1, 'exactly one of these three turns carries an instruction');
    assert.match(prompts[0].textContent, /make the opening calmer/);

    // And it is on the AI turn, not floating loose in the list.
    const aiTurn = view.findAll('.turn')[1];
    assert.ok(aiTurn.querySelector('.turn-prompt'), 'the prompt belongs to the turn it caused');
    assert.equal(view.findAll('.turn')[0].querySelector('.turn-prompt'), null, 'human turns have no prompt');
  } finally {
    await view.unmount();
  }
});

test('the prompt is shown byte-for-byte, not trimmed or tidied', async () => {
  // §3 stores the exact prompt string. A view that trims it is quietly editing the
  // provenance record.
  const exact = '  Tighten §2 — keep the "quotes" and the  double  spaces.  ';
  const view = await mount({ history: [human(1, 'a\n'), ai(2, 'b\n', exact)] });

  try {
    assert.equal(view.find('.prompt-text').textContent, exact);
  } finally {
    await view.unmount();
  }
});

test('an empty ledger says so instead of rendering an empty list', async () => {
  const view = await mount({ history: [] });
  try {
    assert.equal(view.findAll('.turn').length, 0);
    assert.match(view.text(), /No turns yet/);
  } finally {
    await view.unmount();
  }
});

// ── §4: the diffs ───────────────────────────────────────────────────────────────

test('§4 each turn diffs against the previous turn, insertions and deletions marked', async () => {
  const view = await mount();

  try {
    // Turn 3 is the newest, so it is first. "settles quietly" → "settles, quietly,
    // into place": the words that moved must be marked, the rest must not.
    const newest = view.findAll('.turn')[0];
    const ins = [...newest.querySelectorAll('ins')].map((n) => n.textContent).join('');
    const del = [...newest.querySelectorAll('del')].map((n) => n.textContent).join('');

    assert.match(ins, /into place/, 'the added words are marked as insertions');
    assert.match(del, /opening/, 'the cut word is marked as a deletion');
    assert.doesNotMatch(ins, /settles/, 'untouched prose is not marked as new');
    assert.doesNotMatch(del, /settles/, 'untouched prose is not marked as cut');

    // Reassembling the diff must give back the turn's own snapshot — the diff is a
    // rendering of the text, not a summary of it.
    const rebuilt = [...newest.querySelectorAll('.diff > *')]
      .filter((node) => node.tagName !== 'DEL')
      .map((node) => node.textContent)
      .join('');
    assert.equal(rebuilt, SESSION[2].snapshot, 'insertions + unchanged text = the new snapshot');
  } finally {
    await view.unmount();
  }
});

test('§0.4 the diff is computed from the snapshots, never read off the turn', async () => {
  // A turn carrying a stored diff is the thing §0.4 rules out. If one ever appears,
  // this view must still ignore it and diff the snapshots.
  const poisoned = [
    human(1, 'first text\n'),
    human(2, 'second text\n', { diff: 'THIS MUST NOT BE RENDERED', warnings: undefined }),
  ];
  const view = await mount({ history: poisoned });

  try {
    assert.doesNotMatch(view.text(), /THIS MUST NOT BE RENDERED/);
    const newest = view.findAll('.turn')[0];
    assert.match(newest.querySelector('ins').textContent, /second/);
    assert.match(newest.querySelector('del').textContent, /first/);
  } finally {
    await view.unmount();
  }
});

test('the first turn diffs against nothing, so all of it reads as new', async () => {
  const view = await mount();

  try {
    const oldest = view.findAll('.turn')[2];
    assert.equal(oldest.querySelector('.turn-id').textContent, 'Turn 1');
    assert.equal(
      oldest.querySelector('ins').textContent,
      SESSION[0].snapshot,
      'the whole of turn 1 is an insertion — there is no previous snapshot',
    );
    assert.equal(oldest.querySelector('del'), null, 'and nothing was deleted to make it');
  } finally {
    await view.unmount();
  }
});

test('§3 an AI turn that changed nothing says so rather than showing an empty diff', async () => {
  // §3: an AI turn always commits, even when the model returned identical text,
  // because the prompt is provenance. The view has to make that legible.
  const view = await mount({
    history: [human(1, 'Unchanged prose.\n'), ai(2, 'Unchanged prose.\n', 'make it better')],
  });

  try {
    const newest = view.findAll('.turn')[0];
    assert.ok(newest.querySelector('.diff-empty'), 'a no-op turn needs an explanation, not a blank');
    assert.match(newest.textContent, /returned the draft unchanged/);
    assert.match(newest.textContent, /make it better/, 'and the prompt is still the record');
    assert.equal(newest.querySelectorAll('ins').length, 0);
    assert.equal(newest.querySelectorAll('del').length, 0);
  } finally {
    await view.unmount();
  }
});

// ── model speech vs model edits ─────────────────────────────────────────────────

test('§2.3 warnings render as the model REPORTING, in their own region', async () => {
  const view = await mount({
    history: [
      human(1, 'Some prose to revise at length.\n'),
      ai(2, 'Revised prose.\n', 'formalise it', {
        warnings: [
          'stripped: 2 headings, 1 blockquote, 1 table',
          'the draft is 63% shorter than before this turn, and the instruction did not ask for cutting',
        ],
        stripped: { heading: 2, blockquote: 1, table: 1 },
      }),
    ],
  });

  try {
    const speech = view.find('.turn-speech');
    assert.ok(speech, 'a turn carrying warnings must show them');

    assert.match(speech.textContent, /2 headings/);
    assert.match(speech.textContent, /1 blockquote/);
    assert.match(speech.textContent, /1 table/);
    assert.match(speech.textContent, /63% shorter/);
    assert.equal(view.findAll('.turn-warnings li').length, 2, 'one line per warning');

    // §2.3: the counts are structured data on the turn so the view can RENDER them.
    // Read from that field, not parsed back out of the formatted string.
    const stripped = view.find('.turn-stripped');
    assert.ok(stripped, 'the structured counts are rendered, not only the sentence');
    assert.deepEqual(
      [...stripped.querySelectorAll('dt')].map((n) => n.textContent),
      ['heading', 'blockquote', 'table'],
    );
    assert.deepEqual([...stripped.querySelectorAll('dd')].map((n) => n.textContent), ['2', '1', '1']);
  } finally {
    await view.unmount();
  }
});

test('model speech and model edits are separate records — the UI never blends them', async () => {
  const view = await mount({
    history: [
      human(1, 'The old sentence.\n'),
      ai(2, 'The new sentence.\n', 'rewrite it', {
        warnings: ['stripped: 1 heading'],
        stripped: { heading: 1 },
      }),
    ],
  });

  try {
    const turn = view.findAll('.turn')[0];
    const speech = turn.querySelector('.turn-speech');
    const changes = turn.querySelector('.turn-changes');
    assert.ok(speech && changes);

    // Disjoint subtrees, not merely adjacent text. This is the assertion that stops
    // a future conversation channel from being dropped into the diff paragraph.
    assert.equal(speech.contains(changes), false, 'the diff must not live inside the report');
    assert.equal(changes.contains(speech), false, 'the report must not live inside the diff');

    // And nothing leaks either way.
    assert.doesNotMatch(changes.textContent, /stripped/, 'what the model SAID is not in the diff');
    assert.doesNotMatch(speech.textContent, /new sentence/, 'what the model DID is not in the report');
    assert.equal(speech.querySelectorAll('ins, del').length, 0, 'no diff marks inside the report');

    // Each region names itself, so the separation survives a reader who cannot see
    // the border between the two boxes.
    assert.match(speech.getAttribute('aria-label'), /reported/i);
    assert.match(changes.getAttribute('aria-label'), /changed/i);
    assert.equal(speech.querySelector('.record-label').textContent, 'Reported');
    assert.equal(changes.querySelector('.record-label').textContent, 'Changed');
  } finally {
    await view.unmount();
  }
});

test('a turn with no warnings has no report region at all', async () => {
  const view = await mount();
  try {
    assert.equal(view.findAll('.turn-speech').length, 0, 'nothing was reported, so nothing is shown');
    assert.equal(view.findAll('.turn-changes').length, 3, 'but every turn still shows what it changed');
  } finally {
    await view.unmount();
  }
});

// ── §4: the read-only turn view ─────────────────────────────────────────────────

test('§4 clicking a turn opens the whole draft as of that turn, read-only', async () => {
  const view = await mount();

  try {
    assert.equal(view.findAll('.turn-snapshot').length, 0, 'closed to begin with');

    await view.click(view.findByText('button', 'Open turn 2 read-only'));

    const snapshot = view.find('.turn-snapshot');
    assert.ok(snapshot, 'the turn opens');

    // The FULL draft as of that turn, byte for byte — not the diff, not a summary.
    const text = snapshot.querySelector('pre');
    assert.ok(text, 'a <pre>, so the Markdown is shown as it is stored');
    assert.equal(text.textContent, SESSION[1].snapshot);

    // §4: "The text MUST be selectable and copyable." Nothing here takes a caret or
    // holds the text anywhere but in a text node.
    assert.equal(snapshot.querySelectorAll('[contenteditable]').length, 0);
    assert.equal(snapshot.querySelectorAll('input, textarea, button').length, 0);
    assert.equal(text.getAttribute('aria-readonly'), 'true');

    await view.click(view.findByText('button', 'Hide turn 2'));
    assert.equal(view.findAll('.turn-snapshot').length, 0, 'and it closes again');
  } finally {
    await view.unmount();
  }
});

test('§4 only one turn is open at a time, and it is the one that was clicked', async () => {
  const view = await mount();

  try {
    await view.click(view.findByText('button', 'Open turn 1 read-only'));
    assert.equal(view.find('.turn-snapshot pre').textContent, SESSION[0].snapshot);

    await view.click(view.findByText('button', 'Open turn 3 read-only'));
    const open = view.findAll('.turn-snapshot');
    assert.equal(open.length, 1, 'opening another closes the first');
    assert.equal(open[0].querySelector('pre').textContent, SESSION[2].snapshot);
  } finally {
    await view.unmount();
  }
});

test('§4 a snapshot cannot be mistaken for the live draft', async () => {
  const view = await mount();

  try {
    await view.click(view.findByText('button', 'Open turn 1 read-only'));

    // Said in words, on the element itself.
    assert.match(view.find('.snapshot-label').textContent, /Read-only/);
    assert.match(view.find('.snapshot-label').textContent, /as it stood at turn 1/);

    // And the turn that IS the live draft is the one marked as such — the newest.
    const live = view.findAll('.turn-live');
    assert.equal(live.length, 1, 'exactly one turn is the working draft');
    assert.equal(live[0].querySelector('.turn-id').textContent, 'Turn 3');
    assert.match(live[0].textContent, /the live draft/);
  } finally {
    await view.unmount();
  }
});

// ── §4: restore ─────────────────────────────────────────────────────────────────

test('§4 every turn carries one restore control, and it names the turn it restores', async () => {
  const restored = [];
  const view = await mount({ onRestore: (id) => restored.push(id) });

  try {
    const buttons = view.findAll('.turn-restore');
    assert.equal(buttons.length, 3, 'restore is on every entry, not only on old ones');

    // §4 is explicit that this is one action. No confirmation step, no second click.
    await view.click(buttons[2]); // the oldest entry: turn 1
    assert.deepEqual(restored, [1]);

    await view.click(buttons[0]); // the newest: restoring to where you already are
    assert.deepEqual(restored, [1, 3], 'the live turn offers restore too — the no-op is reported, not blocked');
  } finally {
    await view.unmount();
  }
});

test('restore is disabled while something else is in flight', async () => {
  const view = await mount({ busy: true });
  try {
    for (const button of view.findAll('.turn-restore')) {
      assert.equal(button.disabled, true, 'a restore must not race a turn that is already committing');
    }
  } finally {
    await view.unmount();
  }
});

// ── the UI constraints this chunk imposes ───────────────────────────────────────

test('the history sits in the editor column, scrolls with the document, and overlays nothing', () => {
  // Asserted on the CSS text, deliberately: jsdom applies no stylesheet, so a
  // rendered check here would pass with `position: fixed; inset: 0` in place.
  //
  // The grid-column assertion is not decoration. Spanning `1 / -1` put the history
  // under the sticky right rail, which covered the Restore control on every entry
  // and made the whole view unusable — found in the browser, not here. It belongs
  // in the editor's column, the same width as the draft it describes.
  const history = rule('.history');
  assert.doesNotMatch(history, /position: *(fixed|absolute)/, 'the history must not float over the draft');
  assert.match(history, /grid-column: *1;/, "the editor's column, not the full grid width");
  assert.doesNotMatch(
    history,
    /grid-column: *1 \/ -1/,
    'spanning the rail puts the sticky panel on top of the restore controls',
  );

  // Normal document scroll. A scroll box nested inside the page scroll is the other
  // way a control ends up somewhere the reader cannot reach it.
  for (const selector of ['.history', '.diff', '.snapshot-text', '.turn-list', '.turn']) {
    assert.doesNotMatch(
      rule(selector),
      /overflow(-y)?: *(auto|scroll)|max-height:/,
      `${selector} must not become its own scroll container`,
    );
  }

  // §4 requires insertions green and deletions red strikethrough, and jsdom cannot
  // see either, so they are pinned here with the rest.
  assert.match(rule('.diff .del'), /text-decoration: *line-through/);
  assert.match(rule('.diff .ins'), /background/);

  // §4: the snapshot must be selectable.
  assert.match(rule('.snapshot-text'), /user-select: *text/);
});
