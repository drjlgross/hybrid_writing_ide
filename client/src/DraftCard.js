/**
 * The Current Draft card, at the top of a loaded transcript (`/view`).
 *
 * The bottom line, up front. A transcript is a record of how a text got made, and
 * the thing a reader most often wants from one is the text itself — reconstructing
 * it by scrolling to the oldest entry and reading forward is work nobody should
 * have to do to see where a draft ended up.
 *
 * WHICH TEXT. The last turn's `snapshot`, and only ever that. §0.3 asserts
 * `history[history.length - 1].snapshot === currentWorkingDraft` on every commit,
 * so the final snapshot IS the draft as it stood when the transcript was exported.
 * Nothing here recomputes or reassembles it: full snapshots exist (§0.4) precisely
 * so a reader never has to replay a chain of patches to find out what the text is.
 *
 * WHY A REAL TIPTAP EDITOR, in a page whose whole promise is that it edits nothing:
 *
 *   - It is the SAME renderer the app draws the live draft with, built from the
 *     same `buildExtensions()` the round-trip tests run against. A hand-rolled
 *     Markdown-to-HTML pass would be a second renderer, free to disagree with the
 *     editor about what a draft looks like — the exact class of drift §0.1 exists
 *     to prevent, one layer up.
 *   - The §1 dialect comes with it. Anything outside bold, italic, bullets and
 *     links is stripped by the extension list rather than by a rule written here,
 *     and `LINK_OPTIONS` brings the `javascript:` href guard along unchanged.
 *   - It costs no bundle weight: TipTap is already in this bundle for the app.
 *
 * `editable: false` is set at construction. Read-only here means the document
 * cannot take a caret at all — not a disabled control, not a CSS overlay.
 */

import { useEffect, useRef } from 'react';
import { Editor } from '@tiptap/core';

import { buildExtensions } from '../../src/tiptap-config.js';
import { h } from './h.js';

/**
 * @param {{markdown: string, createEditor?: (element: HTMLElement, markdown: string) => object}} props
 *   `createEditor` is injected by the headless tests, which mount TipTap into
 *   jsdom themselves. The page passes none.
 */
export function DraftCard({ markdown = '', createEditor }) {
  const mountRef = useRef(null);

  useEffect(() => {
    const element = mountRef.current;
    if (!element) return undefined;

    const instance = createEditor
      ? createEditor(element, markdown)
      : new Editor({
          element,
          extensions: buildExtensions(),
          content: markdown,
          editable: false,
        });

    // Rebuilt rather than mutated when a different transcript is opened: a
    // `setContent` on a stale instance is how one file's text ends up under
    // another file's heading.
    return () => instance.destroy();
  }, [markdown, createEditor]);

  const empty = typeof markdown !== 'string' || markdown.trim() === '';

  return h('section', { className: 'draft-card', 'aria-label': 'The current draft' }, [
    h('div', { key: 'head', className: 'draft-card-head' }, [
      h('h2', { key: 'h' }, 'Current Draft'),
      h(
        'p',
        { key: 'note', className: 'hint' },
        'The text as it stood at the end of this session — the last turn’s snapshot, ' +
          'exactly as recorded. Select and copy from here.',
      ),
    ]),

    // The mount point is always in the tree, even when the draft is empty, so the
    // effect above has somewhere to build into on the first render.
    h('div', { key: 'mount', ref: mountRef, className: 'draft-render', hidden: empty }),

    // An empty final snapshot is a real state — a session whose last turn cleared
    // the draft — and it must not read as a rendering failure.
    empty
      ? h('p', { key: 'empty', className: 'hint draft-empty' }, 'The draft was empty at the end of this session.')
      : null,
  ]);
}

export default DraftCard;
