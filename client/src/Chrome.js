/**
 * The two pieces of page furniture both pages wear: the wordmark and the version
 * line.
 *
 * Extracted when /view arrived and there were suddenly two pages. The alternative
 * was a second copy of the lockup, and a wordmark that exists twice is a wordmark
 * that will eventually say two different things — the rebrand that produced it
 * touched three files, and the whole point of a name is that it is the same
 * everywhere.
 *
 * Markup only. Neither of these fetches anything: the version is a prop, so each
 * page owns how it gets one and a headless test can hand one over without a
 * network. See App.js and Viewer.js, which both go to `/health` for it — the
 * running server's number, not the one baked into this bundle at build time.
 */

import { Fragment, h } from './h.js';

/**
 * The lockup: the wordmark, and beneath it the line that says what the tool is
 * for. Two elements rather than one so the two faces stay separately declared
 * (see `--wordmark-font` and `--mono-font` in the stylesheet) and so the subtitle
 * is a thing a screen reader reads on its own.
 *
 * @param {{subtitle?: string}} props `subtitle` defaults to the product's own
 *   line; /view overrides it to say what that page is instead. The wordmark never
 *   varies.
 */
export function Wordmark({ subtitle = 'Enabling Human Judgment' } = {}) {
  // A Fragment, so callers write `h(Wordmark, …)` like any other component rather
  // than calling it as a function and spreading the result. It adds no element:
  // the h1 and the p stay direct children of the masthead, which is what the
  // stylesheet's `.masthead h1` selector expects.
  return h(Fragment, null, [
    h('h1', { key: 'title' }, 'WordWright'),
    h('p', { key: 'subtitle', className: 'wordmark-subtitle' }, subtitle),
  ]);
}

/**
 * The version, for a bug report (§ Versioning: "the deployed UI surfaces the
 * current version somewhere a bug reporter can find it").
 *
 * Quiet on purpose: it is read once, at the moment something has gone wrong, and
 * it should not compete with the draft on every other occasion. `null` renders as
 * "version unavailable" rather than as nothing — a footer that vanishes when the
 * health call fails tells a bug reporter that there is no version to report,
 * which is not true.
 *
 * @param {{version: string|null}} props
 */
export function Colophon({ version = null }) {
  return h('footer', { className: 'colophon' }, [
    h('span', { key: 'v' }, version ? `WordWright v${version}` : 'WordWright — version unavailable'),
  ]);
}

export default Wordmark;
