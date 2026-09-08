/**
 * The public landing page at `/` (CLAUDE.md §12b).
 *
 * The one address a stranger reaches without being handed anything. Its job is to
 * say what the tool is and to hand over a namespace, with no operator in the loop.
 *
 * TWO VIEWS, ONE COMPONENT. Before a claim: the lockup, the ratified copy, the
 * form, the disclaimers. After one: the SUCCESS VIEW, whose entire job is the
 * link. Everything else on that view is subordinate to the link being seen,
 * copied, and understood — §0.5 requires a namespace be described to whoever is
 * given one, and this is the moment someone is given one.
 *
 * NO TOKEN IS HANDED OUT BY THE PAGE ITSELF, only by the server in response to a
 * claim. §0.5 says nothing enumerates namespaces, and the page a stranger is most
 * likely to reach is the last place to make an exception — there is no development
 * link here and no list of anything.
 *
 * The name is set in Allison wherever it is rendered, including mid-sentence, via
 * `wordmarked()` — see landing-copy.js for why that is a typographic change and
 * not an editorial one.
 */

import { useEffect, useRef, useState } from 'react';

import { Colophon, Wordmark } from './Chrome.js';
import { DISCLAIMERS, KEY_DISCLOSURE, LANDING_COPY, wordmarked } from './landing-copy.js';
import { createApi } from './api.js';
import { h } from './h.js';

/** POST the claim. Its own function so a test can hand over a stub. */
async function postClaim({ name, email }, fetchImpl) {
  const response = await fetchImpl('/api/public/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    /* a body-less error is still an error */
  }

  if (!response.ok) {
    const error = new Error(body.error ?? `The server returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return body;
}

/**
 * @param {{fetchImpl?: typeof fetch, createApi?: Function, origin?: string,
 *   clipboard?: {writeText: (text: string) => Promise<void>}}} props
 *   All injected for the headless tests; the page passes none.
 */
export function Landing({
  fetchImpl = (...args) => fetch(...args),
  createApi: makeApi = createApi,
  origin,
  clipboard,
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // 'idle' | 'claiming'. The button is disabled while a claim is in flight, so a
  // double-click cannot mint two namespaces and strand the first.
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [claim, setClaim] = useState(null);
  const [copied, setCopied] = useState(false);

  const linkRef = useRef(null);

  // The version in the footer, exactly as the app and the viewer get it.
  const [version, setVersion] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => makeApi({ token: 'none' }).health())
      .then((health) => {
        if (live && typeof health?.version === 'string') setVersion(health.version);
      })
      .catch(() => {
        /* no version in the footer; nothing else changes */
      });
    return () => {
      live = false;
    };
  }, [makeApi]);

  async function submit(event) {
    event.preventDefault();
    if (phase === 'claiming') return;

    setError(null);
    setPhase('claiming');
    try {
      const result = await postClaim({ name, email }, fetchImpl);
      setClaim(result);
    } catch (failure) {
      // Every failure lands here as a sentence on the page — rate-limited, invalid
      // input, server error, or a network that never answered. Never a blank page
      // and never console-only.
      setError(failure?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setPhase('idle');
    }
  }

  // ── the success view ────────────────────────────────────────────────────────
  if (claim) {
    // Absolute, because the visitor is going to paste this somewhere that is not
    // this page. `origin` is injected only so a headless test has one.
    const base = origin ?? globalThis.location?.origin ?? '';
    const url = `${base}${claim.address}`;

    async function copy() {
      const target = clipboard ?? globalThis.navigator?.clipboard;
      try {
        await target.writeText(url);
        setCopied(true);
      } catch {
        // A denied or absent clipboard is not a failure worth a red box: the link
        // is on screen, selectable, and the fallback is the one everybody knows.
        setCopied(false);
        linkRef.current?.focus?.();
        globalThis.getSelection?.()?.selectAllChildren?.(linkRef.current);
      }
    }

    return h('div', { className: 'app landing landing-done' }, [
      h('header', { key: 'masthead', className: 'masthead' }, [
        h(Wordmark, { key: 'lockup' }),
      ]),

      h('main', { key: 'main', className: 'landing-main' }, [
        h('section', { key: 'link', className: 'claim-done' }, [
          h('h2', { key: 'h' }, 'Here is your link.'),

          // THE LINK, LARGE. Everything else on this view is subordinate to it
          // being seen and kept.
          h(
            'p',
            { key: 'url', className: 'claim-link', ref: linkRef, tabIndex: 0 },
            url,
          ),

          h('div', { key: 'actions', className: 'claim-actions' }, [
            h(
              'button',
              { key: 'copy', type: 'button', className: 'top-button', onClick: copy },
              copied ? 'Copied' : 'Copy Link',
            ),
            h(
              'a',
              { key: 'go', className: 'primary claim-start', href: url },
              'Start Writing',
            ),
          ]),

          // §0.5's disclosure, beside the link rather than under it.
          h('p', { key: 'disclosure', className: 'claim-disclosure' }, KEY_DISCLOSURE),
        ]),
      ]),

      h(Colophon, { key: 'footer', version }),
    ]);
  }

  // ── the landing view ────────────────────────────────────────────────────────
  return h('div', { className: 'app landing' }, [
    h('header', { key: 'masthead', className: 'masthead' }, [h(Wordmark, { key: 'lockup' })]),

    h('main', { key: 'main', className: 'landing-main' }, [
      h(
        'section',
        { key: 'copy', className: 'landing-copy' },
        LANDING_COPY.map((paragraph, index) =>
          h('p', { key: `p${index}` }, wordmarked(paragraph, `p${index}-`)),
        ),
      ),

      h('form', { key: 'form', className: 'claim-form', onSubmit: submit }, [
        h('label', { key: 'name-l', className: 'claim-field' }, [
          h('span', { key: 'k' }, 'Name'),
          h('input', {
            key: 'v',
            type: 'text',
            name: 'name',
            autoComplete: 'name',
            value: name,
            disabled: phase === 'claiming',
            onChange: (event) => setName(event.target.value),
          }),
        ]),

        h('label', { key: 'email-l', className: 'claim-field' }, [
          h('span', { key: 'k' }, 'Email'),
          h('input', {
            key: 'v',
            // `type="email"` for the keyboard it summons on a phone. The real
            // check is the server's (src/claims.js): a browser's own validation is
            // a convenience and is not where a rule lives.
            type: 'email',
            name: 'email',
            autoComplete: 'email',
            value: email,
            disabled: phase === 'claiming',
            onChange: (event) => setEmail(event.target.value),
          }),
        ]),

        h(
          'button',
          { key: 'go', type: 'submit', className: 'primary claim-submit', disabled: phase === 'claiming' },
          phase === 'claiming' ? 'Making Your Workspace…' : 'Start Writing',
        ),
      ]),

      // Rate-limited, invalid input, server error: one calm line, in the place the
      // visitor was already looking.
      error
        ? h('p', { key: 'error', className: 'claim-error', role: 'alert' }, error)
        : null,

      h('p', { key: 'disclaimers', className: 'landing-disclaimers' }, wordmarked(DISCLAIMERS, 'd')),
    ]),

    h(Colophon, { key: 'footer', version }),
  ]);
}

export default Landing;
