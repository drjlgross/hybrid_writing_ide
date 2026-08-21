/**
 * Entry point. The address is `/t/{token}/{slug}` (CLAUDE.md §0.5); the token is
 * read from the URL and handed to the API layer, which sends it on every call.
 */

import { createRoot } from 'react-dom/client';

import { DEFAULT_TOKEN, documentAddress, parseDocumentAddress } from '../../src/addressing.js';
import { App } from './App.js';
import { h } from './h.js';
import './styles.css';

const { token, slug } = parseDocumentAddress(window.location.pathname);
const root = createRoot(document.getElementById('root'));

if (token) {
  root.render(h(App, { token, slug }));
} else {
  // A malformed token is rejected, never repaired (§0.5): a sanitized token is a
  // different token, quietly opening someone else's namespace.
  root.render(
    h('main', { className: 'loading' }, [
      h('h1', { key: 'h' }, 'That link does not name a document'),
      h('p', { key: 'p1' }, [
        'A document address looks like ',
        h('code', { key: 'c' }, '/t/<32 hex characters>/<slug>'),
        '. Check the link you were given — it is not repaired or guessed at.',
      ]),
      h('p', { key: 'p2' }, [
        'Running locally? ',
        h('a', { key: 'a', href: documentAddress(DEFAULT_TOKEN) }, 'Open the development namespace.'),
      ]),
    ]),
  );
}
