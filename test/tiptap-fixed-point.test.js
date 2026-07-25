/**
 * CLAUDE.md §0.1 — "TipTap is a fixed point, up to escape differences":
 *   canonicalize(tiptapSerialize(doc)) === tiptapSerialize(doc)
 *
 * Purpose per the spec: catch a TipTap upgrade changing markers.
 *
 * `doc` here is parsed from CANONICAL Markdown, which is the only meaningful
 * reading now that the adjacent-list merge exists: canonicalize is deliberately
 * not a no-op on two adjacent lists, so no fixed point can hold for a doc parsed
 * from raw Markdown that contains them. It is also the app's real data flow — the
 * editor is only ever loaded from a canonical snapshot (§0.1, §0.6). Convergence
 * from non-canonical input is covered by the last test in this file.
 *
 * Strict byte equality does not hold and cannot be reached from the TipTap side.
 * The two serializers escape differently in both directions:
 *   - remark-stringify escapes conservatively where TipTap does not
 *     (`snake\_case\_name`, `?a=1\&b=2`), so canonicalize ADDS backslashes,
 *     pinned to exactly `_` and `&`;
 *   - TipTap escapes a literal backslash as `\\` where remark-stringify emits a
 *     bare `\`, so canonicalize REMOVES backslashes, pinned to exactly `\`.
 * Structure and markers must still match byte-for-byte, and canonicalize must be
 * stable on TipTap's output. Any marker, indent, or structural drift from a TipTap
 * upgrade still fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getSchema } from '@tiptap/core';

import { canonicalize } from '../src/canonicalize.js';
import { buildExtensions } from '../src/tiptap-config.js';
import { FIXTURE } from './fixtures/index.js';
import { canonicalCases } from './helpers/cases.js';
import { tiptapRoundTrip } from './helpers/headless-editor.js';

// §0.1: a difference is tolerated only where round-trip identity holds for the same
// construct AND the difference is pinned to an exact named set, asserted
// bidirectionally. Each set below narrows what this test can catch, which is why the
// marker and list-indent mutations are re-verified every time one is added.

/** Characters canonicalize() escapes that TipTap leaves bare (§0.1). */
const PERMITTED_ADDED_ESCAPES = new Set(['_', '&']);

/** Characters TipTap escapes that canonicalize leaves bare (§0.1). */
const PERMITTED_REMOVED_ESCAPES = new Set(['\\']);

/**
 * Blank lines TipTap emits between blocks that canonicalize removes (§0.1). A list
 * item holding two paragraphs makes tiptap-markdown serialize the whole list loose;
 * the tight-list rule takes the blank line back out.
 */
const PERMITTED_EXTRA_BLANK_LINES = new Set(['between list items']);

/**
 * Walk `tiptapOut` against `canonical` and classify every difference as an escape
 * canonicalize added, an escape canonicalize removed, a blank line canonicalize
 * removed, or a structural divergence.
 *
 * Deliberately does NOT consult any allowlist: that separation is what lets a
 * structural change (marker or indent drift) and an unpermitted difference produce
 * different failure messages. Gating the walk on an allowlist collapses them into
 * one message and makes the caller's checks unreachable.
 *
 * @returns {{added: object[], removed: object[], extraBlankLines: object[]}}
 */
