/**
 * The public front door: a visitor claims a namespace (CLAUDE.md §12b).
 *
 * Three things live here — validation, per-IP friction, and the claim registry —
 * plus the one function that ties them to the §0.5 machinery. None of that
 * machinery changes. **A claimed namespace is byte-identical to a hand-minted
 * one**; the only novelty is who triggered the mint. `generateToken` and
 * `resolveNamespace` are called, never reimplemented, and nothing here slices a
 * token to make a path.
 *
 * ── THE REGISTRY HOLDS THE WHOLE TOKEN, AND THAT IS DELIBERATE ───────────────
 *
 * `src/usage-ledger.js` writes an eight-character PREFIX and says why: a
 * capability token is the whole identity (§0.5), so a token in a log is a
 * credential in a log. This file is the mirror image of that rule, on purpose.
 *
 * `claims.jsonl` is the operator's user table. It is the ONLY record connecting a
 * person to a namespace, and there is no login, no account, and no automatic
 * recovery — so if the full token is not here, a visitor who loses their link has
 * lost their documents and nobody can help them. A prefix cannot open a namespace,
 * which is exactly what makes it useless for the one job this file has.
 *
 * The rule that makes that safe is not a code rule, because it cannot be:
 * **claims.jsonl never leaves the server.** It is not served by any route, not
 * read on any request path, not included in any export, and never pasted anywhere.
 * `scripts/users-report.js` is its only reader and prints the prefix by default.
 * Treat the file as the credential store it is.
 *
 * ── FAILURE DISCIPLINE, MIRRORING THE LEDGER ─────────────────────────────────
 *
 * A registry write happens AFTER the namespace exists and the visitor is about to
 * be handed a working link. Throwing there would turn a successful claim into a
 * failed one and lose a person a namespace over a bookkeeping error — so every
 * failure is swallowed, returned in the result, and logged by the caller. Losing a
 * row costs the operator a name; losing the claim costs the visitor everything.
 *
 * ── FRICTION, NOT ENFORCEMENT ────────────────────────────────────────────────
 *
 * The rate limit is in-memory and per-process: a restart forgets it, and a second
 * instance would not share it. That is acceptable because it is abuse friction and
 * not a control. The enforcement layer for spend is the Console workspace limit —
 * see the header of `src/usage-ledger.js`, which is where that rule is written
 * down. Nothing here can refuse a model call, and nothing here reads the ledger.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { documentAddress } from './addressing.js';
import { DOCUMENTS_ROOT, generateToken, resolveNamespace } from './namespace.js';
import { SEED_DOCUMENT, SEED_SLUG } from './seed-document.js';
import { createDocument, saveDocument } from './storage.js';
import { commitHumanTurn } from './turns.js';

// ── the registry ──────────────────────────────────────────────────────────────

/** Beside `usage.jsonl` on the documents volume, for the same reason: it is data
 *  about the namespaces, and it has to survive a redeploy with them. */
export const CLAIMS_REGISTRY = 'claims.jsonl';

/** @param {{root?: string}} [options] */
export function claimsRegistryPath({ root = DOCUMENTS_ROOT } = {}) {
  return join(root, CLAIMS_REGISTRY);
}

/**
 * Append one claim. Never throws — see the failure-discipline note above.
 *
 * @param {{name: string, email: string, token: string, root?: string, at?: Date}} entry
 * @returns {{written: boolean, row?: object, error?: string}}
 */
