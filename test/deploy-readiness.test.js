/**
 * Deploy readiness: everything that has to be true before a link goes to a person
 * who is not the author.
 *
 * Five groups, and each one exists because getting it wrong is discovered by a
 * stranger rather than by a test:
 *
 *   1. F37 — the fixed default token is refused off localhost (§0.5)
 *   2. env configurability — PORT, HOST, DOCUMENTS_ROOT
 *   3. /health and the version surface (§ Versioning)
 *   4. first visit — a new link lands on something usable, never an error
 *   5. budget exhaustion is a distinct, correctly-detected state
 *
 * The usage ledger has its own file.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DEFAULT_SLUG, DEFAULT_TOKEN } from '../src/addressing.js';
import { DEFAULT_TOKEN_REFUSED, allowsDefaultToken, isLoopbackHost } from '../src/binding.js';
import { ModelApiError, classifyApiFailure } from '../src/anthropic-client.js';
import { createServer } from '../src/server.js';
import { generateToken } from '../src/namespace.js';
import { APP_VERSION } from '../src/version.js';

// ── harness ───────────────────────────────────────────────────────────────────

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Kept in step with `scripts/new-token.js` deliberately: see the group 6 comment. */
const DEPLOY_ORIGIN = 'https://hybridwritingide-production.up.railway.app';

const roots = [];
function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-ready-'));
  roots.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A server on an ephemeral port, with a stub model caller. */
