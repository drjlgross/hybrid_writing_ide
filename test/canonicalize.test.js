/**
 * CLAUDE.md §0.1 — canonicalize() tests 1 and 3 (idempotence, no escape growth),
 * plus a fixture guard and the dialect pins. Test 2 (TipTap fixed point) lives in
 * test/tiptap-fixed-point.test.js because it needs a headless editor.
 *
 * Every case here runs against the shared fixture in test/fixtures/draft-fixture.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unified } from 'unified';
import remarkParse from 'remark-parse';

import { canonicalize } from '../src/canonicalize.js';
import { FIXTURE, FIXTURE_PATH, REQUIRED_CONSTRUCTS } from './fixtures/index.js';

/** Parse Markdown to mdast for structural assertions. Parse only — no stringify. */
const mdastOf = (md) => unified().use(remarkParse).parse(md);

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
  // Located by content, not by index — the fixture holds several other lists.
  const merged = out.split(/\n{2,}/).find((b) => b.startsWith('- Star bullet with'));
  assert.ok(merged, 'the merged list block is missing from canonical output');
  const items = merged.split('\n');
  assert.equal(items.length, 5, `expected 5 merged items, got ${items.length}`);
  assert.match(items[0], /^- Star bullet with \*\*bold\*\* and \*italic\*$/);
  assert.match(items[4], /^- Second wide-indent bullet with an \[indented link\]/);

  // The general invariant, structural rather than positional: nowhere in the tree do
  // two same-type lists sit next to each other. Holds however the fixture grows.
  const walk = (node) => {
    const children = node.children ?? [];
    for (let i = 1; i < children.length; i += 1) {
      const prev = children[i - 1];
      const cur = children[i];
      assert.ok(
        !(prev.type === 'list' && cur.type === 'list' && Boolean(prev.ordered) === Boolean(cur.ordered)),
        `two adjacent same-type lists survived at line ${cur.position?.start?.line}`,
      );
    }
    for (const child of children) walk(child);
  };
  walk(mdastOf(out));

  // Synthetic cases, including the marker mix that produced '+' before the transform.
  assert.equal(canonicalize('* a\n\n- b\n'), '- a\n- b\n');
  assert.equal(canonicalize('- a\n\n* b\n\n+ c\n'), '- a\n- b\n- c\n');
  assert.equal(canonicalize('- outer\n\n  - n1\n\n  * n2\n'), '- outer\n\n  - n1\n  - n2\n');

  // Real separations must survive: a paragraph between two lists keeps them apart,
  // and an ordered list is not the same type as a bullet list.
  assert.equal(canonicalize('- a\n\ntext\n\n- b\n'), '- a\n\ntext\n\n- b\n');
  assert.match(canonicalize('- a\n\n1. b\n'), /^- a\n\n1\. b\n$/);
});

test('no list in canonical output is spread', () => {
  // §0.1's required tight-list assertion, structural and on the fixture. Kept as its
  // own test so that removing the tightening rule fails HERE, independently of the
  // synthetic cases below.
  //
  // List nodes only. NOT list items: a list item holding two paragraphs necessarily
  // has spread === true, and §0.1 requires the fixture to contain one. Asserting
  // item-level spread would make the two §0.1 requirements mutually unsatisfiable.
  const lists = [];
  const walk = (node) => {
    if (node.type === 'list') lists.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(mdastOf(canonicalize(FIXTURE)));

  assert.ok(lists.length >= 4, `expected several lists in the fixture, found ${lists.length}`);
  for (const list of lists) {
    assert.equal(
      list.spread,
      false,
      `list node is spread at line ${list.position?.start?.line}: canonical output ` +
        'contains a loose list, so the §0.1 tight-list rule is not being applied',
    );
  }
});

test('loose lists tighten', () => {
  assert.equal(canonicalize('- a\n\n- b\n'), '- a\n- b\n', 'loose list must tighten');
  assert.equal(canonicalize('- a\n- b\n\n- c\n'), '- a\n- b\n- c\n', 'part-loose list must tighten');
  assert.equal(
    canonicalize('- outer\n\n  - n1\n\n  - n2\n'),
    '- outer\n\n  - n1\n  - n2\n',
    'nested loose list must tighten',
  );

});

test('a list item holding two paragraphs keeps the blank line between them', () => {
  // §0.1 requires this asserted separately from the tight-list rule. Tightening is
  // about blank lines BETWEEN items; within an item the blank line is load-bearing —
  // without it the two paragraphs reparse as one, which is content corruption.
  assert.equal(
    canonicalize('- para one\n\n  para two\n\n- b\n'),
    '- para one\n\n  para two\n- b\n',
    'item-internal blank line must survive',
  );
  assert.equal(
    canonicalize(canonicalize('- para one\n\n  para two\n\n- b\n')),
    canonicalize('- para one\n\n  para two\n- b\n'),
    'tightened multi-paragraph item must be idempotent',
  );

  // The fixture's own multi-paragraph item, end to end.
  const out = canonicalize(FIXTURE);
  assert.match(
    out,
    /^- Item one holds two paragraphs, and this is the first\.\n\n {2}This second paragraph belongs to the same list item\.\n- Item two is an ordinary single-paragraph item\.$/m,
    "the fixture's multi-paragraph item lost its internal blank line or gained one between items",
  );

  // And it must survive as two paragraphs, not silently merge into one.
  const items = [];
  const walk = (node) => {
    if (node.type === 'listItem') items.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(mdastOf(out));
  const multi = items.filter((item) => item.children.filter((c) => c.type === 'paragraph').length > 1);
  assert.equal(multi.length, 1, 'expected exactly one list item holding two paragraphs');
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

  // Newer fixture constructs.
  assert.match(out, /backslash \\ stands alone/, 'literal backslash survives');
  assert.match(out, /C:\\temp\\file/, 'backslashes before letters survive');
  assert.match(out, /AT\\?&T and R\\?&D/, 'ampersand before a letter survives');
  assert.match(out, /\[mail me\]\(mailto:writer@example\.com\)/, 'mailto link survives');
  assert.match(out, /\(mailto:docs@example\.com\?subject=Hello\)/, 'mailto query survives');

  // Nothing is lost from the prose: word content is identical modulo markup AND
  // modulo entity decoding. remark decodes character references — `&amp;` becomes a
  // bare `&`, `&nbsp;` becomes U+00A0 — so the raw side is decoded before comparing.
  // Backslashes are deleted rather than replaced with a space, or an escaped `AT\&T`
  // would split into two tokens and read as a content change.
  const words = (s) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, '\u00a0')
      .replace(/\\/g, '')
      .replace(/^\s*[-*+] /gm, ' ') // list markers are markup, not prose
      .replace(/[*_`[\]()]|https?:\/\/\S+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  assert.deepEqual(words(out), words(FIXTURE), 'prose words changed');
});

test('canonicalize rejects non-strings', () => {
  assert.throws(() => canonicalize(undefined), TypeError);
  assert.throws(() => canonicalize(null), TypeError);
  assert.throws(() => canonicalize({ md: 'x' }), TypeError);
});
