/**
 * §4's replacement-block grouping, at the diff layer.
 *
 * The rendering half lives in history.test.js; this is the decision itself —
 * which regions block, which stay inline, and that a blocked region loses
 * nothing. Kept separate from the component because the thresholds are a data
 * question and should be answerable without a DOM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANCHOR_MIN_CHARS,
  BLOCK_MIN_CHARS,
  BLOCK_THRESHOLD,
  groupDiffRegions,
  wordDiff,
} from '../src/diff.js';

const group = (before, after, options) => groupDiffRegions(wordDiff(before, after), options);
const blocks = (regions) => regions.filter((r) => r.type === 'replacement');

/** The live turn 10 → 11 case, trimmed to the shape that reproduces it. */
const ANCHOR = 'Co-writing with a human and an AI combines the best of both worlds, and this opening runs on long enough to be a real anchor.\n\n';
const OLD_TAIL = "[link](https://www.nytimes.com/) this is now a link test. Here's a copy-pasted link: <https://www.wsj.com/> link 2.\n";
const NEW_TAIL = 'I think the future is humans and AI working together more fluently. This is meant to be a tool that facilitates that collaboration, and there are at least two kinds of edits.\n';

test('§4 the live confetti case groups into one anchor and one replacement', () => {
  const regions = group(ANCHOR + OLD_TAIL, ANCHOR + NEW_TAIL);

  assert.equal(regions.length, 2, 'the untouched opening, then the replaced tail');
  assert.equal(regions[0].type, 'inline');
  assert.equal(regions[1].type, 'replacement');

  // No content lost: the two sides reconstruct the region, up to the whitespace
  // `diffWords` may take from either input (see the next test).
  assert.equal(regions[1].removed.replace(/\s+/g, ' '), OLD_TAIL.replace(/\s+/g, ' '));
  assert.equal(regions[1].added.replace(/\s+/g, ' '), NEW_TAIL.replace(/\s+/g, ' '));

  // And the untouched paragraph is not swept in.
  assert.equal(regions[0].parts.map((p) => p.value).join(''), ANCHOR);
});

test('§4 a blocked region loses no content — nothing is summarized or dropped', () => {
  // The property that makes this a rendering change and not a data change: for
  // every region, concatenating the removed sides and the added sides across all
  // regions must rebuild the two inputs — up to whitespace, which `diffWords`
  // normalizes on its own (asserted as inherited in the next test).
  const cases = [
    [ANCHOR + OLD_TAIL, ANCHOR + NEW_TAIL],
    ['one two three four five six seven eight nine ten\n', 'wholly different prose entirely replacing it now\n'],
    ['keep this exactly as it is, every word of it, unchanged\n', 'keep this exactly as it is, every word of it, unchanged\n'],
    ['', 'all of this is new and none of it was there before at all\n'],
    ['all of this is going away and none of it survives the edit\n', ''],
  ];

  for (const [before, after] of cases) {
    const regions = group(before, after);
    const rebuiltBefore = regions
      .map((r) => (r.type === 'replacement' ? r.removed : r.parts.filter((p) => !p.added).map((p) => p.value).join('')))
      .join('');
    const rebuiltAfter = regions
      .map((r) => (r.type === 'replacement' ? r.added : r.parts.filter((p) => !p.removed).map((p) => p.value).join('')))
      .join('');

    const ws = (text) => text.replace(/\s+/g, ' ').trim();
    assert.equal(ws(rebuiltBefore), ws(before), `before-text lost for ${JSON.stringify(before.slice(0, 30))}`);
    assert.equal(ws(rebuiltAfter), ws(after), `after-text lost for ${JSON.stringify(after.slice(0, 30))}`);
  }
});

