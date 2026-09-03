/**
 * Word-level diffs between snapshots (CLAUDE.md §5).
 *
 * Diffs are computed on demand and never stored — a snapshot pair is the source
 * of truth, and a stored diff is one more thing that can drift from the text.
 *
 * §2.1 item 2 is what this exists for: the model receives the current draft on
 * every call regardless, but it cannot see WHAT the human just changed unless the
 * diff is sent. Without it, "don't undo my edits" is an instruction the model has
 * no way to follow.
 */

import { diffWords } from 'diff';

/**
 * Word-level diff between two snapshots.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{added?: boolean, removed?: boolean, value: string}[]}
 */
export function wordDiff(before, after) {
  return diffWords(before ?? '', after ?? '');
}

/**
 * How much of a contiguous region must have changed before it renders as a
 * deletion block followed by an addition block rather than as interleaved
 * word-level marks (§4).
 *
 * These three constants are one decision in three parts, and all three are
 * load-bearing. The failure they exist for is REAL and is in the ledger: turn
 * 10 → 11 of the first live session replaced a whole trailing paragraph, and
 * because the old text and the new text shared incidental words — "a", "is",
 * ".", "-" — `diffWords` stitched ten alternating delete/add pairs through the
 * new prose. The pattern was `=-+=-+=-+=-+=-+=-+=-+=-+=-+=+`. Every mark was
 * correct and the whole thing was unreadable.
 *
 * BLOCK_THRESHOLD — the changed fraction, by characters, above which a region
 * is a replacement rather than an edit. Half is the natural place: below it the
 * unchanged text is the majority and is what gives the marks their context;
 * above it the "unchanged" text is punctuation and articles, and it is the
 * changed text that carries the meaning. The live case sits at 0.97.
 *
 * BLOCK_MIN_CHARS — a floor, because changed fraction alone is not enough. A
 * two-word swap in the middle of an untouched sentence is 100% changed within
 * its own tiny region, and blocking it would turn the single clearest case
 * word-level diffs handle well into two paragraphs. The live session has five
 * such edits in turn 17 and every one of them must stay inline.
 *
 * ANCHOR_MIN_CHARS — what counts as unchanged text that ENDS a region rather
 * than sitting inside one. `". "` between two rewritten sentences is not a
 * shared passage, it is a coincidence; a whole untouched sentence is a real
 * boundary. Without this every diff is one region and an untouched opening
 * paragraph gets swept into a replacement block.
 */
export const BLOCK_THRESHOLD = 0.5;
export const BLOCK_MIN_CHARS = 120;
export const ANCHOR_MIN_CHARS = 24;

/**
 * Group a word-level diff into regions, marking the ones that are wholesale
 * replacements (§4).
 *
 * Returns a list of regions, each either:
 *
 *   {type: 'inline', parts}                — render as word-level marks, as before
 *   {type: 'replacement', removed, added}  — render a deletion block, then an
 *                                            addition block
 *
 * A replacement region loses no content: `removed` is every removed and
 * unchanged part in order, `added` is every added and unchanged part in order,
 * so the two strings reconstruct that region's before-text and after-text —
 * exactly, up to whitespace.
 *
 * The whitespace caveat is inherited, not introduced. `diffWords` treats runs of
 * whitespace as ignorable and an equal chunk may carry the spacing of either
 * side, so concatenating the non-added parts of a plain word diff already fails
 * to rebuild the input byte-for-byte. The live turn 10 → 11 case differs from its
 * source in exactly one character — a trailing newline rendered as a space — on
 * the old inline path as much as on this one. Every word is present on the
 * correct side either way, which is what §4 needs: this changes how a change is
 * shown and never whether it is shown.
 *
 * Blocking requires all three of:
 *
 *   1. the region contains BOTH an addition and a deletion. A pure insertion has
 *      no interleaving to fix, and blocking it would only add a paragraph break.
 *   2. the changed fraction is at least BLOCK_THRESHOLD.
 *   3. at least BLOCK_MIN_CHARS actually changed.
 *
 * @param {{added?: boolean, removed?: boolean, value: string}[]} parts
 * @param {{threshold?: number, minChars?: number, anchorChars?: number}} [options]
 */
export function groupDiffRegions(parts, options = {}) {
  const {
    threshold = BLOCK_THRESHOLD,
    minChars = BLOCK_MIN_CHARS,
    anchorChars = ANCHOR_MIN_CHARS,
  } = options;

  // 1. Split on anchors — long unchanged runs, which are real shared passages.
  //    Anchors are regions of their own, so they always render as plain text.
  const regions = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) regions.push(current);
    current = [];
  };

  for (const part of parts) {
    const unchanged = !part.added && !part.removed;
    if (unchanged && part.value.trim().length >= anchorChars) {
      flush();
      regions.push([part]);
      continue;
    }
    current.push(part);
  }
  flush();

  // 2. Decide each region.
  return regions.map((region) => {
    const removedChars = sumChars(region, (p) => p.removed);
    const addedChars = sumChars(region, (p) => p.added);
    const sameChars = sumChars(region, (p) => !p.added && !p.removed);
    const changed = removedChars + addedChars;
    const total = changed + sameChars;

    const isReplacement =
      removedChars > 0 &&
      addedChars > 0 &&
      changed >= minChars &&
      total > 0 &&
      changed / total >= threshold;

    if (!isReplacement) return { type: 'inline', parts: region };

    return {
      type: 'replacement',
      removed: region.filter((p) => !p.added).map((p) => p.value).join(''),
      added: region.filter((p) => !p.removed).map((p) => p.value).join(''),
    };
  });
}

const sumChars = (region, predicate) =>
  region.reduce((total, part) => (predicate(part) ? total + part.value.length : total), 0);

/** True when the two snapshots differ at all. */
export function hasChanges(before, after) {
  return wordDiff(before, after).some((part) => part.added || part.removed);
}

/**
 * Render a diff for the API payload (§2.1 item 2).
 *
 * Plain text rather than a patch format: the model reads prose better than it
 * reads unified diff hunks, and the goal is for it to understand which words are
 * the human's, not to apply the patch.
 *
 * @param {string} before
 * @param {string} after
 * @returns {string|null} null when nothing changed
 */
export function formatDiffForPrompt(before, after) {
  const parts = wordDiff(before, after);
  if (!parts.some((part) => part.added || part.removed)) return null;

  const lines = [];
  for (const part of parts) {
    const value = part.value.trim();
    if (value === '') continue;
    if (part.added) lines.push(`ADDED BY THE HUMAN: ${JSON.stringify(value)}`);
    else if (part.removed) lines.push(`REMOVED BY THE HUMAN: ${JSON.stringify(value)}`);
  }

  return lines.length === 0 ? null : lines.join('\n');
}
