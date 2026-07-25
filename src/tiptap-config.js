/**
 * The single TipTap configuration (CLAUDE.md §1, §5).
 *
 * Allowed marks/nodes: bold, italic, bullet list, link. Nothing else — no
 * headings, no code blocks, no tables, no strikethrough, no hard breaks.
 *
 * Serializer options are chosen to match src/canonicalize.js, per §0.1: when the
 * fixed-point test fails, this file moves, not the canonicalizer.
 */

import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import BulletList from '@tiptap/extension-bullet-list';
import ListItem from '@tiptap/extension-list-item';
import Link from '@tiptap/extension-link';
import { Markdown } from 'tiptap-markdown';

/** Markdown extension options, pinned to agree with STRINGIFY_OPTIONS. */
export const MARKDOWN_OPTIONS = {
  html: false, // raw HTML is not part of the dialect; drop it on paste
  tightLists: true,
  bulletListMarker: '-', // matches bullet: '-'
  linkify: false, // bare URLs stay plain text, as in canonicalize()
  breaks: false, // no hard breaks in the dialect
  transformPastedText: false,
  transformCopiedText: true,
};

export const LINK_OPTIONS = {
  autolink: false, // §5: autolink OFF in v1, link-on-paste ON
  linkOnPaste: true,
  openOnClick: false,
  protocols: ['http', 'https', 'mailto'],
};

/** The extension list. Order matters only for extension priority, not output. */
export function buildExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    BulletList,
    ListItem,
    Link.configure(LINK_OPTIONS),
    Markdown.configure(MARKDOWN_OPTIONS),
  ];
}

export default buildExtensions;