function diffTolerated(tiptapOut, canonical, label) {
  const added = [];
  const removed = [];
  const extraBlankLines = [];
  let i = 0;
  let j = 0;
  while (i < tiptapOut.length || j < canonical.length) {
    if (tiptapOut[i] === canonical[j]) {
      // Both sides sit on a backslash, but TipTap doubled it where canonical did
      // not: that is a removed escape, not a match. Checked here rather than before
      // the equality test, so a `\\` present on BOTH sides still matches normally.
      const tiptapDoubled =
        tiptapOut[i] === '\\' && tiptapOut[i + 1] === '\\' && canonical[j + 1] !== '\\';
      if (!tiptapDoubled) {
        i += 1;
        j += 1;
        continue;
      }
      removed.push({ char: '\\', index: i });
      i += 1;
      continue;
    }
    // An added escape: canonical has a backslash TipTap does not, and the very next
    // canonical character is the one TipTap is sitting on.
    if (canonical[j] === '\\' && canonical[j + 1] !== undefined && tiptapOut[i] === canonical[j + 1]) {
      added.push({ char: canonical[j + 1], index: j });
      j += 1;
      continue;
    }
    // A removed escape in any other position: TipTap has a backslash canonical does
    // not, and the character it escapes is what canonical is sitting on.
    if (tiptapOut[i] === '\\' && tiptapOut[i + 1] !== undefined && canonical[j] === tiptapOut[i + 1]) {
      removed.push({ char: tiptapOut[i + 1], index: i });
      i += 1;
      continue;
    }
    // An extra blank line: TipTap has a newline canonical does not, and what follows
    // in both is the start of a list-item line. Narrow on purpose — an extra newline
    // anywhere else is structural and must still fail.
    if (
      tiptapOut[i] === '\n' &&
      canonical[j] === tiptapOut[i + 1] &&
      canonical[j - 1] === '\n' &&
      /^ *- /.test(canonical.slice(j, j + 8))
    ) {
      extraBlankLines.push({ kind: 'between list items', index: i });
      i += 1;
      continue;
    }
    assert.fail(
      `STRUCTURAL DIVERGENCE in case "${label}": TipTap output and its ` +
        'canonicalization differ by something other than a tolerated difference. A ' +
        'marker, list indent, or blank-line change — check the pinned ' +
        'STRINGIFY_OPTIONS and MARKDOWN_OPTIONS against each other.\n' +
        `  at tiptap[${i}] / canonical[${j}]\n` +
        `  tiptap:    ${JSON.stringify(tiptapOut.slice(Math.max(0, i - 40), i + 40))}\n` +
        `  canonical: ${JSON.stringify(canonical.slice(Math.max(0, j - 40), j + 40))}`,
    );
  }
  return { added, removed, extraBlankLines };
}

const CANONICAL_FIXTURE = canonicalize(FIXTURE);
const CASES = canonicalCases(CANONICAL_FIXTURE);

test('TipTap is a fixed point of canonicalize, up to pinned differences', async (t) => {
  const observedAdded = new Set();
  const observedRemoved = new Set();
  const observedBlankLines = new Set();

  // A union assertion over an incomplete run is not meaningful: a case that failed
  // never recorded its differences, so every tolerance it was the sole exerciser of
  // looks unexercised. With three sets that is three ways for one real failure to
  // produce misleading company, so the union checks are skipped when any case failed.
  let caseFailures = 0;

  const runCase = (label, input) => {
    const tiptapOut = tiptapRoundTrip(input);
    const canonical = canonicalize(tiptapOut);

    const { added, removed, extraBlankLines } = diffTolerated(tiptapOut, canonical, label);

    for (const { char } of added) {
      assert.ok(
        PERMITTED_ADDED_ESCAPES.has(char),
        `NEW ADDED-ESCAPE DIVERGENCE: canonicalize added an escape before ` +
          `${JSON.stringify(char)} in case "${label}", which PERMITTED_ADDED_ESCAPES ` +
          `does not permit. Either TipTap's serializer stopped escaping something, or ` +
          `canonicalize started escaping something new.`,
      );
      observedAdded.add(char);
    }

    for (const { char } of removed) {
      assert.ok(
        PERMITTED_REMOVED_ESCAPES.has(char),
        `NEW REMOVED-ESCAPE DIVERGENCE: canonicalize removed an escape before ` +
          `${JSON.stringify(char)} in case "${label}", which PERMITTED_REMOVED_ESCAPES ` +
          `does not permit. Either TipTap's serializer started escaping something, or ` +
          `canonicalize stopped escaping something.`,
      );
      observedRemoved.add(char);
    }

    for (const { kind } of extraBlankLines) {
      assert.ok(
        PERMITTED_EXTRA_BLANK_LINES.has(kind),
        `NEW BLANK-LINE DIVERGENCE: canonicalize removed a blank line ${kind} in case ` +
          `"${label}", which PERMITTED_EXTRA_BLANK_LINES does not permit. Either ` +
          `TipTap's serializer changed its block spacing, or canonicalize started ` +
          `collapsing blank lines somewhere new.`,
      );
      observedBlankLines.add(kind);
    }

    // Whatever differed, canonicalize must not churn further next pass.
    assert.equal(canonicalize(canonical), canonical, 'canonicalize is not stable on TipTap output');
  };

  for (const [label, input] of CASES) {
    await t.test(label, () => {
      try {
        runCase(label, input);
      } catch (error) {
        caseFailures += 1;
        throw error;
      }
    });
  }

  // §0.1: the pin is an EQUALITY for every set, not a containment, at the granularity
  // of containment per case and equality over the union of all cases. Per-case equality
  // is impossible — one node produces only '&', another only '_', only the backslash
  // node produces a removal, and only the multi-paragraph list produces a blank line.
  //
  // The union form deliberately couples this test to the fixture: if the fixture stops
  // producing one of the permitted differences, that is a fixture regression and must
  // fail as one, because a permitted difference nothing exercises is slack that
  // pre-tolerates a future divergence. Each set gets its own message.
  if (caseFailures > 0) return; // incomplete run — see the note above the loop

  for (const [setName, permitted, observed] of [
    ['PERMITTED_ADDED_ESCAPES', PERMITTED_ADDED_ESCAPES, observedAdded],
    ['PERMITTED_REMOVED_ESCAPES', PERMITTED_REMOVED_ESCAPES, observedRemoved],
    ['PERMITTED_EXTRA_BLANK_LINES', PERMITTED_EXTRA_BLANK_LINES, observedBlankLines],
  ]) {
    const unexercised = [...permitted].filter((c) => !observed.has(c)).sort();
    assert.deepEqual(
      unexercised,
      [],
      `FIXTURE REGRESSION (${setName}): permits ${JSON.stringify(unexercised)} but no case ` +
        `in the fixture produces that difference any more. Either restore the ` +
        `construct that exercised it (§5) or remove the entry from ${setName} — a ` +
        `permitted-but-unexercised difference silently tolerates a future divergence.`,
    );

    // Belt and braces: containment is enforced per case and unexercised is empty here,
    // so the two sets are equal. Asserted explicitly so the invariant is legible.
    assert.deepEqual([...observed].sort(), [...permitted].sort(), `${setName} != observed`);
  }
});

