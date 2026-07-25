/**
 * CLAUDE.md §0.1 — canonicalize() tests 1 and 3 (idempotence, no escape growth),
 * plus a fixture guard and the dialect pins. Test 2 (TipTap fixed point) lives in
 * test/tiptap-fixed-point.test.js because it needs a headless editor.
 *
 * Every case here runs against the shared fixture in test/fixtures/draft-fixture.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../src/canonicalize.js';
import { FIXTURE, FIXTURE_PATH, REQUIRED_CONSTRUCTS } from './fixtures/index.js';

/** Whole fixture, plus each of its blocks, plus degenerate inputs. */
const BLOCKS = FIXTURE.split(/\n{2,}/).filter((b) => b.trim() !== '');
const CASES = [
  ['whole fixture', FIXTURE],
  ...BLOCKS.map((b, i) => [`fixture block ${i + 1}: ${b.slice(0, 42).replace(/\n/g, '⏎')}…`, b]),
  ['empty string', ''],
  ['whitespace only', '   \n\n \t \n'],
  ['no trailing newline', 'a sentence with **bold** and no final newline'],
  ['CRLF line endings', 'first line\r\n\r\n- bullet one\r\n- bullet two\r\n'],
];

test('fixture covers every construct §5 requires', () => {
  assert.ok(FIXTURE.length > 800, `fixture looks gutted (${FIXTURE.length} chars): ${FIXTURE_PATH}`);
  const missing = REQUIRED_CONSTRUCTS.filter(([, present]) => !present(FIXTURE)).map(([label]) => label);
  assert.deepEqual(missing, [], `fixture is missing: ${missing.join(', ')}`);
  assert.equal(BLOCKS.length >= 8, true, `expected several blocks, got ${BLOCKS.length}`);
});

test('idempotence: canonicalize(canonicalize(x)) === canonicalize(x)', async (t) => {
  for (const [label, input] of CASES) {
    await t.test(label, () => {
      const once = canonicalize(input);
      const twice = canonicalize(once);
      assert.equal(twice, once);
    });
  }
});

test('no escape accumulation: ten passes never grow and never change', async (t) => {
  for (const [label, input] of CASES) {
    await t.test(label, () => {
      const first = canonicalize(input);
      let current = first;
      for (let pass = 2; pass <= 10; pass += 1) {
        const next = canonicalize(current);
        assert.ok(
          next.length <= first.length,
          `pass ${pass} grew from ${first.length} to ${next.length} chars`,
        );
        assert.equal(next, first, `pass ${pass} differs from pass 1`);
        current = next;
      }
      assert.equal(
        (first.match(/\\/g) ?? []).length,
        (canonicalize(first).match(/\\/g) ?? []).length,
        'backslash count changed between passes',
      );
    });
  }
});