export function recordClaim({ name, email, token, root = DOCUMENTS_ROOT, at = new Date() } = {}) {
  try {
    const row = {
      at: at.toISOString(),
      name: String(name ?? ''),
      email: String(email ?? ''),
      token: String(token ?? ''),
    };

    const path = claimsRegistryPath({ root });
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`);
    return { written: true, row };
  } catch (error) {
    return { written: false, error: error?.message ?? String(error) };
  }
}

/**
 * Every claim, oldest first.
 *
 * A missing file is an empty registry, not an error: nobody has signed up yet, and
 * that is the normal state on the first day. A corrupt LINE is skipped and counted
 * rather than fatal — the file is appended to by a live server, so a truncated last
 * line is a crash artifact and must not hide the rows above it.
 *
 * @param {{root?: string}} [options]
 * @returns {{rows: object[], skipped: number, path: string, exists: boolean}}
 */
export function readClaims({ root = DOCUMENTS_ROOT } = {}) {
  const path = claimsRegistryPath({ root });
  if (!existsSync(path)) return { rows: [], skipped: 0, path, exists: false };

  const rows = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { rows, skipped, path, exists: true };
}

// ── validation ────────────────────────────────────────────────────────────────

/** Long enough to be a name, short enough not to be a paste. */
export const NAME_MAX = 120;
export const EMAIL_MAX = 254; // the practical limit on an address, RFC 5321

/**
 * `something@something.tld`, and nothing cleverer.
 *
 * DELIBERATELY LOOSE. There is no verification email and no deliverability check
 * (§12b), so this pattern cannot establish that an address is real — it can only
 * catch a typo obvious enough to be worth catching. A stricter regex would reject
 * valid addresses (plus-tags, long TLDs, apostrophes) and still not prove anything,
 * which is the worst of both.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * @param {{name?: unknown, email?: unknown}} input
 * @returns {{ok: true, name: string, email: string} | {ok: false, error: string}}
 *   One message at a time, naming the field, because a form that reports three
 *   problems at once is read as one problem three times.
 */
export function validateClaim({ name, email } = {}) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim() : '';

  if (cleanName === '') return { ok: false, error: 'Please enter your name.' };
  if (cleanName.length > NAME_MAX) {
    return { ok: false, error: `That name is longer than ${NAME_MAX} characters.` };
  }
  if (cleanEmail === '') return { ok: false, error: 'Please enter your email address.' };
  if (cleanEmail.length > EMAIL_MAX) {
    return { ok: false, error: `That email address is longer than ${EMAIL_MAX} characters.` };
  }
  if (!EMAIL_PATTERN.test(cleanEmail)) {
    return { ok: false, error: 'That does not look like an email address — check it and try again.' };
  }

  return { ok: true, name: cleanName, email: cleanEmail };
}

// ── per-IP friction ───────────────────────────────────────────────────────────

/** Five claims an hour from one address. Nobody signing up in good faith reaches
 *  this; a script does it in a second. */
export const CLAIM_LIMIT = 5;
export const CLAIM_WINDOW_MS = 60 * 60 * 1000;

/** Above this many tracked addresses, the oldest windows are dropped. A bound on
 *  memory, not a second limit: an attacker rotating addresses would otherwise grow
 *  this map without end, which is a way to take the server down rather than a way
 *  to get namespaces. */
export const CLAIM_IP_MAX = 10_000;

/**
 * The client's address, as well as it can be known behind one proxy.
 *
 * THE RIGHTMOST `X-Forwarded-For` ENTRY, not the leftmost. Each proxy appends the
 * address it received the request from, so with exactly one trusted proxy in front
 * (which is the deployment) the last entry is what OUR proxy saw and the earlier
 * ones are whatever the client chose to send. Taking the leftmost would let anyone
 * reset their own limit with a header.
 *
 * This is best-effort by nature: several proxies, or none, and it is a different
 * address than intended. That is tolerable precisely because this is friction —
 * see the header note.
 */
export function clientAddress(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return req?.ip ?? req?.socket?.remoteAddress ?? 'unknown';
}

/**
 * An in-memory sliding window per address.
 *
 * @param {{limit?: number, windowMs?: number, maxAddresses?: number, now?: () => number}} [options]
 */
export function createClaimLimiter({
  limit = CLAIM_LIMIT,
  windowMs = CLAIM_WINDOW_MS,
  maxAddresses = CLAIM_IP_MAX,
  now = () => Date.now(),
} = {}) {
  /** @type {Map<string, number[]>} address → the times it claimed, within the window */
  const seen = new Map();

  /** The hits still inside the window, newest state written back. */
  function live(key, at) {
    const hits = (seen.get(key) ?? []).filter((time) => at - time < windowMs);
    if (hits.length === 0) seen.delete(key);
    else seen.set(key, hits);
    return hits;
  }

  return {
    /**
     * May this address claim right now? ASKS WITHOUT COUNTING.
     *
     * A refused attempt is not recorded, so a client that keeps retrying does not
     * extend its own lockout — that would turn a one-hour limit into a permanent
     * one for anyone who pressed a button twice.
     *
     * @param {string} address
     * @returns {{allowed: boolean, remaining: number, retryAfterSeconds: number}}
     */
    check(address) {
      const at = now();
      const hits = live(String(address ?? 'unknown'), at);

      if (hits.length >= limit) {
        // When the oldest hit inside the window expires, one slot opens.
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (at - hits[0])) / 1000)),
        };
      }
      return { allowed: true, remaining: limit - hits.length, retryAfterSeconds: 0 };
    },

    /**
     * Count one claim against this address.
     *
     * SEPARATE FROM `check` ON PURPOSE, and called only after a namespace has
     * actually been minted. The limit is five CLAIMS an hour, not five requests: a
     * visitor who mistypes their email twice has not used up two of their five,
     * and an invalid submission creates nothing to abuse. What the limit protects
     * is namespace creation, so that is what it counts.
     *
     * @param {string} address
     */
    record(address) {
      const at = now();
      const key = String(address ?? 'unknown');
      const hits = live(key, at);
      hits.push(at);
      seen.set(key, hits);

      // Cheapest possible bound: when the map is too big, drop the entries whose
      // most recent hit is oldest. They are the ones closest to expiring anyway.
      if (seen.size > maxAddresses) {
        const stale = [...seen.entries()]
          .sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0))
          .slice(0, seen.size - maxAddresses);
        for (const [key_] of stale) seen.delete(key_);
      }
    },

    /** For tests and for a report; not read on the request path. */
    size: () => seen.size,
  };
}

// ── the claim itself ──────────────────────────────────────────────────────────

/**
 * Mint a namespace, seed its default document, and record the claim.
 *
 * Order matters and is the failure discipline in code form:
 *
 *   1. mint a token          — §0.5's `generateToken`, unchanged
 *   2. resolve the namespace — §0.5's one function, unchanged
 *   3. create the document   — at SEED_SLUG ('welcome-doc', not §0.5's 'draft'),
 *                              and empty, because `createDocument` refuses to seed
 *                              a draft no turn accounts for (§0.3)
 *   4. commit ONE human turn — the seed text arrives as an edit like any other, so
 *                              the ledger is true from turn one and there is no
 *                              synthetic history
 *   5. record the claim      — last, and never fatal
 *
 * THE SEED TURN IS AUTHORED `human`. There is no third author in §3 (`human`,
 * `ai`, `mixed`) and inventing one would change the turn schema for a rendering
 * nicety, which §3 is not for. It is defensible on its own terms: the operator
 * placed this text, a person did, and every §4 control behaves correctly on it —
 * the visitor can restore to it, diff against it, or delete it like any other
 * human turn. Recorded in §12b so nobody later reads "human" as a bug.
 *
 * @param {{name: string, email: string, root?: string, now?: Date,
 *   mintToken?: () => string}} options
 * @returns {{token: string, address: string, slug: string, registry: object}}
 * @throws only if minting or writing the namespace fails — a visitor who cannot be
 *   given a working namespace must be told, not handed a dead link.
 */
export function claimNamespace({
  name,
  email,
  root = DOCUMENTS_ROOT,
  now = new Date(),
  mintToken = generateToken,
} = {}) {
  const token = mintToken();
  const { dir } = resolveNamespace(token, { root });

  const created = createDocument({ slug: SEED_SLUG, dir, now });
  const { doc } = commitHumanTurn(created, SEED_DOCUMENT, { now });
  saveDocument(doc, { dir });

  const registry = recordClaim({ name, email, token, root, at: now });

  return { token, address: documentAddress(token, SEED_SLUG), slug: SEED_SLUG, registry };
}

// ── the operator's join ───────────────────────────────────────────────────────

/**
 * Match claims to what their namespaces have spent.
 *
 * THE JOIN KEY IS THE PREFIX. `claims.jsonl` holds the whole token and
 * `usage.jsonl` holds its first eight characters (both files say why in their
 * headers), so the prefix is the only thing they have in common — which is also
 * the property that keeps the ledger useless to anyone who finds it.
 *
 * Kept here rather than in `scripts/users-report.js` so it can be asserted without
 * capturing stdout, exactly as `summarizeUsage` is kept out of the spend report.
 * Nothing on a request path calls it.
 *
 * @param {{claims?: object[], usage?: object[]}} input
 * @returns {{rows: object[], unaccounted: object[]}}
 *   `rows` is one per claim, in registry order. `unaccounted` is every namespace
 *   that spent money and is in nobody's name — hand-minted with `npm run
 *   new-token`, or something nobody can account for. That second list is the smoke
 *   detector; it must never be folded into the first, because "a namespace I
 *   cannot name is spending money" is a different fact from "a person is".
 */
export function joinClaimsAndUsage({ claims = [], usage = [] } = {}) {
  const spend = new Map();
  for (const row of usage) {
    const ns = row?.namespace ?? 'unknown';
    const entry = spend.get(ns) ?? { calls: 0, usd: 0, last: null };
    entry.calls += 1;
    entry.usd += Number(row?.usd) || 0;
    if (typeof row?.at === 'string' && (!entry.last || row.at > entry.last)) entry.last = row.at;
    spend.set(ns, entry);
  }

  const rows = claims.map((claim) => {
    const token = typeof claim?.token === 'string' ? claim.token : '';
    const prefix = token.slice(0, 8);
    const used = spend.get(prefix);
    return {
      at: typeof claim?.at === 'string' ? claim.at : '',
      date: typeof claim?.at === 'string' ? claim.at.slice(0, 10) : '—',
      name: claim?.name ?? '',
      email: claim?.email ?? '',
      token,
      prefix,
      calls: used?.calls ?? 0,
      usd: used?.usd ?? 0,
      last: used?.last ?? null,
    };
  });

  const claimed = new Set(rows.map((row) => row.prefix).filter(Boolean));
  const unaccounted = [...spend.entries()]
    .filter(([ns]) => !claimed.has(ns))
    .map(([ns, entry]) => ({ prefix: ns, ...entry }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls);

  return { rows, unaccounted };
}