test("TipTap's serializer emits the pinned dialect", () => {
  const out = tiptapRoundTrip(CANONICAL_FIXTURE);

  assert.match(out, /\*\*bold text\*\*/, 'strong must be **');
  assert.match(out, /(^|[^*])\*italic text\*/, 'emphasis must be *');
  assert.doesNotMatch(out, /__/, 'no underscore strong');
  assert.doesNotMatch(out, /_underscore italic_/, 'no underscore emphasis');

  for (const line of out.split('\n')) {
    assert.doesNotMatch(line, /^\s*[*+] /, `list marker must be '-': ${JSON.stringify(line)}`);
  }
  assert.match(out, /^- Star bullet with \*\*bold\*\* and \*italic\*$/m);
  assert.match(out, /^- Wide-indent dash bullet/m, 'single space after the marker');

  assert.doesNotMatch(out, /^#/m, 'no headings');
  assert.doesNotMatch(out, /^```/m, 'no fenced code');
  assert.doesNotMatch(out, /^</m, 'no raw HTML blocks');
  assert.doesNotMatch(out, /\n{3,}/, 'no double blank lines');
  assert.equal(out.endsWith('\n'), true, 'newline-terminated like canonicalize()');
  assert.doesNotMatch(out, /\n\n$/, 'exactly one trailing newline');
});

test('the pipeline converges from NON-canonical input in one pass', () => {
  // Feeding raw Markdown to TipTap is not something the app does, but it must not
  // oscillate if it happens. One canonicalize pass after the round trip settles it.
  const once = canonicalize(tiptapRoundTrip(FIXTURE));
  const twice = canonicalize(tiptapRoundTrip(once));
  assert.equal(twice, once, 'raw input does not settle after one round trip');
  assert.doesNotMatch(once, /^\s*\+/m, 'a + marker survived the round trip');
  assert.doesNotMatch(once, /\n{3,}/, 'blank-line run survived the round trip');
});

test('the schema allows exactly doc/paragraph/text/bulletList/listItem + bold/italic/link', () => {
  const schema = getSchema(buildExtensions());
  assert.deepEqual(Object.keys(schema.nodes).sort(), [
    'bulletList',
    'doc',
    'listItem',
    'paragraph',
    'text',
  ]);
  assert.deepEqual(Object.keys(schema.marks).sort(), ['bold', 'italic', 'link']);
});
