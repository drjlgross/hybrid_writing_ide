/**
 * How a document is addressed (CLAUDE.md §0.5), and which paths belong to the
 * client at all.
 *
 *     /                    the landing page (chunk 15)
 *     /t/{token}/{slug}    the app
 *     /view                the export viewer (chunk 14)
 *
 * A token is a capability, not an account: whoever holds the link has full access
 * to that namespace, and there is nothing else to check. This is a filing system
 * for a small group of known people, and anyone handed a link has to be told that.
 *
 * Everything here is pure — no `node:` imports — because the browser needs the same
 * rules the server uses. The namespace RESOLUTION (token → a place on disk) is
 * deliberately not here; it lives in one function in src/namespace.js, which the
 * client never loads.
 */

/**
 * Exactly 32 lowercase hex characters. §0.5 says reject rather than sanitize: a
 * sanitized `../../etc` is a path traversal, and a sanitized token is a different
 * token that silently opens a different namespace.
 *
 * Lowercase only, not case-insensitive hex. macOS and Windows filesystems are
 * case-insensitive, so `AB…` and `ab…` would be two accepted spellings resolving
 * to one directory on some hosts and two on others. One spelling, one namespace.
 */
export const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * The fixed token for local single-user development (§0.5).
 *
 * Guessable by construction, which is the point locally and a real exposure once
 * hosted — a deployment must hand out generated tokens and should never rely on
 * this one. See the chunk-06 report.
 */
export const DEFAULT_TOKEN = '0'.repeat(32);

/** §0.5: "A missing slug resolves to a default document in that namespace." */
export const DEFAULT_SLUG = 'draft';

/** @param {unknown} token */
export function isValidToken(token) {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** The slug to use when the address carried none. */
export function resolveSlug(slug) {
  return typeof slug === 'string' && slug !== '' ? slug : DEFAULT_SLUG;
}

/** `/t/{token}/{slug}` — the address of one document. */
export function documentAddress(token, slug = DEFAULT_SLUG) {
  return `/t/${token}/${slug}`;
}

/**
 * Parse `/t/{token}` or `/t/{token}/{slug}` back into its parts.
 *
 * Returns `{token: null}` for anything else rather than throwing: the client uses
 * this on whatever URL the browser happens to be at, and a bad address is a screen
 * to render, not an exception.
 *
 * @param {string} pathname
 * @returns {{token: string|null, slug: string}}
 */
export function parseDocumentAddress(pathname) {
  const parts = String(pathname ?? '')
    .split('/')
    .filter((part) => part !== '');

  if (parts[0] !== 't' || parts.length < 2) return { token: null, slug: DEFAULT_SLUG };
  if (!isValidToken(parts[1])) return { token: null, slug: DEFAULT_SLUG };

  return { token: parts[1], slug: resolveSlug(parts[2]) };
}

/**
 * The export viewer's address (CLAUDE.md § The export viewer).
 *
 * Defined HERE, beside the document address, because the one thing this pair has
 * to guarantee is that they never overlap — and two files each carrying half of
 * that guarantee is how an overlap gets introduced. Both the server (which paths
 * serve the bundle) and the client entry (which page to render) read these, so
 * there is one answer rather than two that agree today.
 *
 * It cannot collide with a document address by construction: every document
 * address begins `/t/`, and §0.5's token is 32 hex characters, which `view` is
 * not. The viewer reads no token and reaches no namespace.
 */
export const VIEWER_ADDRESS = '/view';

/** `/view` or `/view/`, and nothing else — not `/viewer`, not `/view/anything`. */
export function isViewerAddress(pathname) {
  return /^\/view\/?$/.test(String(pathname ?? ''));
}

/**
 * The bare root, and nothing else — the public landing page (§12b).
 *
 * `/` is the one address a stranger reaches without being given anything, which is
 * why it is the front door rather than a redirect into a namespace. It hands out
 * no token: §0.5 says nothing enumerates namespaces, and the page a stranger is
 * most likely to reach is the last place to make an exception.
 */
export function isLandingAddress(pathname) {
  return String(pathname ?? '') === '/';
}

/**
 * Does this path belong to the single-page client?
 *
 * Deliberately LOOSER than `parseDocumentAddress` on the token: `/t/nonsense/x`
 * is served the bundle so the client can render "that link does not name a
 * document" (§0.5 — rejected, never repaired). A 404 from Express would be the
 * server refusing to explain a link someone was handed.
 *
 * Not an API path and not a static asset: `/api/…` is mounted before this is
 * consulted, and so is the static handler.
 */
export function isClientPath(pathname) {
  const path = String(pathname ?? '');
  return /^\/t\/[^/]+(\/[^/]*)?\/?$/.test(path) || isViewerAddress(path) || isLandingAddress(path);
}
