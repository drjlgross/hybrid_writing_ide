/**
 * The HTML clipboard fixture (CLAUDE.md §5), separate from the Markdown one.
 *
 * §5 is explicit that the Markdown fixture cannot cover this: a `.md` file can
 * carry the ARTIFACTS of a paste — smart quotes, an em dash, curly apostrophes —
 * but TipTap's paste filtering runs on the HTML clipboard payload, which a `.md`
 * file cannot hold at all.
 *
 * So these are real clipboard payloads: Word's `mso-` styles, `<o:p>` runs,
 * `class=MsoNormal` paragraphs and its `mso-list` fake bullets; Google Docs'
 * `docs-internal-guid` wrapper, its per-run `<span style>` noise, its `<ul>` of
 * `<li><p role=presentation>`, and its `google.com/url?q=` link redirector. Both
 * carry a heading, a table and hyperlinks, because those are what the dialect has
 * to strip and what it has to keep.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

export const WORD_HTML = read('./word.html');
export const GOOGLE_DOCS_HTML = read('./google-docs.html');

/**
 * What each payload must contain, so a gutted fixture fails a test rather than
 * quietly making every assertion below it trivial. Same shape as the Markdown
 * fixture's REQUIRED_CONSTRUCTS, and checked the same way.
 */
export const CLIPBOARD_FIXTURES = [
  {
    source: 'Word',
    html: WORD_HTML,
    required: [
      ['mso- style noise', (s) => /mso-[a-z-]+:/.test(s)],
      ['<o:p> runs', (s) => s.includes('<o:p>')],
      ['class=MsoNormal paragraphs', (s) => s.includes('class=MsoNormal')],
      ['a heading', (s) => /<h1[ >]/.test(s)],
      ['a table', (s) => /<table[ >]/.test(s)],
      ['mso-list fake bullets', (s) => s.includes('mso-list:l0 level1 lfo1')],
      ['a hyperlink', (s) => /<a\s+href="https:\/\/www\.microsoft\.com/.test(s)],
      ['a hyperlink inside a bullet', (s) => /<a\s+href="https:\/\/example\.com\/bulleted"/.test(s)],
      ['bold', (s) => /<b style=/.test(s)],
      ['italic', (s) => /<i\s/.test(s)],
      ['smart quotes and an em dash', (s) => s.includes('&#8220;') && s.includes('&#8212;')],
    ],
    // Prose that must survive the strip, in the order it appears.
    prose: [
      'A Heading Word Insists On',
      'Word wraps every run in a span.',
      'A pasted hyperlink follows:',
      'First Word bullet',
      'Second Word bullet',
      'Table cell one',
      'Table cell two',
      'Closing Word paragraph after the table.',
    ],
    links: [
      ['Microsoft Word', 'https://www.microsoft.com/en-us/microsoft-365/word'],
      ['bulleted link', 'https://example.com/bulleted'],
    ],
    bold: 'bold text',
    italic: 'italic text',
  },
  {
    source: 'Google Docs',
    html: GOOGLE_DOCS_HTML,
    required: [
      ['the docs-internal-guid wrapper', (s) => s.includes('id="docs-internal-guid-')],
      // The one that matters most: the whole payload is inside a <b>.
      ['a <b> wrapper with font-weight:normal', (s) => s.includes('<b style="font-weight:normal;"')],
      ['per-run span styling', (s) => /<span style="font-size:11pt;font-family:Arial/.test(s)],
      ['a heading', (s) => /<h2[ >]/.test(s)],
      ['a table', (s) => /<table[ >]/.test(s)],
      ['a real <ul> list', (s) => s.includes('<ul style=') && s.includes('<li dir="ltr"')],
      ['the google.com/url redirector on links', (s) => s.includes('href="https://www.google.com/url?q=')],
      ['bold as font-weight:700', (s) => s.includes('font-weight:700')],
      ['italic as font-style:italic', (s) => s.includes('font-style:italic')],
      ['curly apostrophes and single quotes', (s) => s.includes('&rsquo;') && s.includes('&lsquo;')],
    ],
    prose: [
      'A Heading Google Docs Insists On',
      'Google Docs wraps the whole payload in a b tag',
      'A pasted hyperlink follows:',
      'First Docs bullet, a real list item',
      'Second Docs bullet',
      'Docs cell one',
      'Docs cell two',
      'Closing Docs paragraph after the table.',
    ],
    links: [
      ['Google Docs', 'https://www.google.com/url?q=https://docs.google.com/document/d/1AbC_dEf-23/edit'],
      ['bulleted link', 'https://www.google.com/url?q=https://example.org/inner'],
    ],
    bold: 'bold text',
    italic: 'italic text',
  },
];

/** The whole v1 dialect (§1). Nothing else may survive a paste. */
export const DIALECT_NODES = new Set(['doc', 'paragraph', 'text', 'bulletList', 'listItem']);
export const DIALECT_MARKS = new Set(['bold', 'italic', 'link']);
