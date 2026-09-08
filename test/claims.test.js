/**
 * The public claim path (CLAUDE.md §12b), chunk 15.
 *
 * Five groups:
 *
 *   1. VALIDATION — what a form is allowed to send.
 *   2. FRICTION — the per-IP limiter, and the address it limits by.
 *   3. THE REGISTRY — append-only, failure-tolerant, and the full-token decision
 *      asserted against the ledger's prefix-only rule so the two cannot quietly
 *      converge.
 *   4. THE CLAIM — one namespace, one seed turn, §0.3 holding from turn one.
 *   5. THE ENDPOINT — the four answers it can give, over real HTTP.
 *
 * Plus the operator join, which is the only part of `scripts/users-report.js` that
 * decides anything.
 *
 * No network, no key. `callModel` throws if anything reaches it, which is itself
 * an assertion: nothing on this path may call a model.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { isClientPath, isLandingAddress } from '../src/addressing.js';
import {
  CLAIM_LIMIT,
  CLAIM_WINDOW_MS,
  claimNamespace,
  claimsRegistryPath,
  clientAddress,
  createClaimLimiter,
  joinClaimsAndUsage,
  readClaims,
  recordClaim,
  validateClaim,
} from '../src/claims.js';
import { SEED_DOCUMENT, SEED_SLUG } from '../src/seed-document.js';
import { TOKEN_PATTERN } from '../src/addressing.js';
import { assertLedgerInvariant, documentExists, loadDocument } from '../src/storage.js';
import { NO_BUILD_NOTICE, createServer } from '../src/server.js';
import { resolveNamespace } from '../src/namespace.js';

// ── harness ───────────────────────────────────────────────────────────────────

const roots = [];
function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  roots.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A server bound as a deployment is, with a model caller that must never run. */
async function serve({ root = freshRoot() } = {}) {
  const app = createServer({
    root,
    host: '0.0.0.0',
    callModel: async () => {
      throw new Error('a claim must never reach the model');
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    root,
    base,
    claim: (body, headers = {}) =>
      fetch(`${base}/api/public/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    get: (path) => fetch(`${base}${path}`),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ── 1. validation ─────────────────────────────────────────────────────────────

test('a claim needs a name and something shaped like an email', () => {
  assert.equal(validateClaim({ name: 'Ada Lovelace', email: 'ada@example.com' }).ok, true);

  // Trimmed, not rejected: a trailing space is a typo, not a refusal.
  const padded = validateClaim({ name: '  Ada  ', email: '  ada@example.com  ' });
  assert.deepEqual([padded.name, padded.email], ['Ada', 'ada@example.com']);

  const cases = [
    [{ email: 'ada@example.com' }, /enter your name/],
    [{ name: '   ', email: 'ada@example.com' }, /enter your name/],
    [{ name: 'Ada' }, /enter your email/],
    [{ name: 'Ada', email: '' }, /enter your email/],
    [{ name: 'Ada', email: 'ada' }, /look like an email/],
    [{ name: 'Ada', email: 'ada@example' }, /look like an email/],
    [{ name: 'Ada', email: 'ada @example.com' }, /look like an email/],
    [{ name: 'Ada', email: '@example.com' }, /look like an email/],
    [{ name: 'A'.repeat(200), email: 'ada@example.com' }, /longer than/],
    [{ name: 42, email: 'ada@example.com' }, /enter your name/],
    [{}, /enter your name/],
  ];

  for (const [input, expected] of cases) {
    const result = validateClaim(input);
    assert.equal(result.ok, false, `${JSON.stringify(input)} must be refused`);
    assert.match(result.error, expected);
  }
});

test('the email check is deliberately loose — it catches typos, not liars', () => {
  // §12b: no verification email, no deliverability check. These are all real
  // shapes people use, and rejecting them would be worse than useless: it would
  // turn away a valid address while still proving nothing about the invalid ones.
  for (const email of [
    'ada+wordwright@example.com',
    'ada.lovelace@sub.domain.example.co.uk',
    "o'hara@example.com",
    'ada@example.museum',
  ]) {
    assert.equal(validateClaim({ name: 'Ada', email }).ok, true, `${email} is accepted`);
  }
});

// ── 2. friction ───────────────────────────────────────────────────────────────

test('the limiter allows CLAIM_LIMIT claims per window, then refuses with a wait', () => {
  let clock = 0;
  const limiter = createClaimLimiter({ now: () => clock });

  for (let i = 0; i < CLAIM_LIMIT; i += 1) {
    const gate = limiter.check('1.2.3.4');
    assert.equal(gate.allowed, true, `claim ${i + 1} of ${CLAIM_LIMIT}`);
    limiter.record('1.2.3.4');
  }

  const refused = limiter.check('1.2.3.4');
  assert.equal(refused.allowed, false, `claim ${CLAIM_LIMIT + 1} is refused`);
  assert.equal(refused.retryAfterSeconds, CLAIM_WINDOW_MS / 1000, 'and says how long');

  // Another address is unaffected — it is per-address, not global.
  assert.equal(limiter.check('5.6.7.8').allowed, true);

  // The window slides: one second after the first hit expires, one slot opens.
  clock += CLAIM_WINDOW_MS + 1;
  assert.equal(limiter.check('1.2.3.4').allowed, true, 'the window expired');
});

test('a refused attempt does not extend the lockout', () => {
  // Otherwise a client that keeps retrying — or a person who pressed a button
  // twice — turns a one-hour limit into a permanent one.
  let clock = 0;
  const limiter = createClaimLimiter({ now: () => clock });

  for (let i = 0; i < CLAIM_LIMIT; i += 1) limiter.record('1.2.3.4');

  clock += CLAIM_WINDOW_MS / 2;
  for (let i = 0; i < 20; i += 1) assert.equal(limiter.check('1.2.3.4').allowed, false);

  clock += CLAIM_WINDOW_MS / 2 + 1;
  assert.equal(
    limiter.check('1.2.3.4').allowed,
    true,
    'twenty refusals during the window did not push the window out',
  );
});

test('check asks without counting; record is what counts', () => {
  // The limit is five CLAIMS an hour, not five requests. A mistyped email is
  // refused before anything is minted, so it must not spend one of the five.
  const limiter = createClaimLimiter();

  for (let i = 0; i < 50; i += 1) assert.equal(limiter.check('1.2.3.4').allowed, true);
  assert.equal(limiter.check('1.2.3.4').remaining, CLAIM_LIMIT, 'nothing was consumed');

  limiter.record('1.2.3.4');
  assert.equal(limiter.check('1.2.3.4').remaining, CLAIM_LIMIT - 1);
});

test('the address is the RIGHTMOST forwarded hop, so a header cannot reset a limit', () => {
  // Each proxy appends the address it received from, so with one trusted proxy in
  // front the last entry is what OUR proxy saw. Taking the leftmost would let
  // anyone hand themselves a fresh window with a header.
  assert.equal(
    clientAddress({ headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }, ip: '10.0.0.1' }),
    '203.0.113.7',
  );
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '203.0.113.7' } }), '203.0.113.7');
  assert.equal(clientAddress({ headers: {}, ip: '10.0.0.1' }), '10.0.0.1');
  assert.equal(clientAddress({ headers: { 'x-forwarded-for': '  ' }, ip: '10.0.0.1' }), '10.0.0.1');
  assert.equal(clientAddress({ socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.2');
  assert.equal(clientAddress({}), 'unknown');
});

test('the limiter is bounded, so rotating addresses cannot grow it without end', () => {
  const limiter = createClaimLimiter({ maxAddresses: 10 });
  for (let i = 0; i < 500; i += 1) limiter.record(`10.0.0.${i}`);
  assert.ok(limiter.size() <= 10, `bounded, got ${limiter.size()}`);
});

// ── 3. the registry ───────────────────────────────────────────────────────────

test('the registry appends one row per claim and reads them back in order', () => {
  const root = freshRoot();

  assert.deepEqual(readClaims({ root }), {
    rows: [],
    skipped: 0,
    path: claimsRegistryPath({ root }),
    exists: false,
  });

  recordClaim({ name: 'Ada', email: 'ada@example.com', token: 'a'.repeat(32), root, at: new Date('2026-09-08T10:00:00Z') });
  recordClaim({ name: 'Grace', email: 'grace@example.com', token: 'b'.repeat(32), root, at: new Date('2026-09-08T11:00:00Z') });

  const { rows, exists } = readClaims({ root });
  assert.equal(exists, true);
  assert.deepEqual(rows.map((row) => row.name), ['Ada', 'Grace'], 'oldest first');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'email', 'name', 'token']);
});

test('the registry keeps the WHOLE token, where the usage ledger keeps only a prefix', () => {
  // The mirror of §0.5's rule, and the one place it is deliberately inverted.
  // claims.jsonl is the only record connecting a person to a namespace, and there
  // is no login and no recovery — a prefix cannot open a namespace, which is
  // exactly what makes it useless for the job this file has. Asserted so nobody
  // "fixes" it into a prefix later and silently makes recovery impossible.
  const root = freshRoot();
  const token = 'c'.repeat(32);
  recordClaim({ name: 'Ada', email: 'ada@example.com', token, root });

  const raw = readFileSync(claimsRegistryPath({ root }), 'utf8');
  assert.match(raw, new RegExp(token), 'the full token is in the registry');
  assert.equal(readClaims({ root }).rows[0].token.length, 32);

  // And the rule that makes it safe, as far as code can carry it: the module that
  // writes it says so, and no route serves it.
  const source = readFileSync(new URL('../src/claims.js', import.meta.url), 'utf8');
  assert.match(source, /never leaves the server/i, 'the decision is documented where it is made');
});

test('a registry write never throws, and a broken row does not hide the good ones', () => {
  // The ledger's discipline: this happens after a namespace exists and a visitor
  // is about to be handed a working link. Throwing here would lose a person a
  // namespace over a bookkeeping error.
  const result = recordClaim({
    name: 'Ada',
    email: 'ada@example.com',
    token: 'd'.repeat(32),
    root: '/proc/nonexistent-and-unwritable',
  });
  assert.equal(result.written, false);
  assert.ok(result.error, 'and it says why, for the log');

  const root = freshRoot();
  recordClaim({ name: 'Ada', email: 'a@example.com', token: 'e'.repeat(32), root });
  writeFileSync(claimsRegistryPath({ root }), `${readFileSync(claimsRegistryPath({ root }), 'utf8')}{"at":"trunc`);
  const { rows, skipped } = readClaims({ root });
  assert.equal(rows.length, 1, 'the good row survives');
  assert.equal(skipped, 1, 'and the truncated one is counted');
});

// ── 4. the claim ──────────────────────────────────────────────────────────────

test('a claim mints a namespace whose default document holds exactly one seed turn', () => {
  const root = freshRoot();
  const { token, address, slug } = claimNamespace({ name: 'Ada', email: 'ada@example.com', root });

  assert.match(token, TOKEN_PATTERN, '§0.5: 32 lowercase hex characters');
  // NOT §0.5's DEFAULT_SLUG: this is a welcome page, not the visitor's first
  // draft, and naming it `draft` invites writing over instructions not yet read.
  assert.equal(slug, SEED_SLUG);
  assert.equal(slug, 'welcome-doc');
  assert.equal(address, `/t/${token}/welcome-doc`);

  const { dir } = resolveNamespace(token, { root });
  const doc = loadDocument(SEED_SLUG, { dir });

  assert.equal(doc.history.length, 1, 'exactly one turn — no synthetic history');
  assert.equal(doc.history[0].turn_id, 1);
  // §12b: authored `human`. §3 has three authors and none of them is "system";
  // inventing one would change the turn schema for a rendering nicety.
  assert.equal(doc.history[0].author, 'human');
  assert.equal(doc.history[0].snapshot, doc.draft, '§0.3 holds from turn one');
  assert.doesNotThrow(() => assertLedgerInvariant(doc));

  assert.match(doc.draft, /^Welcome to WordWright\./);
  assert.match(doc.draft, /Happy Writing!/);

  // The hand-added bold on the section labels (§1's answer to having no heading
  // node) survives canonicalize into the store, colon included.
  for (const label of ['Working Together', 'Checkpoints', 'Using AI', 'Exporting', 'New Document']) {
    assert.ok(doc.draft.includes(`**${label}:**`), `${label} is a bold label in the store`);
  }
});

test('a claimed namespace has no document at the default slug, and says so calmly', () => {
  // The consequence of naming the seed `welcome-doc`, asserted rather than left to
  // be discovered: trimming the URL back to /t/{token} reaches §0.5's ordinary
  // missing-document screen. Nothing routes a new visitor there — the success link
  // and the switcher both point at the welcome page.
  const root = freshRoot();
  const { token } = claimNamespace({ name: 'Ada', email: 'ada@example.com', root });
  const { dir } = resolveNamespace(token, { root });

  assert.equal(documentExists('welcome-doc', { dir }), true);
  assert.equal(documentExists('draft', { dir }), false, 'no document is created at the default slug');
});

test('the seed document is dialect Markdown — bold labels, no font styling, no autolink', () => {
  // §12b: the landing page sets every rendered "WordWright" in Allison; this does
  // not, because it is stored editor content and a span here would round-trip to
  // nothing. And `wordwright.ink/view` is a BARE URL: §0.1 turns off GFM autolink
  // literals so a bare URL is never silently rewritten into a link.
  assert.doesNotMatch(SEED_DOCUMENT, /<[a-z]/i, 'no markup of any kind');
  assert.doesNotMatch(SEED_DOCUMENT, /wordmark|font|class=/i);
  assert.doesNotMatch(SEED_DOCUMENT, /\]\(|^#|^- |^\* /m, 'no links, headings or lists');
  assert.match(SEED_DOCUMENT, /wordwright\.ink\/view\./, 'the URL is plain text');

  // Bold IS in the dialect and is used, for the section labels only — §1 has no
  // heading node, so this is what a scannable label looks like here.
  assert.equal((SEED_DOCUMENT.match(/\*\*/g) ?? []).length, 10, 'five bold labels, opened and closed');

  // And it survives the store unchanged, which is the property that matters.
  const root = freshRoot();
  const { token } = claimNamespace({ name: 'Ada', email: 'ada@example.com', root });
  const { dir } = resolveNamespace(token, { root });
  assert.doesNotMatch(loadDocument(SEED_SLUG, { dir }).draft, /\[.*\]\(/, 'no link appeared');
});

test('two claims are two namespaces, and the registry names both', () => {
  const root = freshRoot();
  const first = claimNamespace({ name: 'Ada', email: 'ada@example.com', root });
  const second = claimNamespace({ name: 'Grace', email: 'grace@example.com', root });

  assert.notEqual(first.token, second.token, 'crypto-random, not a counter');
  assert.equal(first.registry.written, true);

  const { rows } = readClaims({ root });
  assert.deepEqual(rows.map((row) => row.token), [first.token, second.token]);
});

// ── 5. the endpoint ───────────────────────────────────────────────────────────

test('POST /api/public/claim mints a namespace and returns its address', async (t) => {
  const server = await serve();
  t.after(() => server.close());

  const response = await server.claim({ name: 'Ada Lovelace', email: 'ada@example.com' });
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.match(body.token, TOKEN_PATTERN);
  assert.equal(body.address, `/t/${body.token}/welcome-doc`);

  // The namespace is real and reachable through the ordinary API — a claimed
  // namespace is identical to a hand-minted one (§12b).
  const doc = await server.get(`/api/t/${body.token}/documents/welcome-doc`).then((r) => r.json());
  assert.equal(doc.history.length, 1);
  assert.match(doc.draft, /Welcome to WordWright\./);

  // And the registry has the row, with the whole token.
  const { rows } = readClaims({ root: server.root });
  assert.deepEqual(
    [rows[0].name, rows[0].email, rows[0].token],
    ['Ada Lovelace', 'ada@example.com', body.token],
  );
});

test('invalid input is a calm 400 that mints nothing', async (t) => {
  const server = await serve();
  t.after(() => server.close());

  const response = await server.claim({ name: 'Ada', email: 'not-an-email' });
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.match(body.error, /look like an email/);
  assert.equal(body.invalid_input, true);
  assert.equal(body.token, undefined, 'and no token leaks out of a refusal');

  assert.equal(readClaims({ root: server.root }).exists, false, 'nothing was written');
});

test('the sixth claim from one address is a calm 429 with a Retry-After', async (t) => {
  const server = await serve();
  t.after(() => server.close());

  const headers = { 'x-forwarded-for': '203.0.113.7' };
  for (let i = 0; i < CLAIM_LIMIT; i += 1) {
    const ok = await server.claim({ name: `n${i}`, email: `n${i}@example.com` }, headers);
    assert.equal(ok.status, 201, `claim ${i + 1} of ${CLAIM_LIMIT}`);
  }

  const refused = await server.claim({ name: 'n6', email: 'n6@example.com' }, headers);
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get('retry-after'), String(CLAIM_WINDOW_MS / 1000));

  const body = await refused.json();
  assert.equal(body.rate_limited, true);
  assert.match(body.error, new RegExp(`${CLAIM_LIMIT} sign-ups`));
  assert.equal(readClaims({ root: server.root }).rows.length, CLAIM_LIMIT, 'the sixth minted nothing');

  // A different address is unaffected: this is friction per connection, not a cap
  // on the app.
  const other = await server.claim({ name: 'Grace', email: 'grace@example.com' }, { 'x-forwarded-for': '198.51.100.4' });
  assert.equal(other.status, 201);
});

test('an invalid submission does not spend one of the five', async (t) => {
  const server = await serve();
  t.after(() => server.close());

  const headers = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 10; i += 1) {
    const bad = await server.claim({ name: 'Ada', email: 'typo' }, headers);
    assert.equal(bad.status, 400);
  }

  for (let i = 0; i < CLAIM_LIMIT; i += 1) {
    const ok = await server.claim({ name: `n${i}`, email: `n${i}@example.com` }, headers);
    assert.equal(ok.status, 201, 'ten typos did not use up the budget');
  }
});

test('the claim endpoint is the only unauthenticated one, and / hands out no token', async (t) => {
  const server = await serve();
  t.after(() => server.close());

  // §0.5: nothing enumerates namespaces, including the page a stranger reaches.
  const root = await server.get('/');
  const text = await root.text();
  assert.doesNotMatch(text, /[0-9a-f]{32}/, 'the front door hands out no token');
  assert.doesNotMatch(text, /Cannot GET/, 'and is never Express’s default page');

  // The namespaced API still refuses a made-up token, unchanged by chunk 15.
  const bad = await server.get('/api/t/nonsense/documents/draft');
  assert.equal(bad.status, 400);
});

test('the no-build notice at / hands out no token either', () => {
  // Asserted against the CONSTANT, not against a fetch, because which of the two
  // answers `/` gives depends on whether client/dist exists — so a fetch-based
  // check silently tests the landing page in a developer's tree and the notice in
  // CI. A mutation that put a token in this string went uncaught until this test
  // existed; that asymmetry is the same shape as F89.
  assert.doesNotMatch(NO_BUILD_NOTICE, /[0-9a-f]{32}/, 'no token in the fallback');
  assert.doesNotMatch(NO_BUILD_NOTICE, /Cannot GET/);
  assert.match(NO_BUILD_NOTICE, /vite build/, 'it says what to run');
});

// ── routing ───────────────────────────────────────────────────────────────────

test('/ is a client path and nothing else is mistaken for it', () => {
  assert.equal(isLandingAddress('/'), true);
  assert.equal(isClientPath('/'), true);

  for (const path of ['', '/x', '//', '/index.html', '/api', '/health', null, undefined]) {
    assert.equal(isLandingAddress(path), false, `${JSON.stringify(path)} is not the landing page`);
  }
});

// ── the operator join ─────────────────────────────────────────────────────────

test('the report joins claims to usage on the token prefix', () => {
  const token = '0123456789abcdef0123456789abcdef';
  const { rows, unaccounted } = joinClaimsAndUsage({
    claims: [
      { at: '2026-09-08T10:00:00.000Z', name: 'Ada', email: 'ada@example.com', token },
      { at: '2026-09-08T11:00:00.000Z', name: 'Grace', email: 'grace@example.com', token: 'f'.repeat(32) },
    ],
    usage: [
      { at: '2026-09-08T10:30:00.000Z', namespace: '01234567', usd: 0.02 },
      { at: '2026-09-08T12:00:00.000Z', namespace: '01234567', usd: 0.03 },
      { at: '2026-09-08T09:00:00.000Z', namespace: 'deadbeef', usd: 0.5 },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].prefix, '01234567', 'the first eight characters, as the ledger writes them');
  assert.equal(rows[0].calls, 2);
  assert.ok(Math.abs(rows[0].usd - 0.05) < 1e-9);
  assert.equal(rows[0].last, '2026-09-08T12:00:00.000Z', 'the most recent call, not the first');

  assert.equal(rows[1].calls, 0, 'a claim with no calls is a row, not a gap');
  assert.equal(rows[1].usd, 0);

  // The smoke detector: money spent in nobody's name, kept apart from the named
  // rows because they are different facts.
  assert.deepEqual(unaccounted.map((row) => row.prefix), ['deadbeef']);
  assert.equal(unaccounted[0].usd, 0.5);
});

test('an empty registry joins to nothing and still reports unaccounted spend', () => {
  const { rows, unaccounted } = joinClaimsAndUsage({
    usage: [{ at: '2026-09-08T09:00:00.000Z', namespace: '00000000', usd: 0.1 }],
  });
  assert.deepEqual(rows, []);
  assert.deepEqual(unaccounted.map((row) => row.prefix), ['00000000']);

  assert.deepEqual(joinClaimsAndUsage(), { rows: [], unaccounted: [] });
});
