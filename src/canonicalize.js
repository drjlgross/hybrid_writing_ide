/**
 * The one canonical Markdown dialect (CLAUDE.md §0.1).
 *
 * Every Markdown string entering the snapshot store — whether it came from the
 * TipTap serializer or straight out of the model — passes through here first, so
 * the history view shows real edits instead of serialization trivia.
 *
 * No GFM: no tables, no strikethrough, no autolink literals. A bare URL stays
 * plain text at this layer.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

/** Pinned per §0.1. Changing any of these rewrites every future diff. */
export const STRINGIFY_OPTIONS = {
  emphasis: '*',
  strong: '*',
  bullet: '-',
  listItemIndent: 'one',
  rule: '-',
  fences: true,
  incrementListMarker: false,
  resourceLink: false,
  tightDefinitions: true,
  bulletOther: '+',
};

/**
 * Merge adjacent same-type lists into one (§0.1).
 *
 * Without this, remark-stringify switches to `bulletOther` ('+') to keep two
 * adjacent lists distinct, which violates `bullet: '-'`. The distinction is
 * unrepresentable end-to-end anyway — Markdown cannot express two adjacent lists
 * and TipTap cannot hold them apart — so the lists become one. This is an
 * authorized content change, not a formatting tweak.
 *
 * @param {{ children?: unknown[] }} node
 */
function mergeAdjacentListsIn(node) {
  if (!Array.isArray(node.children)) return;

  const kept = [];
  for (const child of node.children) {
    const prev = kept[kept.length - 1];
    const mergeable =
      prev !== undefined &&
      prev.type === 'list' &&
      child.type === 'list' &&
      Boolean(prev.ordered) === Boolean(child.ordered);

    if (mergeable) {
      prev.children.push(...child.children);
      if (prev.position && child.position) {
        prev.position = { start: prev.position.start, end: child.position.end };
      }
      continue;
    }
    kept.push(child);
  }

  node.children = kept;

  for (const child of kept) {
    // Tight lists, per §0.1. Only the list's own spread is cleared, never a list
    // item's — §0.1 is explicit that an item holding two paragraphs must keep the
    // blank line between them.
    if (child.type === 'list') child.spread = false;
    mergeAdjacentListsIn(child);
  }
}

/** @returns {(tree: object) => void} */
function remarkMergeAdjacentLists() {
  return (tree) => mergeAdjacentListsIn(tree);
}

const processor = unified()
  .use(remarkParse)
  .use(remarkMergeAdjacentLists)
  .use(remarkStringify, STRINGIFY_OPTIONS)
  .freeze();

/**
 * Normalize a Markdown string into the canonical dialect.
 *
 * Idempotent: canonicalize(canonicalize(x)) === canonicalize(x).
 *
 * @param {string} md
 * @returns {string} canonical Markdown, always newline-terminated (or '' when empty)
 */
export function canonicalize(md) {
  if (typeof md !== 'string') {
    throw new TypeError(`canonicalize expects a string, got ${typeof md}`);
  }

  // Normalize CRLF and lone CR to LF before parsing, so a Windows paste does not
  // survive as a difference in the store.
  const input = md.replace(/\r\n?/g, '\n');

  const out = String(processor.processSync(input));

  // remark already emits a single trailing newline; belt and braces so the
  // store never holds two variants of "same text, different tail".
  const trimmed = out.replace(/\n+$/, '');
  return trimmed === '' ? '' : `${trimmed}\n`;
}

export default canonicalize;
