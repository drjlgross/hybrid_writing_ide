/**
 * CLAUDE.md §0.5 capability-token namespaces: token shape, the one resolver
 * function, and the routes that hang off it.
 *
 * The point of these tests is that a token is REJECTED rather than repaired. A
 * sanitized token is a different token, and a sanitized `../../etc` is a path
 * traversal that looks like it was handled.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SLUG,
  DEFAULT_TOKEN,
  TOKEN_PATTERN,
  documentAddress,
  isValidToken,
  parseDocumentAddress,
  resolveSlug,
} from '../src/addressing.js';
import { InvalidTokenError, defaultNamespace, generateToken, resolveNamespace } from '../src/namespace.js';
import { createServer } from '../src/server.js';
import { DEFAULT_DOCUMENTS_DIR, createDocument, loadDocument, saveDocument } from '../src/storage.js';
import { commitHumanTurn } from '../src/turns.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

function freshRoot() {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'namespace-'));
}

const ok = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function call(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
    ...(options.payload ? { method: 'POST', body: JSON.stringify(options.payload) } : {}),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { raw: true };
  }
  return { status: response.status, body };
}

const post = (url, payload) => call(url, { payload });

// ── tokens ──────────────────────────────────────────────────────────────────────

test('generateToken produces 32 hex characters from node:crypto, and never repeats', () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = generateToken();
    assert.match(token, TOKEN_PATTERN, `${token} is not 32 lowercase hex characters`);
    assert.equal(token.length, 32);
    tokens.add(token);
  }
  assert.equal(tokens.size, 200, 'two generated tokens collided — they are not random');
});

test('isValidToken accepts exactly 32 lowercase hex and nothing else', () => {
  assert.ok(isValidToken(generateToken()));
  assert.ok(isValidToken(DEFAULT_TOKEN), 'the fixed development token must be a valid token');

  const rejected = [
    '',
    'a'.repeat(31),
    'a'.repeat(33),
    'A'.repeat(32), // uppercase: two spellings would be one directory on a case-insensitive FS
    'g'.repeat(32), // not hex
    `${'a'.repeat(30)}..`,
    '../../etc/passwd',
    'a'.repeat(16) + '/' + 'a'.repeat(15),
    `${'a'.repeat(32)}\n`,
    ' '.repeat(32),
    null,
    undefined,
    32,
    {},
  ];
  for (const value of rejected) {
    assert.equal(isValidToken(value), false, `expected ${JSON.stringify(value)} to be rejected`);
  }
});

test('resolveNamespace is the one function: token in, directory out, no sanitizing', () => {
  const token = generateToken();
  assert.deepEqual(resolveNamespace(token, { root: 'documents' }), {
    dir: join('documents', token),
  });

  // §0.5: reject, never repair.
  for (const bad of ['../../etc', 'ABCDEF0123456789abcdef0123456789', 'short', '', null]) {
    assert.throws(
      () => resolveNamespace(bad, { root: 'documents' }),
      InvalidTokenError,
      `expected ${JSON.stringify(bad)} to be refused`,
    );
  }
});

test('no token can escape the documents root', () => {
  // The pattern is what makes join() safe; assert that rather than trusting it.
  for (const attempt of ['..', '../..', '..%2f..', './..', 'a/../../b']) {
    assert.throws(() => resolveNamespace(attempt, { root: 'documents' }), InvalidTokenError);
  }
  const dir = resolveNamespace(generateToken(), { root: 'documents' }).dir;
  assert.ok(dir.startsWith('documents/'), dir);
  assert.equal(dir.split('/').length, 2, 'a namespace is exactly one level under the root');
});

test('the default documents directory is a namespace, not the bare root', () => {
  assert.equal(DEFAULT_DOCUMENTS_DIR, defaultNamespace().dir);
  assert.equal(DEFAULT_DOCUMENTS_DIR, join('documents', DEFAULT_TOKEN));
  assert.notEqual(DEFAULT_DOCUMENTS_DIR, 'documents');
});

// ── addressing ──────────────────────────────────────────────────────────────────

test('a document is addressed as /t/{token}/{slug}, and a missing slug defaults', () => {
  const token = generateToken();
  assert.equal(documentAddress(token, 'essay'), `/t/${token}/essay`);
  assert.equal(documentAddress(token), `/t/${token}/${DEFAULT_SLUG}`);

  assert.deepEqual(parseDocumentAddress(`/t/${token}/essay`), { token, slug: 'essay' });
  assert.deepEqual(parseDocumentAddress(`/t/${token}`), { token, slug: DEFAULT_SLUG });
  assert.deepEqual(parseDocumentAddress(`/t/${token}/`), { token, slug: DEFAULT_SLUG });

  assert.equal(resolveSlug(''), DEFAULT_SLUG);
  assert.equal(resolveSlug(undefined), DEFAULT_SLUG);
  assert.equal(resolveSlug('essay'), 'essay');
});

test('parseDocumentAddress refuses anything that is not a valid address', () => {
  for (const bad of ['/', '/t', '/t/', '/t/short/essay', '/t/../../etc/x', '/other/path', '']) {
    assert.equal(parseDocumentAddress(bad).token, null, `expected ${JSON.stringify(bad)} to have no token`);
  }
});

// ── the routes ──────────────────────────────────────────────────────────────────

test('the API rejects a malformed token with 400 and creates nothing', async () => {
  const root = freshRoot();
  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    const rejected = [
      'short',
      'A'.repeat(32), // uppercase hex
      `${'a'.repeat(31)}!`,
      '%2e%2e%2f%2e%2e%2fetc', // a traversal that survives URL normalization
      '..%2f..',
      `${'a'.repeat(32)}extra`,
    ];
    for (const bad of rejected) {
      const { status, body } = await call(`${url}/api/t/${bad}/documents/draft`);
      assert.equal(status, 400, `token ${JSON.stringify(bad)} should be refused, got ${status}`);
      assert.equal(body.invalid_token, true, `token ${JSON.stringify(bad)} should say why`);
    }

    // A bare `..` never reaches the server: the URL layer resolves it away before
    // the request is sent, so `/api/t/../documents/draft` arrives as
    // `/api/documents/draft` and matches no route. Asserted so that a future change
    // to the route shape cannot quietly turn it into something that DOES match.
    const traversed = await call(`${url}/api/t/../documents/draft`);
    assert.equal(traversed.status, 404, 'a normalized-away token must address nothing');

    // Nothing was filed anywhere. The root itself is the temp dir, which exists;
    // what must not exist is any namespace inside it.
    assert.deepEqual(readdirSync(root), [], 'a rejected token must not create a namespace');
    assert.equal(existsSync(join(root, '..', 'etc')), false);
  } finally {
    await close();
  }
});

test('two namespaces hold the same slug as two different documents', async () => {
  const root = freshRoot();
  const a = generateToken();
  const b = generateToken();
  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    // The same slug in both namespaces: §0.5 says slugs collide only within one.
    assert.equal((await post(`${url}/api/t/${a}/documents`, { slug: 'shared-name' })).status, 201);
    assert.equal(
      (await post(`${url}/api/t/${b}/documents`, { slug: 'shared-name' })).status,
      201,
      'a slug taken in another namespace must not collide',
    );

    // A collision WITHIN a namespace is still refused.
    assert.equal((await post(`${url}/api/t/${a}/documents`, { slug: 'shared-name' })).status, 409);

    // Give namespace A a turn; B must not see it.
    const dirA = resolveNamespace(a, { root }).dir;
    saveDocument(commitHumanTurn(loadDocument('shared-name', { dir: dirA }), 'Only in A.\n').doc, {
      dir: dirA,
    });

    const inA = await call(`${url}/api/t/${a}/documents/shared-name`);
    const inB = await call(`${url}/api/t/${b}/documents/shared-name`);
    assert.match(inA.body.draft, /Only in A/);
    assert.equal(inB.body.draft, '', 'namespace B must not see namespace A"s text');
    assert.equal(inB.body.history.length, 0);
  } finally {
    await close();
  }
});

test('a missing slug resolves to a default document, which is created on demand', async () => {
  const root = freshRoot();
  const token = generateToken();
  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    // A fresh link has to open onto something writable.
    const bare = await call(`${url}/api/t/${token}/documents`);
    assert.equal(bare.status, 200);
    assert.equal(bare.body.slug, DEFAULT_SLUG);
    assert.equal(bare.body.history.length, 0);

    const named = await call(`${url}/api/t/${token}/documents/${DEFAULT_SLUG}`);
    assert.equal(named.status, 200);
    assert.equal(named.body.created_at, bare.body.created_at, 'the second call reopened the same file');

    // But ONLY the default slug. A typo must fail to find a document, not quietly
    // start a second one.
    const typo = await call(`${url}/api/t/${token}/documents/my-esay`);
    assert.equal(typo.status, 404);
  } finally {
    await close();
  }
});

test('POST /checkpoint commits a human turn, and reports honestly when there is nothing to commit', async () => {
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'notes', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    const first = await post(`${base}/checkpoint`, {
      slug: 'notes',
      pendingDraft: 'A **first** line.\n',
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.turn.turn_id, 1);
    assert.equal(first.body.turn.author, 'human');
    assert.equal(first.body.history.length, 1);

    // §3/§4: an unchanged draft creates no turn, and the response must say so.
    const again = await post(`${base}/checkpoint`, {
      slug: 'notes',
      pendingDraft: 'A **first** line.\n',
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.turn, null, 'an unchanged draft must not create an empty turn');
    assert.equal(again.body.history.length, 1, 'and must not append to history');

    // Non-canonical input reaching the same canonical form is also "unchanged".
    const nonCanonical = await post(`${base}/checkpoint`, {
      slug: 'notes',
      pendingDraft: 'A __first__ line.  \n\n\n',
    });
    assert.equal(nonCanonical.body.turn, null, 'canonicalization happens before the comparison');

    assert.equal(loadDocument('notes', { dir }).history.length, 1);
    assert.equal((await post(`${base}/checkpoint`, { slug: 'nope', pendingDraft: 'x' })).status, 404);
    assert.equal((await post(`${base}/checkpoint`, { pendingDraft: 'x' })).status, 400);
    assert.equal((await post(`${base}/checkpoint`, { slug: 'notes' })).status, 400);
  } finally {
    await close();
  }
});

// ── §4 restore, over HTTP (chunk 8 item 3) ─────────────────────────────────────

test('POST /restore appends a turn inside the namespace and never truncates history', async () => {
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'essay', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'Version one of the text.\n' });
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'Version two of the text.\n' });
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'Version three of the text.\n' });

    const before = loadDocument('essay', { dir }).history;
    assert.equal(before.length, 3);

    const { status, body } = await post(`${base}/restore`, { slug: 'essay', turn_id: 1 });
    assert.equal(status, 200);
    assert.equal(body.turn.turn_id, 4, 'restore appends a NEW turn');
    assert.equal(body.turn.author, 'human', '§4: the new turn is a human turn');
    assert.equal(body.restored_from, 1);
    assert.equal(body.draft, 'Version one of the text.\n');

    // §0.3: append-only. The turns that were there are byte-identical afterwards.
    const after = loadDocument('essay', { dir }).history;
    assert.equal(after.length, 4, 'nothing was truncated');
    assert.equal(
      JSON.stringify(after.slice(0, 3)),
      JSON.stringify(before),
      'the turns before the restore were not rewritten',
    );
    assert.equal(after[3].snapshot, after[0].snapshot, "the new turn holds turn 1's snapshot");
    assert.equal(after[1].snapshot, 'Version two of the text.\n', 'the turn we backed out of survives');
  } finally {
    await close();
  }
});

test('§4 restoring to where the draft already is creates no turn, and says so', async () => {
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'essay', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'Only version.\n' });

    const { status, body } = await post(`${base}/restore`, { slug: 'essay', turn_id: 1 });
    assert.equal(status, 200);
    assert.equal(body.turn, null, 'no empty turn (§3)');
    assert.equal(body.human_turn, null);
    assert.equal(body.history.length, 1, 'and nothing was appended');
    assert.equal(loadDocument('essay', { dir }).history.length, 1);
  } finally {
    await close();
  }
});

test('§4 restore commits uncommitted hand edits first, instead of throwing them away', async () => {
  // Not spelled out in §4. The alternative is that clicking Restore silently
  // destroys whatever was typed and never checkpointed, with no trace in the
  // ledger — which is precisely the loss §0.2 and §0.3 exist to prevent. Named as
  // a finding in the chunk-08 report.
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'essay', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'The first version.\n' });
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'The second version.\n' });

    const { body } = await post(`${base}/restore`, {
      slug: 'essay',
      turn_id: 1,
      pendingDraft: 'The second version, with a sentence typed just now.\n',
    });

    assert.equal(body.human_turn.turn_id, 3, 'the pending edits became their own turn');
    assert.equal(
      body.human_turn.snapshot,
      'The second version, with a sentence typed just now.\n',
      'and that turn holds exactly what was typed',
    );
    assert.equal(body.turn.turn_id, 4, 'the restore is the turn after it');
    assert.equal(body.draft, 'The first version.\n');

    const history = loadDocument('essay', { dir }).history;
    assert.deepEqual(history.map((turn) => turn.turn_id), [1, 2, 3, 4]);
    assert.match(history[2].snapshot, /typed just now/, 'the typed text is recoverable from the ledger');
  } finally {
    await close();
  }
});

test('POST /restore refuses a turn that does not exist, and commits nothing when it does', async () => {
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'essay', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    await post(`${base}/checkpoint`, { slug: 'essay', pendingDraft: 'Only version.\n' });

    // A turn id that is not there, WITH pending edits: the bad id must be caught
    // before anything is committed, or a typo would leave a stray turn as its
    // only effect.
    const missing = await post(`${base}/restore`, {
      slug: 'essay',
      turn_id: 99,
      pendingDraft: 'Something typed.\n',
    });
    assert.equal(missing.status, 404);
    assert.match(missing.body.error, /no turn 99/);
    assert.equal(loadDocument('essay', { dir }).history.length, 1, 'nothing was committed');

    assert.equal((await post(`${base}/restore`, { turn_id: 1 })).status, 400, 'slug is required');
    assert.equal((await post(`${base}/restore`, { slug: 'essay' })).status, 400, 'turn_id is required');
    assert.equal(
      (await post(`${base}/restore`, { slug: 'essay', turn_id: '1' })).status,
      400,
      'a turn id is an integer, not a string',
    );
    assert.equal(
      (await post(`${base}/restore`, { slug: 'essay', turn_id: 1, pendingDraft: 42 })).status,
      400,
    );
    assert.equal((await post(`${base}/restore`, { slug: 'nope', turn_id: 1 })).status, 404);
  } finally {
    await close();
  }
});

test('§0.5 restore is inside the namespace: another token cannot reach this document', async () => {
  const root = freshRoot();
  const mine = generateToken();
  const theirs = generateToken();
  const mineDir = resolveNamespace(mine, { root }).dir;
  createDocument({ slug: 'essay', dir: mineDir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    await post(`${url}/api/t/${mine}/checkpoint`, { slug: 'essay', pendingDraft: 'Mine.\n' });

    // Same slug, different token: a different namespace, so there is nothing there.
    const other = await post(`${url}/api/t/${theirs}/restore`, { slug: 'essay', turn_id: 1 });
    assert.equal(other.status, 404);
    assert.equal(JSON.stringify(other.body).includes('Mine.'), false);

    // And a malformed token is refused by withNamespace, like every other route.
    const bad = await post(`${url}/api/t/not-a-token/restore`, { slug: 'essay', turn_id: 1 });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.invalid_token, true);

    assert.equal(loadDocument('essay', { dir: mineDir }).history.length, 1, 'untouched');
  } finally {
    await close();
  }
});

test('the whole /ai-edit sequence runs inside a namespace', async () => {
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'essay', dir });

  const app = createServer({
    root,
    callModel: async () => ok('The model rewrote every word of this sentence carefully.\n'),
  });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${token}`;

  try {
    await post(`${base}/checkpoint`, {
      slug: 'essay',
      pendingDraft: 'The human wrote this sentence first, at some length.\n',
    });

    const { status, body } = await post(`${base}/ai-edit`, {
      slug: 'essay',
      prompt: 'rewrite it',
      pendingDraft: 'The human wrote this sentence first, at some length, then edited it.\n',
    });

    assert.equal(status, 200);
    assert.deepEqual(body.history.map((turn) => turn.author), ['human', 'human', 'ai']);
    assert.match(body.draft, /The model rewrote/);

    // And it landed in this namespace's directory, nowhere else.
    assert.ok(existsSync(join(dir, 'essay.json')));
    assert.equal(loadDocument('essay', { dir }).history.length, 3);
  } finally {
    await close();
  }
});

// ── the within-namespace document listing (chunk 7 item 4) ─────────────────────

test('GET /library lists this namespace and cannot see any other', async () => {
  const root = freshRoot();
  const mine = generateToken();
  const theirs = generateToken();
  const mineDir = resolveNamespace(mine, { root }).dir;
  const theirsDir = resolveNamespace(theirs, { root }).dir;

  createDocument({ slug: 'my-essay', dir: mineDir });
  createDocument({ slug: 'my-notes', dir: mineDir });
  createDocument({ slug: 'their-secret', dir: theirsDir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await call(`${url}/api/t/${mine}/library`);
    assert.equal(status, 200);

    const slugs = body.documents.map((doc) => doc.slug).sort();
    assert.deepEqual(slugs, ['my-essay', 'my-notes']);
    assert.equal(
      JSON.stringify(body).includes('their-secret'),
      false,
      'a capability token must not reveal that another namespace holds anything',
    );

    // And the other direction, so this is scoping rather than an accident of order.
    const other = await call(`${url}/api/t/${theirs}/library`);
    assert.deepEqual(other.body.documents.map((doc) => doc.slug), ['their-secret']);
  } finally {
    await close();
  }
});

test('no route lists namespaces or reads across them (§0.5)', async () => {
  const root = freshRoot();
  const token = generateToken();
  createDocument({ slug: 'private', dir: resolveNamespace(token, { root }).dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    // Every shape of "show me everything" that a reader of the URL scheme would
    // try. None may return a document listing.
    for (const path of [
      '/api/library',
      '/api/t/library',
      '/api/t//library',
      '/api/namespaces',
      '/api/t',
    ]) {
      const { status, body } = await call(`${url}${path}`);
      assert.notEqual(status, 200, `${path} must not answer`);
      assert.equal(
        JSON.stringify(body).includes('private'),
        false,
        `${path} must not name a document`,
      );
    }

    // A bad token is refused rather than treated as "list them all".
    const bad = await call(`${url}/api/t/not-a-token/library`);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.invalid_token, true);
  } finally {
    await close();
  }
});

test('a namespace with nothing in it lists nothing, and does not fail', async () => {
  const root = freshRoot();
  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await call(`${url}/api/t/${generateToken()}/library`);
    assert.equal(status, 200);
    assert.deepEqual(body.documents, []);
  } finally {
    await close();
  }
});

test('GET /documents still means the default document, not the listing', async () => {
  // The listing lives at its own address precisely so §0.5's missing-slug rule
  // keeps working. If the two ever merge, a fresh link stops opening onto
  // something writable — so assert both answers from one namespace at once.
  const root = freshRoot();
  const token = generateToken();
  const dir = resolveNamespace(token, { root }).dir;
  createDocument({ slug: 'one', dir });
  createDocument({ slug: 'two', dir });

  const app = createServer({ root, callModel: async () => ok('unused\n') });
  const { url, close } = await serve(app);

  try {
    const bare = await call(`${url}/api/t/${token}/documents`);
    assert.equal(bare.status, 200);
    assert.equal(bare.body.slug, DEFAULT_SLUG, 'still the default document');
    assert.equal(Array.isArray(bare.body.history), true, 'still a document, not a list');
    assert.equal(bare.body.documents, undefined, 'and not a listing');

    const list = await call(`${url}/api/t/${token}/library`);
    assert.deepEqual(
      list.body.documents.map((doc) => doc.slug).sort(),
      ['draft', 'one', 'two'],
      'the listing sees the default document the bare GET just created, and the rest',
    );
  } finally {
    await close();
  }
});
