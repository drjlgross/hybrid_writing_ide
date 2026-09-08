/**
 * The top row (CLAUDE.md §12).
 *
 *   document name (opens a switcher) · + New Document · Export Transcript ·
 *   View WordWright Doc
 *
 * That order is the spec's, and it is the whole of the global chrome.
 *
 * TWO CONTROLS LEFT THIS ROW in chunk 15's layout pass, each to sit beside what it
 * acts on rather than in a row of everything:
 *
 *   Show/hide history → the History section's own heading (History.js), where it
 *                       also carries the turn count again (F50).
 *   Checkpoint        → the editor's bottom-right (App.js), parallel to the
 *                       Prompt box's Submit: each surface's commit action at its
 *                       own bottom-right. The dirty signal went with it.
 *
 * What remains is load-bearing: THE SWITCHER AND THE NEW-DOCUMENT FIELD ARE
 * DRAWERS, NOT POPOVERS. They push the page down rather than floating over it.
 * §12 wants nothing overlaying the draft, and an absolutely positioned menu is the
 * cheapest way to end up with something that does.
 */

import { useState } from 'react';

import { VIEWER_ADDRESS, documentAddress } from '../../src/addressing.js';
import { h } from './h.js';

/** `2026-08-21T…` → `21 Aug`, or '' when a document has no activity yet. */
function shortDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * @param {{token: string, slug: string, documents: object[], missing?: boolean,
 *   busy?: boolean, turns?: number, onCreate: (slug: string) => void,
 *   onExport: () => void}} props
 */
export function TopBar({
  token,
  slug,
  documents = [],
  missing = false,
  busy = false,
  turns = 0,
  onCreate,
  onExport,
}) {
  // Only one drawer is open at a time: 'switcher' | 'new' | null. Two open at
  // once would push the draft down twice for no reason.
  const [drawer, setDrawer] = useState(null);
  const [wanted, setWanted] = useState('');

  const toggle = (which) => setDrawer((was) => (was === which ? null : which));

  function submitNew(event) {
    event.preventDefault();
    const typed = wanted.trim();
    if (typed === '') return;
    onCreate(typed);
    setWanted('');
    setDrawer(null);
  }

  const button = (key, label, props) =>
    h('button', { key, type: 'button', className: 'top-button', ...props }, label);

  const controls = [
    // The document name IS the switcher (§12). It doubles as the answer to
    // "which document am I in", which the removed status row used to give.
    button('name', slug, {
      className: `top-button doc-name${drawer === 'switcher' ? ' top-button-open' : ''}`,
      'aria-expanded': drawer === 'switcher',
      'aria-label': `Document: ${slug}. Switch document`,
      onClick: () => toggle('switcher'),
    }),

    button('new', '+ New Document', {
      className: `top-button${drawer === 'new' ? ' top-button-open' : ''}`,
      'aria-expanded': drawer === 'new',
      disabled: busy,
      onClick: () => toggle('new'),
    }),

    // §4: the full ledger as JSON. This replaces the raw-JSON link that sat in
    // the removed status row. A document with no turns has no transcript, and
    // saying so on the control beats handing over an empty file.
    missing
      ? null
      : button('export', 'Export Transcript', {
          disabled: turns === 0,
          title:
            turns === 0
              ? 'No turns yet — there is no transcript to export.'
              : `Save all ${turns} turn${turns === 1 ? '' : 's'} as JSON.`,
          onClick: onExport,
        }),

    // §12a's viewer, reachable from the working surface (chunk 15). An ANCHOR, not
    // a button: it goes somewhere, so middle-click, cmd-click and "open in new
    // tab" all work without a handler of ours in the path.
    //
    // NEW TAB, and that is the load-bearing part. Hand edits are uncommitted until
    // Checkpoint (§3), so navigating away in this tab would silently discard
    // whatever is typed and not yet ratified — the exact loss the dirty marker on
    // Checkpoint exists to warn about. The draft stays open behind it, which is
    // also the shape of the task: export a transcript here, read it there.
    //
    // The capability token is in this page's URL, and `rel="noopener"` plus the
    // document-wide `<meta name="referrer" content="no-referrer">` in index.html
    // keep it out of both the opened window's `opener` and its Referer header.
    //
    // Shown even when the slug is missing: it is a global control and it works
    // whether or not this address names a document.
    h(
      'a',
      {
        key: 'viewer',
        className: 'top-button',
        href: VIEWER_ADDRESS,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Open the read-only transcript viewer in a new tab.',
      },
      'View WordWright Doc',
    ),
  ];

  const switcher =
    drawer === 'switcher'
      ? h('div', { key: 'switcher', className: 'top-drawer' }, [
          documents.length > 0
            ? h(
                'ul',
                { key: 'list', className: 'doc-list' },
                documents.map((doc) =>
                  h('li', { key: doc.slug, className: doc.slug === slug ? 'doc doc-current' : 'doc' }, [
                    h(
                      'a',
                      {
                        key: 'a',
                        href: documentAddress(token, doc.slug),
                        'aria-current': doc.slug === slug ? 'page' : undefined,
                      },
                      doc.slug,
                    ),
                    // A file that will not parse stays in the list saying so.
                    // Dropping it would make a document disappear from view
                    // while its bytes are on disk.
                    doc.unreadable
                      ? h('span', { key: 'bad', className: 'doc-meta doc-bad', title: doc.unreadable }, 'unreadable')
                      : h(
                          'span',
                          { key: 'meta', className: 'doc-meta' },
                          `${doc.turns} turn${doc.turns === 1 ? '' : 's'}${
                            shortDate(doc.updated_at) ? ` · ${shortDate(doc.updated_at)}` : ''
                          }`,
                        ),
                  ]),
                ),
              )
            : h('p', { key: 'none', className: 'hint' }, 'No documents here yet.'),

          // §0.5's disclosure is NOT here. Chunk 10 put it in this drawer; F51
          // recorded that as the one §12 change making a §0.5 obligation less
          // prominent, and chunk 11 resolved it by moving the sentence to the
          // masthead, where it is visible without a click. One copy, on the
          // surface — see App.js. This comment is the pointer, not a duplicate.
          h(
            'p',
            { key: 'reach', className: 'hint' },
            'Every document this link reaches is listed above.',
          ),
        ])
      : null;

  const newForm =
    drawer === 'new'
      ? h('form', { key: 'new-form', className: 'top-drawer new-document-form', onSubmit: submitNew }, [
          h('input', {
            key: 'slug',
            autoFocus: true,
            type: 'text',
            value: wanted,
            'aria-label': 'New document name',
            placeholder: 'track-c-post',
            onChange: (event) => setWanted(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') setDrawer(null);
            },
          }),
          h('button', { key: 'create', type: 'submit', className: 'top-button', disabled: busy }, 'Create'),
        ])
      : null;

  return h('div', { className: 'top-row-wrap' }, [
    h('div', { key: 'row', className: 'top-row', role: 'toolbar', 'aria-label': 'Document controls' }, controls),
    switcher,
    newForm,
  ]);
}

export default TopBar;
