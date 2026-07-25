/**
 * The shared fixture (CLAUDE.md §5). One file, used by the canonicalize tests and
 * — from chunk 2 on — by the TipTap round-trip test.
 *
 * It deliberately contains non-canonical Markdown (underscore emphasis, `*`
 * bullets, wide list indents, trailing whitespace, stacked blank lines) so
 * canonicalize() has real work to do, plus every escaping trap §5 names.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE_PATH = fileURLToPath(
  new URL('./draft-fixture.md', import.meta.url),
);

export const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8');

/**
 * Constructs §5 requires the fixture to cover, as [label, predicate] pairs, so a
 * gutted fixture fails a test instead of silently passing every other one.
 */
export const REQUIRED_CONSTRUCTS = [
  ['bold', (s) => /\*\*bold text\*\*/.test(s)],
  ['italic', (s) => /(^|[^*])\*italic text\*/.test(s)],
  ['bullet list', (s) => /^[-*] /m.test(s)],
  ['two adjacent bullet lists', (s) => {
    const blocks = s.split(/\n{2,}/).filter((b) => b.trim() !== '');
    return blocks.some(
      (b, i) => /^\* /.test(b) && blocks[i + 1] !== undefined && /^-\s/.test(blocks[i + 1]),
    );
  }],
  ['inline link', (s) => /\[link to the docs\]\(https:\/\/example\.com\/docs/.test(s)],
  ['bare URL', (s) => /(^|\s)https:\/\/example\.com\/bare\/url(\s|$)/.test(s)],
  ['literal asterisk in prose', (s) => /a \\?\* b/.test(s)],
  ['underscored identifier', (s) => /snake\\?_case\\?_name/.test(s)],
  ['percent sign', (s) => /100%/.test(s)],
  ['Word paste (smart quotes / em dash / ellipsis / nbsp)', (s) =>
    /[\u201c\u201d]/.test(s) && s.includes('\u2014') && s.includes('\u2026') && s.includes('\u00a0')],
  ['Word paste hyperlink', (s) => /\[Microsoft Word\]\(https:\/\/www\.microsoft\.com/.test(s)],
  ['Google Docs paste (curly apostrophe / single quotes)', (s) =>
    s.includes('\u2019') && /[\u2018\u2019]single curly quotes/.test(s)],
  ['Google Docs paste hyperlink', (s) => /\[Google Docs\]\(https:\/\/docs\.google\.com/.test(s)],
  ['underscore emphasis to normalize', (s) => /_underscore italic_/.test(s)],
  ['underscore strong to normalize', (s) => /__underscore strong__/.test(s)],
  ['star bullets to normalize', (s) => /^\* /m.test(s)],
  ['wide list indent to normalize', (s) => /^- {2,}\S/m.test(s)],
  ['trailing whitespace to normalize', (s) => /[^\S\n]\n/.test(s)],
  ['stacked blank lines to normalize', (s) => /\n{3,}/.test(s)],
  ['stray underscore', (s) => /underscore _ standing alone/.test(s)],
  ['link target with parentheses', (s) => /\(https:\/\/example\.com\/a_\(b\)\)/.test(s)],
];
