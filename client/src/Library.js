/**
 * The documents in this namespace, and the way to make another one (§0.5).
 *
 * Scope is the whole point here. This list holds exactly what one capability
 * token addresses; there is no call that reaches another namespace and no UI that
 * hints one exists. A token is a filing system for a small group of known people,
 * not access control, and the list is a filing cabinet drawer, not a directory of
 * everyone's work.
 */

import { useState } from 'react';

import { documentAddress } from '../../src/addressing.js';
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
 * @param {{documents: Array<object>, token: string, slug: string,
 *   busy?: boolean, onCreate: (slug: string) => void}} props
 */
export function Library({ documents, token, slug, busy = false, onCreate }) {
  const [draftSlug, setDraftSlug] = useState('');
  const [open, setOpen] = useState(false);

  function submit(event) {
    event.preventDefault();
    const wanted = draftSlug.trim();
    if (wanted === '') return;
    onCreate(wanted);
    setDraftSlug('');
    setOpen(false);
  }

  const items = documents.map((doc) =>
    h(
      'li',
      { key: doc.slug, className: doc.slug === slug ? 'doc doc-current' : 'doc' },
      [
        h(
          'a',
          { key: 'a', href: documentAddress(token, doc.slug), 'aria-current': doc.slug === slug ? 'page' : undefined },
          doc.slug,
        ),
        // A file that will not parse stays in the list saying so. Dropping it
        // would make a document disappear from view while its bytes are on disk.
        doc.unreadable
          ? h('span', { key: 'bad', className: 'doc-meta doc-bad', title: doc.unreadable }, 'unreadable')
          : h(
              'span',
              { key: 'meta', className: 'doc-meta' },
              `${doc.turns} turn${doc.turns === 1 ? '' : 's'}${
                shortDate(doc.updated_at) ? ` · ${shortDate(doc.updated_at)}` : ''
              }`,
            ),
      ],
    ),
  );

  return h('nav', { className: 'library', 'aria-label': 'Documents in this namespace' }, [
    h('div', { key: 'head', className: 'library-head' }, [
      h('h2', { key: 'h' }, 'Documents'),
      h(
        'button',
        {
          key: 'new',
          type: 'button',
          className: 'tool',
          disabled: busy,
          onClick: () => setOpen((was) => !was),
          'aria-expanded': open,
        },
        open ? 'Cancel' : '+ New document',
      ),
    ]),

    open
      ? h('form', { key: 'form', className: 'library-form', onSubmit: submit }, [
          h('input', {
            key: 'slug',
            autoFocus: true,
            type: 'text',
            value: draftSlug,
            'aria-label': 'New document name',
            placeholder: 'track-c-post',
            onChange: (event) => setDraftSlug(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') setOpen(false);
            },
          }),
          h('button', { key: 'create', type: 'submit', className: 'tool', disabled: busy }, 'Create'),
        ])
      : null,

    items.length > 0
      ? h('ul', { key: 'list', className: 'doc-list' }, items)
      : h('p', { key: 'none', className: 'hint' }, 'No documents here yet.'),
  ]);
}

export default Library;
