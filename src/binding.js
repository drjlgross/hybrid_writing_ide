/**
 * Is this server reachable from outside the machine? (CLAUDE.md §0.5, F37.)
 *
 * §0.5 mandates a fixed, guessable default token for local development, and the
 * same sentence makes `documents/000…0` a world-writable namespace the instant the
 * app is hosted. The resolution ratified 2026-09-04 binds the two facts together:
 * off a loopback binding, a request carrying the default token is refused.
 *
 * KEYED ON THE BINDING, NOT ON AN ENVIRONMENT LABEL. `NODE_ENV=production` is a
 * string someone can forget to set, and forgetting it fails open — the exposure
 * ships and nothing says so. A socket reachable from another machine is the hazard
 * itself and cannot be misdeclared: if the bind host is not loopback, the namespace
 * is addressable from outside, whatever the environment claims to be.
 *
 * Pure and dependency-free so it can be asserted directly, which matters more here
 * than usual — this function is the whole of the F37 control.
 */

/**
 * Loopback hosts, exactly.
 *
 * The whole IPv4 127.0.0.0/8 block is loopback, not just 127.0.0.1, so a server
 * bound to 127.0.0.2 is as local as one bound to 127.0.0.1. IPv6 has `::1` and its
 * IPv4-mapped spellings. `localhost` is a name rather than an address; it resolves
 * to loopback everywhere this will run, and refusing it would break `HOST=localhost`
 * for no gain.
 *
 * An empty or absent host is NOT loopback. `app.listen(port)` with no host binds
 * every interface, which is the exposed case — so the safe reading of "unspecified"
 * is "exposed", and the default must be stated rather than inferred.
 */
const LOOPBACK_NAMES = new Set(['localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);

/**
 * @param {unknown} host the address the server is bound to
 * @returns {boolean} true only when nothing outside this machine can reach it
 */
export function isLoopbackHost(host) {
  if (typeof host !== 'string') return false;

  const value = host.trim().toLowerCase();
  if (value === '') return false;
  if (LOOPBACK_NAMES.has(value)) return true;

  // IPv4-mapped IPv6, as Node reports it on a dual-stack socket.
  const bare = value.startsWith('::ffff:') ? value.slice(7) : value;

  // 127.0.0.0/8. Matched on the whole string so `127.0.0.1.evil.com` is not a hit.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * Whether this binding may serve §0.5's fixed default token.
 *
 * Named for the decision rather than for the test, so the call site in
 * `server.js` reads as the rule it is enforcing.
 *
 * @param {unknown} host
 * @returns {boolean}
 */
export function allowsDefaultToken(host) {
  return isLoopbackHost(host);
}

/** The refusal, as one line. Exported so the message has exactly one source. */
export const DEFAULT_TOKEN_REFUSED =
  'this server is reachable from outside the machine, so it will not serve the ' +
  'fixed development namespace — that token is guessable by construction and the ' +
  'namespace would be world-writable. Ask for a generated link (§0.5).';
