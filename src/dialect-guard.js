/**
 * Out-of-dialect construct check (CLAUDE.md §2.3).
 *
 * The model can emit any Markdown it likes. Anything outside the v1 dialect
 * survives canonicalize and then vanishes the next time the draft passes through
 * TipTap, which has no node for it — undetectable content loss. So: strip the
 * construct, keep its text, and record what was stripped as structured counts.
 *
 * The rule §2.3 sets is that loss is VISIBLE, not that it is prevented.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';

import { STRINGIFY_OPTIONS } from './canonicalize.js';

/** The dialect: §1 formatting plus the mdast nodes that carry it. */
export const ALLOWED_TYPES = new Set([
  'root',
  'paragraph',
  'text',
  'list',
  'listItem',
  'strong',
  'emphasis',
  'link',
]);

/** Singular labels for the warning string. All pluralize with a trailing 's'. */
const LABELS = {
  heading: 'heading',
  blockquote: 'blockquote',
  code: 'code block',
  inlineCode: 'inline code span',
  thematicBreak: 'thematic break',
  html: 'HTML block',
  image: 'image',
  imageReference: 'image reference',
  linkReference: 'link reference',
  definition: 'link definition',
  footnoteDefinition: 'footnote',
  footnoteReference: 'footnote marker',
  break: 'hard break',
  orderedList: 'ordered list',
  table: 'table',
};

const parser = unified().use(remarkParse);
const stringifier = unified().use(remarkStringify, STRINGIFY_OPTIONS);

const textNode = (value) => ({ type: 'text', value });

/**
 * Tables never reach the parser as tables — §0.1 forbids GFM, so remark reads a
 * table as a paragraph of pipe-separated text. Detect them on the source text
 * instead, strip the pipes so the cells survive as prose, and count them.
 *
 * Heuristic by necessity, and it can false-positive on a paragraph that happens
 * to be pipe-separated with a dashed line under it. Reported as a finding.
 */
function stripTables(markdown) {
  const blocks = markdown.split(/(\n{2,})/);
  let count = 0;

  const rewritten = blocks.map((block) => {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length < 2) return block;

    const isRow = (line) => (line.match(/\|/g) ?? []).length >= 1 && /\S/.test(line);
    const isDelimiter = (line) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('|');

    if (!lines.every(isRow) || !lines.some(isDelimiter)) return block;

    count += 1;
    return lines
      .filter((line) => !isDelimiter(line))
      .map((line) =>
        line
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(' '),
      )
      .join('\n');
  });

  return { markdown: rewritten.join(''), count };
}

/** Rewrite one node into dialect-legal nodes, or null to drop it entirely. */
function rewrite(node, counts) {
  const bump = (key) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };

  switch (node.type) {
    case 'heading':
      bump('heading');
      return [{ type: 'paragraph', children: node.children }];

    case 'blockquote':
      bump('blockquote');
      return node.children; // hoist the prose into the parent

    case 'code':
      bump('code');
      return node.value ? [{ type: 'paragraph', children: [textNode(node.value)] }] : [];

    case 'inlineCode':
      bump('inlineCode');
      return [textNode(node.value)];

    case 'thematicBreak':
      bump('thematicBreak');
      return []; // carries no text to keep

    case 'html':
      bump('html');
      return [];

    case 'image':
    case 'imageReference':
      bump(node.type);
      return node.alt ? [textNode(node.alt)] : [];

    case 'linkReference':
      bump('linkReference');
      return node.children ?? [];

    case 'definition':
      bump('definition');
      return [];

    case 'footnoteDefinition':
      bump('footnoteDefinition');
      return node.children ?? [];

    case 'footnoteReference':
      bump('footnoteReference');
      return [];

    case 'break':
      bump('break');
      return [textNode(' ')];

    case 'list':
      if (node.ordered) {
        bump('orderedList');
        return [{ ...node, ordered: false, start: null }];
      }
      return [node];

    default:
      return [node];
  }
}

const isAllowed = (node) =>
  ALLOWED_TYPES.has(node.type) && !(node.type === 'list' && node.ordered);

/**
 * Rewrite a child list until every entry is in the dialect.
 *
 * A rewrite's OUTPUT is re-checked rather than trusted: hoisting a blockquote's
 * children moves whatever was inside it up a level, and a heading inside a
 * blockquote would otherwise land in the tree unexamined and uncounted.
 * Terminates because every rewrite produces either allowed nodes or nodes
 * strictly closer to being allowed.
 */
function normalizeChildren(children, counts) {
  const kept = [];
  const queue = [...children];

  while (queue.length > 0) {
    const child = queue.shift();
    if (isAllowed(child)) {
      kept.push(child);
      continue;
    }
    queue.unshift(...rewrite(child, counts));
  }

  return kept;
}

/** Depth-first, so a stripped construct's children are also checked. */
function walk(node, counts) {
  if (!Array.isArray(node.children)) return;

  node.children = normalizeChildren(node.children, counts);
  for (const child of node.children) walk(child, counts);
}

/**
 * Format the §2.3 warning: "stripped: 2 headings, 1 blockquote, 1 table".
 * A generic message is explicitly not sufficient, so every type is named with
 * its count, ordered by count then alphabetically for stability.
 */
export function formatStrippedWarning(counts) {
  const parts = Object.entries(counts)
    .sort(([aKey, aCount], [bKey, bCount]) => bCount - aCount || aKey.localeCompare(bKey))
    .map(([key, count]) => {
      const label = LABELS[key] ?? key;
      return `${count} ${label}${count === 1 ? '' : 's'}`;
    });
  return parts.length === 0 ? null : `stripped: ${parts.join(', ')}`;
}

/**
 * Strip every construct outside the v1 dialect, keeping its text content.
 *
 * @param {string} markdown
 * @returns {{markdown: string, stripped: Record<string, number>, warning: string|null}}
 *   `stripped` is the structured data §2.3 requires on the turn — counts keyed by
 *   construct, not only a formatted string.
 */
export function stripOutOfDialect(markdown) {
  const counts = {};

  const tables = stripTables(markdown);
  if (tables.count > 0) counts.table = tables.count;

  const tree = parser.parse(tables.markdown);
  walk(tree, counts);

  return {
    markdown: String(stringifier.stringify(tree)),
    stripped: counts,
    warning: formatStrippedWarning(counts),
  };
}
