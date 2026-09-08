/**
 * Entry point. Two pages come out of this one bundle.
 *
 * `/t/{token}/{slug}` is the app (CLAUDE.md §0.5); the token is read from the URL
 * and handed to the API layer, which sends it on every call.
 *
 * `/view` is the export viewer (§12a): no token, no namespace, no API beyond the
 * version in the footer.
 *
 * `/` is the public landing page (§12b): the front door, where a stranger reads
 * what the tool is and claims a namespace. It hands out no token of its own — the
 * server mints one in response to a claim, and nothing on the page enumerates
 * anything (§0.5).
 *
 * All three tests come from src/addressing.js, which is where the server gets its
 * copy too — one definition of which path is which, rather than several that agree
 * today.
 *
 * One bundle rather than a second Vite entry: the viewer reuses the history
 * components, so a separate build would ship most of the same code twice and give
 * the two copies room to disagree.
 */

import { createRoot } from 'react-dom/client';

import {
  DEFAULT_TOKEN,
  documentAddress,
  isLandingAddress,
  isViewerAddress,
  parseDocumentAddress,
} from '../../src/addressing.js';
import { App } from './App.js';
import { Landing } from './Landing.js';
import { Viewer } from './Viewer.js';
import { h } from './h.js';
import './styles.css';

const path = window.location.pathname;
const { token, slug } = parseDocumentAddress(path);
const root = createRoot(document.getElementById('root'));

if (isLandingAddress(path)) {
  root.render(h(Landing, {}));
} else if (isViewerAddress(path)) {
  root.render(h(Viewer, {}));
} else if (token) {
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
