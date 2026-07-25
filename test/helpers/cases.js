/**
 * Case generation for the fixed-point and round-trip-identity tests.
 *
 * Splits on TOP-LEVEL MDAST NODES, not on blank lines. Splitting on `\n{2,}` tears
 * any construct that contains a blank line — a list whose item holds two paragraphs
 * came out as three fragments, none of which was the construct — so the intact
 * construct was only ever exercised by the whole-fixture case (F14).
 *
 * Every case is canonical BY CONSTRUCTION: each slice is passed through
 * canonicalize, because a slice of a canonical document is not necessarily
 * canonical itself (the last one carries the document's trailing newline).
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';

import { canonicalize } from '../../src/canonicalize.js';

const parser = unified().use(remarkParse);

/**
 * @param {string} canonical canonical Markdown
 * @returns {[label: string, canonical: string][]} the whole document, then one case
 *   per top-level node
 */
export function canonicalCases(canonical) {
  const tree = parser.parse(canonical);

  const cases = [['whole canonical fixture', canonical]];
  tree.children.forEach((node, index) => {
    const slice = canonical.slice(node.position.start.offset, node.position.end.offset);
    const text = canonicalize(slice);
    const preview = text.slice(0, 42).replace(/\n/g, '⏎');
    cases.push([`node ${index + 1} (${node.type}): ${preview}…`, text]);
  });

  return cases;
}