test('canonical output uses the pinned dialect', () => {
  const out = canonicalize(FIXTURE);

  assert.match(out, /\*\*bold text\*\*/, 'strong must be **');
  assert.match(out, /(^|[^*])\*underscore italic\*/, 'emphasis must be *');
  assert.match(out, /\*\*underscore strong\*\*/, '__strong__ must normalize to **');
  assert.doesNotMatch(out, /_underscore italic_/, 'underscore emphasis must be gone');
  assert.doesNotMatch(out, /__/, 'underscore strong must be gone');

  for (const line of out.split('\n')) {
    assert.doesNotMatch(line, /^\s*[*+] /, `list marker must be '-': ${JSON.stringify(line)}`);
  }
  assert.match(out, /^- Star bullet with \*\*bold\*\* and \*italic\*$/m, 'bullets normalize to "- "');
  assert.match(out, /^- Wide-indent dash bullet/m, "listItemIndent 'one': single space after marker");

  // Constructs outside the v1 dialect must not appear.
  assert.doesNotMatch(out, /^#/m, 'no headings');
  assert.doesNotMatch(out, /^```/m, 'no fenced code');
  assert.doesNotMatch(out, /^\|/m, 'no tables');
  assert.doesNotMatch(out, /~~/, 'no strikethrough');
  assert.doesNotMatch(out, /^(-{3,}|\*{3,}|_{3,})$/m, 'no thematic breaks');

  // Whitespace shape.
  assert.equal(out.endsWith('\n'), true, 'exactly one trailing newline');
  assert.doesNotMatch(out, /\n\n$/, 'exactly one trailing newline');
  assert.doesNotMatch(out, /\n{3,}/, 'blank runs collapse to one');
  assert.doesNotMatch(out, /[^\S\n]\n/, 'no trailing whitespace on any line');
  assert.doesNotMatch(out, /\r/, 'no carriage returns');
});

test('adjacent same-type lists merge, and no + marker ever reaches the store', () => {
  const out = canonicalize(FIXTURE);

  assert.doesNotMatch(out, /^\s*\+/m, 'a + list marker reached the store');

  // The fixture's two adjacent lists (3 star bullets, then 2 wide-indent dash
  // bullets) must arrive as ONE list block of five items, no blank line inside.
  const listBlocks = out.split(/\n{2,}/).filter((b) => b.startsWith('- '));
  assert.equal(listBlocks.length, 1, `expected one list block, got ${listBlocks.length}`);
  const items = listBlocks[0].split('\n');
  assert.equal(items.length, 5, `expected 5 merged items, got ${items.length}`);
  assert.match(items[0], /^- Star bullet with \*\*bold\*\* and \*italic\*$/);
  assert.match(items[4], /^- Second wide-indent bullet with an \[indented link\]/);

  // Synthetic cases, including the marker mix that produced '+' before the transform.
  assert.equal(canonicalize('* a\n\n- b\n'), '- a\n- b\n');
  assert.equal(canonicalize('- a\n\n* b\n\n+ c\n'), '- a\n- b\n- c\n');
  assert.equal(canonicalize('- outer\n\n  - n1\n\n  * n2\n'), '- outer\n\n  - n1\n  - n2\n');

  // Real separations must survive: a paragraph between two lists keeps them apart,
  // and an ordered list is not the same type as a bullet list.
  assert.equal(canonicalize('- a\n\ntext\n\n- b\n'), '- a\n\ntext\n\n- b\n');
  assert.match(canonicalize('- a\n\n1. b\n'), /^- a\n\n1\. b\n$/);
});

test('every list is tight', () => {
  // Not one of the original §0.1 pins — reported for ratification. A tightness rule
  // is forced by the merge (tight + loose has to resolve to one of them), and loose
  // vs tight is trivia the model flips at random, which would diff as a whole list.
  assert.equal(canonicalize('- a\n\n- b\n'), '- a\n- b\n', 'loose list must tighten');
  assert.equal(canonicalize('- a\n- b\n\n- c\n'), '- a\n- b\n- c\n', 'part-loose list must tighten');
  assert.equal(
    canonicalize('- outer\n\n  - n1\n\n  - n2\n'),
    '- outer\n\n  - n1\n  - n2\n',
    'nested loose list must tighten',
  );

  // Tightening is about blank lines BETWEEN items. An item holding two paragraphs
  // must keep the blank line between them, or they reparse as one paragraph.
  assert.equal(
    canonicalize('- para one\n\n  para two\n\n- b\n'),
    '- para one\n\n  para two\n- b\n',
    'item-internal blank line must survive',
  );
  assert.equal(
    canonicalize(canonicalize('- para one\n\n  para two\n\n- b\n')),
    canonicalize('- para one\n\n  para two\n\n- b\n'),
    'tightened multi-paragraph item must be idempotent',
  );
});

test('canonicalize preserves the content §5 cares about', () => {
  const out = canonicalize(FIXTURE);

  assert.match(out, /\[link to the docs\]\(https:\/\/example\.com\/docs\?a=1\\?&b=2\)/, 'inline link survives');
  assert.match(out, /\[Microsoft Word\]\(https:\/\/www\.microsoft\.com\/en-us\/microsoft-365\/word\)/);
  assert.match(out, /\[Google Docs\]\(https:\/\/docs\.google\.com\/document\/d\/1AbC_dEf-23\/edit\)/);
  assert.match(out, /https:\/\/example\.com\/bare\/url/, 'bare URL survives');
  assert.doesNotMatch(out, /<https:\/\//, 'bare URL is NOT autolinked (no GFM literals)');

  assert.match(out, /a \\\* b/, 'literal asterisk survives (escaped)');
  assert.match(out, /snake\\?_case\\?_name/, 'snake_case_name survives');
  assert.match(out, /100%/, 'percent sign survives unescaped');

  // Typographic characters from Word / Google Docs pastes pass through untouched.
  for (const ch of ['“', '”', '‘', '’', '—', '…', ' ']) {
    assert.ok(out.includes(ch), `character U+${ch.codePointAt(0).toString(16).toUpperCase()} was dropped`);
  }

  // Nothing is lost from the prose: word content is identical modulo markup.
  const words = (s) =>
    s
      .replace(/^\s*[-*+] /gm, ' ') // list markers are markup, not prose
      .replace(/[\\*_`[\]()]|https?:\/\/\S+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  assert.deepEqual(words(out), words(FIXTURE), 'prose words changed');
});

test('canonicalize rejects non-strings', () => {
  assert.throws(() => canonicalize(undefined), TypeError);
  assert.throws(() => canonicalize(null), TypeError);
  assert.throws(() => canonicalize({ md: 'x' }), TypeError);
});
