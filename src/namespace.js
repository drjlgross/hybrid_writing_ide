/**
 * Namespace resolution (CLAUDE.md §0.5).
 *
 * THIS IS THE ONE FUNCTION. §0.5: "The server resolves the namespace in exactly one
 * function. No handler reads the token directly. Replacing capability tokens with
 * real accounts must be a change to that function and nothing else."
 *
 * So `resolveNamespace` is the only place in the codebase that turns an identity
 * into a place on disk. Every route handler receives the resolved namespace and
 * never sees the token. When tokens become accounts, this file changes and the
 * handlers do not.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import { DEFAULT_TOKEN, TOKEN_PATTERN, isValidToken } from './addressing.js';

export { DEFAULT_SLUG, DEFAULT_TOKEN, TOKEN_PATTERN, isValidToken } from './addressing.js';

/**
 * Where all namespaces live. One directory per token.
 *
 * Configurable via DOCUMENTS_ROOT because a host mounts a persistent volume at a
 * path of its choosing, and drafts that live inside the container image are
 * deleted by the next deploy. Read once at import: it is a property of how the
 * process was started, not something that changes under a running server.
 *
 * The default is unchanged, so nothing local moves and no test has to know.
 */
export const DOCUMENTS_ROOT = process.env.DOCUMENTS_ROOT || 'documents';

/** Thrown when a token is not exactly 32 hex characters. Never sanitized (§0.5). */
export class InvalidTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/**
 * A fresh capability token: 32 hex characters from `node:crypto` (§0.5).
 *
 * 16 bytes = 128 bits. The token is the only thing standing between a stranger and
 * someone's drafts, so it has to be unguessable rather than merely unique — which
 * rules out anything derived from a timestamp or a counter.
 */
export function generateToken() {
  return randomBytes(16).toString('hex');
}

/**
 * Token → the directory holding that namespace's documents.
 *
 * Rejects anything that is not exactly 32 lowercase hex characters. That check is
 * also what makes the `join` below safe: `..`, `/`, and a leading `.` cannot appear
 * in a string matching TOKEN_PATTERN, so no token can escape DOCUMENTS_ROOT. §0.5
 * is explicit that sanitizing is the wrong move here — a sanitized `../../etc` is a
 * path traversal that looks like it was handled.
 *
 * It also derives the namespace's LABEL — the first eight characters of the token
 * — for the usage ledger (src/usage-ledger.js). That is here rather than at the
 * call site on purpose: attributing cost to a namespace needs *something* that
 * identifies it, and the alternative was a handler slicing the token itself, which
 * is precisely the thing §0.5 says no handler does. Eight characters distinguish
 * the handful of people who will hold a link and are useless to anyone who finds
 * the log; the full token is a credential and never leaves this function.
 *
 * @param {string} token
 * @param {{root?: string}} [options]
 * @returns {{dir: string, label: string}} the resolved namespace; handlers get
 *   this, never the token
 */
export function resolveNamespace(token, { root = DOCUMENTS_ROOT } = {}) {
  if (!isValidToken(token)) {
    throw new InvalidTokenError(
      'that link is not a valid document address. A namespace token is exactly 32 ' +
        'lowercase hex characters; this one is ' +
        (typeof token === 'string' ? `${token.length} characters long` : `a ${typeof token}`) +
        '. Tokens are never repaired or guessed at — check the link you were given.',
    );
  }

  return { dir: join(root, token), label: token.slice(0, 8) };
}

/**
 * Token → the directory holding that namespace's context file CONTENT (§0.5,
 * amended 2026-09-03).
 *
 * THROUGH THE SAME ONE FUNCTION, deliberately. `resolveNamespace` above is what
 * §0.5 says must be the only place an identity becomes a place on disk, so the
 * files directory is derived from its answer rather than being a second
 * token→path mapping. When tokens become accounts, this still changes only
 * because `resolveNamespace` did.
 *
 * Sibling to the documents rather than inside them: the document JSON holds
 * metadata only, because it is read on every load and every listing and a
 * base64 screenshot in that path costs megabytes per read.
 *
 * @param {string} token
 * @param {{root?: string}} [options]
 * @returns {{dir: string, filesDir: string, label: string}}
 */
export function resolveNamespaceFiles(token, { root = DOCUMENTS_ROOT } = {}) {
  const namespace = resolveNamespace(token, { root });
  return { ...namespace, filesDir: join(namespace.dir, 'files') };
}

/** The namespace local development uses (§0.5's fixed default token). */
export function defaultNamespace({ root = DOCUMENTS_ROOT } = {}) {
  return resolveNamespace(DEFAULT_TOKEN, { root });
}