async function serve({ host = '127.0.0.1', root = freshRoot(), callModel } = {}) {
  const app = createServer({
    root,
    host,
    callModel: callModel ?? (async () => ({ content: [], stop_reason: 'end_turn' })),
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    root,
    get: (path, options) => fetch(`${base}${path}`, options),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ── 1. F37: the default token off localhost ───────────────────────────────────

test('F37: isLoopbackHost is exact about what counts as local', () => {
  for (const host of ['127.0.0.1', '127.0.0.53', 'localhost', 'LOCALHOST', '::1', '[::1]', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackHost(host), true, `${host} is loopback`);
  }

  // The exposed cases. '' and undefined matter most: `app.listen(port)` with no
  // host binds every interface, so "unspecified" has to read as "exposed" or the
  // control fails open — which is the one direction it must never fail.
  for (const host of ['0.0.0.0', '::', '10.0.0.4', '192.168.1.9', 'example.com', '', '   ', undefined, null, 42]) {
    assert.equal(isLoopbackHost(host), false, `${JSON.stringify(host)} is not loopback`);
  }

  // Not a prefix match: a hostname that merely starts with a loopback address is
  // a hostname someone else controls.
  assert.equal(isLoopbackHost('127.0.0.1.evil.example'), false);
  assert.equal(isLoopbackHost('localhost.evil.example'), false);
  assert.equal(allowsDefaultToken('0.0.0.0'), false);
  assert.equal(allowsDefaultToken('127.0.0.1'), true);
});

test('F37: bound off loopback, every default-token address is refused with 403', async () => {
  const server = await serve({ host: '0.0.0.0' });
  try {
    // Every shape of request, not just the obvious GET: a refusal that only
    // covered reads would leave the namespace world-WRITABLE, which is the
    // actual hazard F37 names.
    const addresses = [
      ['GET', `/api/t/${DEFAULT_TOKEN}/documents`],
      ['GET', `/api/t/${DEFAULT_TOKEN}/documents/${DEFAULT_SLUG}`],
      ['GET', `/api/t/${DEFAULT_TOKEN}/library`],
      ['POST', `/api/t/${DEFAULT_TOKEN}/documents`],
      ['POST', `/api/t/${DEFAULT_TOKEN}/checkpoint`],
      ['POST', `/api/t/${DEFAULT_TOKEN}/ai-edit`],
      ['POST', `/api/t/${DEFAULT_TOKEN}/context`],
      ['POST', `/api/t/${DEFAULT_TOKEN}/rules`],
    ];

    for (const [method, path] of addresses) {
      const response = await server.get(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      assert.equal(response.status, 403, `${method} ${path}`);
      const body = await response.json();
      assert.equal(body.default_token_refused, true, `${method} ${path} says why`);
      assert.equal(body.error, DEFAULT_TOKEN_REFUSED, 'one message, from one place');
    }

    // Refused, not sanitized and not redirected: nothing was created on disk for
    // that namespace. A refusal that still made a directory would be a refusal in
    // name only.
    assert.throws(() => readFileSync(join(server.root, DEFAULT_TOKEN, `${DEFAULT_SLUG}.json`)));
  } finally {
    await server.close();
  }
});

test('F37: a GENERATED token is unaffected off loopback — that is the whole point', async () => {
  const server = await serve({ host: '0.0.0.0' });
  try {
    const token = generateToken();
    const response = await server.get(`/api/t/${token}/documents`);
    assert.equal(response.status, 200, 'a real capability link still works');
    const doc = await response.json();
    assert.equal(doc.slug, DEFAULT_SLUG);
  } finally {
    await server.close();
  }
});

test('F37: bound to loopback, the default token works exactly as before', async () => {
  const server = await serve({ host: '127.0.0.1' });
  try {
    const response = await server.get(`/api/t/${DEFAULT_TOKEN}/documents`);
    assert.equal(response.status, 200, 'local development is unchanged');
  } finally {
    await server.close();
  }
});

test('F37: `/` never sends a person to a page that will refuse them', async () => {
  // Locally it is a convenience. On a deployment the same redirect would land on
  // the 403 above — a dead end reached by following the app's own link.
  // UNCONDITIONAL, both directions. The route must not depend on whether
  // `client/dist` happens to exist: a fresh clone and a deploy whose build step
  // failed are exactly the situations in which someone lands on `/` needing to
  // be told something. This assertion is what caught it.
  const local = await serve({ host: '127.0.0.1' });
  try {
    const response = await local.get('/', { redirect: 'manual' });
    assert.equal(response.status, 302, 'locally it is a shortcut into the dev namespace');
    assert.match(response.headers.get('location') ?? '', new RegExp(DEFAULT_TOKEN));
  } finally {
    await local.close();
  }

  const deployed = await serve({ host: '0.0.0.0' });
  try {
    const response = await deployed.get('/', { redirect: 'manual' });
    assert.notEqual(response.status, 302, 'no redirect into a namespace that is refused');
    assert.equal(response.status, 404);

    const text = await response.text();
    assert.match(text, /capability links/i, 'it explains itself');
    assert.doesNotMatch(text, /Cannot GET/, 'never Express\u2019s default page');
    // §0.5: nothing enumerates namespaces, including the one page a stranger
    // is most likely to reach.
    assert.doesNotMatch(text, new RegExp(DEFAULT_TOKEN), 'and it hands out no token');
  } finally {
    await deployed.close();
  }
});

// ── 2. environment configurability ────────────────────────────────────────────

test('DOCUMENTS_ROOT is honoured: documents land in the configured root', async () => {
  const root = freshRoot();
  const server = await serve({ root });
  try {
    const token = generateToken();
    await server.get(`/api/t/${token}/documents`);
    const stored = readFileSync(join(root, token, `${DEFAULT_SLUG}.json`), 'utf8');
    assert.equal(JSON.parse(stored).slug, DEFAULT_SLUG, 'written under the injected root');
  } finally {
    await server.close();
  }
});

test('the default root is read from the environment, not hard-coded', () => {
  // Asserted on the source rather than by mutating process.env and re-importing:
  // the value is read at import time and this module already imported it, so a
  // runtime override here would prove nothing about a fresh process.
  const source = readFileSync(new URL('../src/namespace.js', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.DOCUMENTS_ROOT/, 'DOCUMENTS_ROOT is configurable');
  assert.match(source, /\|\|\s*'documents'/, 'and defaults to ./documents');

  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /process\.env\.PORT/, 'PORT is configurable');
  assert.match(server, /process\.env\.HOST/, 'HOST is configurable');
  assert.match(server, /app\.listen\(port, host/, 'and the host is actually bound, not just read');
});

// ── 3. /health and the version ────────────────────────────────────────────────

test('/health returns ok and the version, with no token', async () => {
  const server = await serve({ host: '0.0.0.0' });
  try {
    const response = await server.get('/health');
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.version, APP_VERSION);

    // It must not leak the shape of the namespace layer. A health check is the
    // one address reachable without a link, so anything it says is public.
    assert.deepEqual(Object.keys(body).sort(), ['status', 'version']);
  } finally {
    await server.close();
  }
});

test('the version comes from package.json and nowhere else', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(APP_VERSION, pkg.version, 'one source of truth');

  // It is NOT schema_version. A patch bump must never read as a data migration.
  const storage = readFileSync(new URL('../src/storage.js', import.meta.url), 'utf8');
  assert.doesNotMatch(storage, /APP_VERSION/, 'the store does not carry the app version');
});

// ── 4. first visit ────────────────────────────────────────────────────────────

test('first visit: a brand-new token lands on a usable document, not a 404', async () => {
  const server = await serve();
  try {
    const token = generateToken();

    // The default slug, which is what `/t/{token}` and `/t/{token}/draft` both
    // resolve to. §0.5: "a missing slug resolves to a default document."
    for (const path of [`/api/t/${token}/documents`, `/api/t/${token}/documents/${DEFAULT_SLUG}`]) {
      const response = await server.get(path);
      assert.equal(response.status, 200, `${path} opens onto something writable`);
      const doc = await response.json();
      assert.equal(doc.slug, DEFAULT_SLUG);
      assert.deepEqual(doc.history, [], 'and it is empty, not somebody else’s');
    }

    // Any OTHER slug still 404s, deliberately — a typo must not silently start a
    // second document. The client turns this into the offer-to-create screen
    // rather than an error, which is the half that matters to a first visitor.
    const other = await server.get(`/api/t/${token}/documents/notes`);
    assert.equal(other.status, 404, 'a named slug is created deliberately');

    // And the offer works: creating it is one call and lands on a real document.
    const created = await server.get(`/api/t/${token}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'notes' }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).slug, 'notes');
  } finally {
    await server.close();
  }
});

test('first visit: an empty namespace lists nothing rather than failing', async () => {
  const server = await serve();
  try {
    const response = await server.get(`/api/t/${generateToken()}/library`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).documents, []);
  } finally {
    await server.close();
  }
});

// ── 5. budget exhaustion ──────────────────────────────────────────────────────

test('budget exhaustion is detected on the three documented shapes', () => {
  // 402 billing_error — unambiguous, 402 has no other meaning on this API.
  const billing = classifyApiFailure({
    status: 402,
    body: { type: 'error', error: { type: 'billing_error', message: 'credit balance is too low' } },
    retryAfter: null,
  });
  assert.equal(billing.budgetExhausted, true);
  assert.equal(billing.apiErrorType, 'billing_error');
  assert.match(billing.budgetSignal, /402/);

  // 429 with NO retry-after — the documented tier spend-cap signature.
  const cap = classifyApiFailure({
    status: 429,
    body: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limit' } },
    retryAfter: null,
  });
  assert.equal(cap.budgetExhausted, true, 'a spend-cap 429 carries no retry-after');

  // 400 naming the condition in the platform's own vocabulary.
  const limit = classifyApiFailure({
    status: 400,
    body: { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your organization spend limit.' } },
    retryAfter: null,
  });
  assert.equal(limit.budgetExhausted, true);
});

test('an ambiguous or transient failure falls through to the generic error', () => {
  // 429 WITH retry-after is ordinary rate limiting: transient, retryable, and
  // absolutely not "the demo budget is gone".
  const transient = classifyApiFailure({
    status: 429,
    body: { error: { type: 'rate_limit_error', message: 'slow down' } },
    retryAfter: '30',
  });
  assert.equal(transient.budgetExhausted, false, 'retry-after present means retry works');

  // `retry-after: 0` is still a retry-after.
  assert.equal(
    classifyApiFailure({ status: 429, body: {}, retryAfter: '0' }).budgetExhausted,
    false,
  );

  // A malformed request is a 400 invalid_request_error too. Same status, same
  // type — so the only thing separating it from a spend limit is the message,
  // and anything that does not name the condition stays generic.
  for (const message of [
    'messages: roles must alternate between "user" and "assistant"',
    'max_tokens: must be a positive integer',
    '',
  ]) {
    assert.equal(
      classifyApiFailure({ status: 400, body: { error: { type: 'invalid_request_error', message } } })
        .budgetExhausted,
      false,
      `"${message}" is not a budget signal`,
    );
  }

  // Everything else, including a body that is not JSON at all.
  for (const status of [401, 403, 404, 413, 500, 529]) {
    assert.equal(classifyApiFailure({ status, body: null }).budgetExhausted, false, `${status}`);
  }
});

test('a budget failure reaches the client as its own flag, draft unchanged', async () => {
  const server = await serve({
    callModel: async () => {
      throw new ModelApiError('the model API returned 402: credit balance too low', {
        status: 402,
        budgetExhausted: true,
        budgetSignal: '402 billing_error',
        apiErrorType: 'billing_error',
      });
    },
  });
  try {
    const token = generateToken();
    await server.get(`/api/t/${token}/documents`); // create the default document

    const response = await server.get(`/api/t/${token}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: DEFAULT_SLUG, prompt: 'tighten this', pendingDraft: 'Hello.' }),
    });

    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.budget_exhausted, true, 'the flag the panel keys on');
    assert.equal(body.draft_unchanged, true, 'the guarantee travels with it');
    assert.equal(body.budget_signal, '402 billing_error', 'which signal fired, for the logs');
  } finally {
    await server.close();
  }
});

