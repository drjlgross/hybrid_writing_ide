/**
 * CLAUDE.md §0.1 — round-trip identity. Chunk 2 item 1.
 *
 *     canonicalize(tiptapSerialize(tiptapParse(canonical))) === canonical
 *
 * Canonical → TipTap → canonical, byte-identical. This is the property the store
 * actually depends on: a human turn that changed nothing must produce no diff, or
 * the history view fills with phantom diffs and the product is dead.
 *
 * Distinct from the fixed-point test next door, which compares TipTap's output to
 * its own canonicalization and tolerates added escapes. This one is an equality
 * against the fixture, with no tolerance of any kind.
 *
 * Cases come from the shared generator, which splits on top-level mdast nodes and
 * canonicalizes each slice, so every input is canonical by construction and no
 * construct containing a blank line is torn apart (F14).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../src/canonicalize.js';
import { FIXTURE } from './fixtures/index.js';
import { canonicalCases } from './helpers/cases.js';
import { tiptapRoundTrip } from './helpers/headless-editor.js';

const CASES = canonicalCases(canonicalize(FIXTURE));

test('round-trip identity: canonical → TipTap → canonical is byte-identical', async (t) => {
  for (const [label, canonical] of CASES) {
    await t.test(label, () => {
      const returned = canonicalize(tiptapRoundTrip(canonical));

      if (returned !== canonical) {
        const want = canonical.split('\n');
        const got = returned.split('\n');
        const lines = [];
        for (let i = 0; i < Math.max(want.length, got.length); i += 1) {
          if (want[i] !== got[i]) {
            lines.push(
              `  line ${i + 1}\n    want: ${JSON.stringify(want[i])}\n    got : ${JSON.stringify(got[i])}`,
            );
          }
        }
        assert.fail(
          `ROUND-TRIP IDENTITY BROKEN in case "${label}". A human turn that changed ` +
            'nothing would produce a diff here. Name the construct before changing ' +
            'anything — a canonicalize-side fix is a §0.1 collision.\n' +
            lines.join('\n'),
        );
      }
    });
  }
});

test('round-trip identity holds for degenerate drafts', () => {
  // Not §5 fixture cases; an empty or near-empty draft is the state the app starts
  // in, so it must not churn either.
  for (const raw of ['', '   \n\n  \n', 'word\n']) {
    const canonical = canonicalize(raw);
    assert.equal(
      canonicalize(tiptapRoundTrip(canonical)),
      canonical,
      `degenerate input ${JSON.stringify(raw)} does not round-trip`,
    );
  }
});
