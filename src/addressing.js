/**
 * How a document is addressed (CLAUDE.md §0.5).
 *
 *     /t/{token}/{slug}
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