test('an ordinary model failure does NOT claim the budget is gone', async () => {
  const server = await serve({
    callModel: async () => {
      throw new ModelApiError('the model API returned 500: upstream', { status: 500 });
    },
  });
  try {
    const token = generateToken();
    await server.get(`/api/t/${token}/documents`);

    const response = await server.get(`/api/t/${token}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: DEFAULT_SLUG, prompt: 'tighten this', pendingDraft: 'Hello.' }),
    });

    assert.equal(response.status, 502);
    const body = await response.json();
    assert.notEqual(body.budget_exhausted, true, 'a 500 is not a budget');
    assert.equal(body.draft_unchanged, true);
  } finally {
    await server.close();
  }
});

test('the LICENSE is present and names the author', () => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Julia Gross/);
  assert.match(license, /WITHOUT WARRANTY OF ANY KIND/);
});

test('CI runs the suite with no key and no browser', () => {
  const workflow = readFileSync(new URL('../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm test/);
  // The hermeticity claim, asserted rather than trusted: a key in the workflow
  // would mean `npm test` had quietly started needing one. Matched on the ways a
  // secret actually gets INTO a job — a YAML key or a `secrets.` reference — not
  // on the name appearing, because the file explains in prose why it is absent
  // and an assertion that forbids saying so is an assertion that rots the
  // comment rather than protecting anything.
  assert.doesNotMatch(workflow, /^\s*ANTHROPIC_API_KEY\s*:/m, 'no key in the env block');
  assert.doesNotMatch(workflow, /secrets\./, 'no repository secrets reach this job at all');
  assert.match(workflow, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD/, 'no browser binary in CI');
});

// A scratch file, so the group above cannot pass by reading a stale artifact.
test('the harness writes and cleans up its own roots', () => {
  const root = freshRoot();
  writeFileSync(join(root, 'probe'), 'x');
  assert.equal(readFileSync(join(root, 'probe'), 'utf8'), 'x');
});

// ── the sentence the panel actually shows ─────────────────────────────────────

test('the panel shows the budget sentence exactly, with the draft guarantee', async () => {
  const { BUDGET_EXHAUSTED_MESSAGE, createDraftSession } = await import(
    '../client/src/draft-session.js'
  );
  const { ApiError } = await import('../client/src/api.js');

  // The exact string, pinned. It is a message to a specific person and the
  // wording is the point; a paraphrase would not tell her she is the one to tell.
  assert.equal(BUDGET_EXHAUSTED_MESSAGE, "You've outrun the demo budget — tell Julia!");

  const editor = {
    markdown: 'Hello.',
    editable: true,
    getMarkdown: () => 'Hello.',
    setMarkdown() {},
    setEditable(value) {
      this.editable = value;
    },
  };

  let latest = null;
  const session = createDraftSession({
    slug: 'draft',
    editor,
    onState: (state) => {
      latest = state;
    },
    api: {
      list: async () => ({ documents: [] }),
      load: async () => ({ draft: 'Hello.', history: [] }),
      aiEdit: async () => {
        throw new ApiError('the model API returned 402: credit balance too low', {
          budget_exhausted: true,
          draft_unchanged: true,
        }, 502);
      },
    },
  });

  await session.submitPrompt('tighten this');

  assert.equal(
    latest.error,
    `${BUDGET_EXHAUSTED_MESSAGE} Your draft is exactly as you left it.`,
    'the sentence, plus the guarantee that the draft survived',
  );

  // The other guarantees §2.4 requires, still holding: nothing committed, and
  // the editor is writable again rather than stuck read-only behind a failure
  // that will never resolve.
  assert.equal(latest.locked, false, 'the editor unlocked');
  assert.equal(latest.pending, null, 'nothing is still in flight');
  assert.equal(editor.editable, true, 'and it is genuinely editable');
  assert.equal(editor.markdown, 'Hello.', 'the draft is untouched');
});

test('a generic failure keeps the generic message — no false budget claim', async () => {
  const { BUDGET_EXHAUSTED_MESSAGE, createDraftSession } = await import(
    '../client/src/draft-session.js'
  );
  const { ApiError } = await import('../client/src/api.js');

  let latest = null;
  const session = createDraftSession({
    slug: 'draft',
    editor: {
      getMarkdown: () => 'Hello.',
      setMarkdown() {},
      setEditable() {},
    },
    onState: (state) => {
      latest = state;
    },
    api: {
      list: async () => ({ documents: [] }),
      load: async () => ({ draft: 'Hello.', history: [] }),
      aiEdit: async () => {
        throw new ApiError('the model API returned 529: overloaded', { draft_unchanged: true }, 502);
      },
    },
  });

  await session.submitPrompt('tighten this');
  assert.doesNotMatch(latest.error, new RegExp(BUDGET_EXHAUSTED_MESSAGE.slice(0, 20)));
  assert.match(latest.error, /529/, 'the real failure is still reported');
  assert.match(latest.error, /exactly as you left it/, 'with the draft guarantee');
});

// ── 6. the minted link is the link that gets handed over ─────────────────────
//
// `scripts/new-token.js` had no coverage at all until this chunk, and it is the
// one place a capability URL is composed for a human to copy. The hazard is not
// that it crashes — it is that it prints something subtly wrong and the mistake
// surfaces as a stranger's 404, or worse as a valid-looking token naming an empty
// namespace nobody can find again.

/** Run the token script and return its stdout. */
function mintToken(...args) {
  return execFileSync(process.execPath, [join(REPO_ROOT, 'scripts/new-token.js'), ...args], {
    encoding: 'utf8',
  });
}

test('§0.5 minting prints the deployed link beside the local one, same token in both', () => {
  const out = mintToken();

  const local = out.match(/^local {3}: (\S+)$/m);
  const deployed = out.match(/^deployed: (\S+)$/m);
  assert.ok(local, 'the local link is still printed');
  assert.ok(deployed, 'the deployed link is printed too — it is the one handed to a person');

  assert.match(deployed[1], /^https:\/\//, 'a capability link off this machine is https');
  assert.ok(
    deployed[1].startsWith(DEPLOY_ORIGIN),
    `the deployed link points at the deployment, got ${deployed[1]}`,
  );

  // The two links must name the SAME namespace. Composing the URL twice is
  // exactly where they could drift, and a drifted pair is undetectable by eye.
  const tokenOf = (url) => url.match(/\/t\/([^/]+)\//)?.[1];
  assert.match(tokenOf(local[1]), /^[0-9a-f]{32}$/, '§0.5: 32 hex characters, nothing else');
  assert.equal(tokenOf(deployed[1]), tokenOf(local[1]), 'one token, two hosts');

  assert.ok(local[1].endsWith(`/${DEFAULT_SLUG}`), 'and both land on the default slug');
  assert.ok(deployed[1].endsWith(`/${DEFAULT_SLUG}`));
});

test('§0.5 every mint is a different token, and the disclosure always rides along', () => {
  const first = mintToken();
  const second = mintToken();
  const tokenOf = (out) => out.match(/^token: ([0-9a-f]{32})$/m)?.[1];

  assert.ok(tokenOf(first) && tokenOf(second));
  assert.notEqual(tokenOf(first), tokenOf(second), 'crypto-random, not a counter');

  // §0.5 requires a namespace "be described that way to anyone given a link", and
  // the person handing it over is the one who needs the words.
  assert.match(first, /full read and write access/);
  assert.match(first, /not access control/);
});

test('--base overrides the deployment, for a host that is neither of the two', () => {
  const out = mintToken('--base', 'https://staging.example.app/');

  assert.match(out, /^link {4}: https:\/\/staging\.example\.app\/t\/[0-9a-f]{32}\/draft$/m);
  assert.doesNotMatch(out, /^deployed:/m, 'an explicit base replaces the default pair');
  assert.doesNotMatch(out, /staging\.example\.app\/\/t\//, 'the trailing slash is stripped, not doubled');
});
