/**
 * CLAUDE.md §0.1 test 2 — "TipTap is a fixed point":
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
 * KNOWN DEVIATION (reported, deliberate): strict byte equality does not hold, and
 * cannot be reached from the TipTap side. remark-stringify escapes conservatively
 * (`snake\_case\_name`, `?a=1\&b=2`); tiptap-markdown's prosemirror-markdown
 * serializer does not, and exposes no option to make it. So this file asserts a
 * fixed point up to added backslashes, and pins the divergence to exactly that:
 *   - structure and markers must match byte-for-byte,
 *   - the only permitted difference is backslashes canonicalize ADDS before `_`
 *     or `&`,
 *   - canonicalize must be stable on TipTap's output.
 * Any marker, indent, or structural drift from a TipTap upgrade still fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getSchema } from '@tiptap/core';

import { canonicalize } from '../src/canonicalize.js';
import { buildExtensions } from '../src/tiptap-config.js';
import { FIXTURE } from './fixtures/index.js';
import { tiptapRoundTrip } from './helpers/headless-editor.js';

/** Characters canonicalize() is allowed to escape that TipTap leaves bare. */
const PERMITTED_ADDED_ESCAPES = new Set(['_', '&']);

/**
 * Assert that `canonical` is `tiptapOut` with nothing changed except added
 * backslashes, and return which characters those backslashes were added before.
 *
 * Deliberately does NOT consult the allowlist: that separation is what lets a
 * structural change (marker or indent drift) and an unpermitted escape character
 * produce different failure messages. Gating the walk on the allowlist collapses
 * both into one message and makes the caller's check unreachable.
 *
 * @returns {{char: string, index: number}[]} the escapes canonicalize added
 */
function diffOnlyAddedEscapes(tiptapOut, canonical, label) {
  const added = [];
  let i = 0;
  let j = 0;
  while (i < tiptapOut.length || j < canonical.length) {
    if (tiptapOut[i] === canonical[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // An inserted escape: canonical has a backslash TipTap does not, and the very
    // next canonical character is the one TipTap is sitting on.
    if (canonical[j] === '\\' && canonical[j + 1] !== undefined && tiptapOut[i] === canonical[j + 1]) {
      added.push({ char: canonical[j + 1], index: j });
      j += 1;
      continue;
    }
    assert.fail(
      `STRUCTURAL DIVERGENCE in case "${label}": TipTap output and its ` +
        'canonicalization differ by something other than an added escape. A marker, ' +
        'list indent, or blank-line change — check the pinned STRINGIFY_OPTIONS and ' +
        'MARKDOWN_OPTIONS against each other.\n' +
        `  at tiptap[${i}] / canonical[${j}]\n` +
        `  tiptap:    ${JSON.stringify(tiptapOut.slice(Math.max(0, i - 40), i + 40))}\n` +
        `  canonical: ${JSON.stringify(canonical.slice(Math.max(0, j - 40), j + 40))}`,
    );
  }
  return added;
}

const CANONICAL_FIXTURE = canonicalize(FIXTURE);

const CASES = [
  ['whole canonical fixture', CANONICAL_FIXTURE],
  ...CANONICAL_FIXTURE.split(/\n{2,}/)
    .filter((b) => b.trim() !== '')
    .map((b, i) => [`canonical block ${i + 1}: ${b.slice(0, 42).replace(/\n/g, '⏎')}…`, b]),
];

test('TipTap is a fixed point of canonicalize, up to added escapes', async (t) => {
  const observed = new Set();

  for (const [label, input] of CASES) {
    await t.test(label, () => {
      const tiptapOut = tiptapRoundTrip(input);
      const canonical = canonicalize(tiptapOut);

      const added = diffOnlyAddedEscapes(tiptapOut, canonical, label);
      for (const { char } of added) {
        assert.ok(
          PERMITTED_ADDED_ESCAPES.has(char),
          `NEW DIVERGENCE: canonicalize added an escape before ${JSON.stringify(char)} in ` +
            `case "${label}", which the allowlist does not permit. Either TipTap's ` +
            `serializer changed, or canonicalize started escaping something new.`,
        );
        observed.add(char);
      }

      // Whatever escapes were added, canonicalize must not add more next pass.
      assert.equal(canonicalize(canonical), canonical, 'canonicalize is not stable on TipTap output');
    });
  }

  // §0.1 requires the pin to be an EQUALITY, not a containment. Per case that is
  // impossible — canonical block 1 produces only '&' (a link destination) and block 4
  // produces only '_' (snake_case_name) — so the pin is:
  //   containment per case (asserted above, fails fast and names the case), and
  //   equality over the UNION of all cases (asserted here).
  //
  // The union form deliberately couples this test to the fixture: if the fixture stops
  // producing one of the permitted characters, that is a fixture regression and must
  // fail, because a permitted character nothing exercises is slack that pre-tolerates
  // a future divergence. The two directions therefore get distinct messages.
  const unexercised = [...PERMITTED_ADDED_ESCAPES].filter((c) => !observed.has(c)).sort();
  assert.deepEqual(
    unexercised,
    [],
    `FIXTURE REGRESSION: the allowlist permits ${JSON.stringify(unexercised)} but no case ` +
      `in the fixture produces that escape any more. Either restore the construct that ` +
      `exercised it (§5) or remove the character from PERMITTED_ADDED_ESCAPES — a ` +
      `permitted-but-unexercised character silently tolerates a future divergence.`,
  );

  // Belt and braces: observed ⊆ permitted is enforced per case, unexercised is empty
  // here, so the two sets are equal. Asserted explicitly so the invariant is legible.
  assert.deepEqual([...observed].sort(), [...PERMITTED_ADDED_ESCAPES].sort());
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