test('the whitespace caveat is inherited from diffWords, not introduced by grouping', () => {
  // Worth pinning, because "lossless up to whitespace" is a weaker claim than it
  // first looks and someone will want to know whose fault it is. The plain word
  // diff has the identical property: rebuilding `before` from its non-added parts
  // also misses by whitespace. If a future `diff` upgrade makes the inline path
  // exact, this test fails and the grouped path should be re-checked to match.
  const before = ANCHOR + OLD_TAIL;
  const after = ANCHOR + NEW_TAIL;

  const parts = wordDiff(before, after);
  const inlineRebuild = parts.filter((p) => !p.added).map((p) => p.value).join('');
  const groupedRebuild = group(before, after)
    .map((r) => (r.type === 'replacement' ? r.removed : r.parts.filter((p) => !p.added).map((p) => p.value).join('')))
    .join('');

  assert.equal(inlineRebuild, groupedRebuild, 'grouping changes nothing about what text is recovered');
  assert.notEqual(inlineRebuild, before, 'and the inline path was already inexact — this is diffWords');
  assert.equal(
    inlineRebuild.replace(/\s+/g, ' '),
    before.replace(/\s+/g, ' '),
    'inexact only in whitespace; every word is on the correct side',
  );
});

test('§4 a small edit inside untouched prose stays inline', () => {
  const before = 'The result is a more efficient process, where ideas tends to be tested in real time, and gaps in reasoning are caught sooner than before.\n';
  const after = before.replace('tends to', 'can').replace('sooner', 'faster');

  const regions = group(before, after);
  assert.equal(blocks(regions).length, 0, 'a word swap is what inline marks are FOR');

  const marks = regions.flatMap((r) => r.parts.filter((p) => p.added || p.removed));
  assert.equal(marks.length, 4, 'two deletions and two insertions, inline');
});

test('§4 blocking needs both sides: a pure insertion or deletion stays inline', () => {
  const long = 'A paragraph long enough to clear the block minimum several times over, with plenty of words in it to be sure.\n';
  const anchor = 'An opening that stays exactly as it was, long enough to anchor the diff on its own.\n\n';

  assert.equal(blocks(group(anchor, anchor + long)).length, 0, 'insertion');
  assert.equal(blocks(group(anchor + long, anchor)).length, 0, 'deletion');

  // But a replacement of the same size DOES block.
  const other = 'An entirely different paragraph of comparable length, sharing almost nothing with the one it replaces here.\n';
  assert.equal(blocks(group(anchor + long, anchor + other)).length, 1, 'replacement');
});

test('§4 the three thresholds each do something, and each is checkable', () => {
  assert.equal(BLOCK_THRESHOLD, 0.5);
  assert.equal(BLOCK_MIN_CHARS, 120);
  assert.equal(ANCHOR_MIN_CHARS, 24);

  const before = ANCHOR + OLD_TAIL;
  const after = ANCHOR + NEW_TAIL;

  // Raise the threshold above what this case achieves → no block.
  assert.equal(blocks(group(before, after, { threshold: 0.999 })).length, 0, 'threshold is live');

  // Raise the size floor above the region → no block.
  assert.equal(blocks(group(before, after, { minChars: 100_000 })).length, 0, 'minChars is live');

  // Raise the anchor length past every unchanged run and nothing is a boundary
  // any more, so the whole diff collapses into ONE region — and the untouched
  // opening paragraph is swept into the replacement block with it. That is the
  // failure ANCHOR_MIN_CHARS exists to prevent, and it is worth seeing.
  const noAnchors = group(before, after, { anchorChars: 100_000 });
  assert.equal(noAnchors.length, 1, 'nothing anchors, so it is all one region');
  assert.equal(noAnchors[0].type, 'replacement');
  assert.match(noAnchors[0].removed, /Co-writing with a human/, 'the untouched opening got swept in');

  // Drop it to zero and every unchanged run becomes its own boundary, so no
  // region has both sides and nothing can block. The default sits between.
  assert.equal(blocks(group(before, after, { anchorChars: 0 })).length, 0);
});

test('§4 an unchanged pair produces one inline region and no blocks', () => {
  const text = 'Nothing about this changed at all, not one word of it, anywhere in the whole thing.\n';
  const regions = group(text, text);
  assert.equal(blocks(regions).length, 0);
  assert.equal(regions.every((r) => r.type === 'inline'), true);
  assert.equal(regions.flatMap((r) => r.parts).some((p) => p.added || p.removed), false);
});
