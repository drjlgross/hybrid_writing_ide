/**
 * Context and rules over HTTP (CLAUDE.md §8, §10, §0.10, §5's endpoint rule).
 *
 * §5: "Context and rules are their own CRUD endpoints and **must not initiate a
 * turn**." That is the claim this file exists to prove, from outside the process,
 * against the real Express app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../src/server.js';
import { generateToken, resolveNamespaceFiles } from '../src/namespace.js';
import { createDocument, loadDocument, saveDocument } from '../src/storage.js';
import { commitHumanTurn } from '../src/turns.js';
import { CONTEXT_BUNDLE } from './fixtures/context/index.js';
import { modelResponse } from './helpers/model-response.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

function freshNamespace() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const root = mkdtempSync(join(TMP_ROOT, 'ctx-http-'));
  const token = generateToken();
  return { root, token, ...resolveNamespaceFiles(token, { root }) };
}

async function serve(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const send = async (url, method, body) => {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const post = (url, body) => send(url, 'POST', body);
const del = (url, body) => send(url, 'DELETE', body);

function seed(dir, slug = 'draft') {
  const doc = createDocument({ slug, dir });
  const { doc: withTurn } = commitHumanTurn(doc, 'The draft as it stands, at some length.\n');
  return saveDocument(withTurn, { dir });
}

const attachBody = (file, description) => ({
  slug: 'draft',
  filename: file.filename,
  type: file.type,
  description,
  data: file.bytes.toString('base64'),
});

test('§0.10 / §5 no context or rules endpoint initiates a turn', async () => {
  // The locked decision, over the wire. Every mutation below is checked against
  // the ledger and the draft as they stood before it.
  const ns = freshNamespace();
  const before = seed(ns.dir);
  const app = createServer({ root: ns.root, callModel: async () => modelResponse('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${ns.token}`;

  try {
    const calls = [
      ['attach text', () => post(`${base}/context`, attachBody(CONTEXT_BUNDLE.text, 'tone reference'))],
      ['attach image', () => post(`${base}/context`, attachBody(CONTEXT_BUNDLE.image, 'the thread'))],
      ['add rule', () => post(`${base}/rules`, { slug: 'draft', text: 'no em-dashes' })],
    ];

    const ids = {};
    for (const [label, call] of calls) {
      const { status, body } = await call();
      assert.equal(status, 200, label);
      assert.equal(body.turns, before.history.length, `${label} did not move the turn count`);
      if (body.file) ids.file = body.file.id;
      if (body.rule) ids.rule = body.rule.id;

      const onDisk = loadDocument('draft', { dir: ns.dir });
      assert.equal(onDisk.draft, before.draft, `${label} left the draft alone`);
      assert.deepEqual(onDisk.history, before.history, `${label} left the ledger alone`);
    }

    // …and the same for describe, remove, update, clear.
    const more = [
      ['describe', () => post(`${base}/context/${ids.file}/description`, { slug: 'draft', description: 'rewritten' })],
      ['update rule', () => post(`${base}/rules/${ids.rule}`, { slug: 'draft', text: 'really, no em-dashes' })],
      ['remove rule', () => del(`${base}/rules/${ids.rule}`, { slug: 'draft' })],
      ['remove context', () => del(`${base}/context/${ids.file}`, { slug: 'draft' })],
      ['clear context', () => post(`${base}/context/clear`, { slug: 'draft' })],
    ];
    for (const [label, call] of more) {
      const { status, body } = await call();
      assert.equal(status, 200, label);
      assert.equal(body.turns, before.history.length, `${label} did not move the turn count`);
    }

    const finally_ = loadDocument('draft', { dir: ns.dir });
    assert.deepEqual(finally_.history, before.history, 'the ledger is untouched from start to finish');
    assert.equal(finally_.draft, before.draft);
  } finally {
    await close();
  }
});

test('§0.5 amended: content lands under files/, metadata in the document', async () => {
  const ns = freshNamespace();
  seed(ns.dir);
  const app = createServer({ root: ns.root, callModel: async () => modelResponse('unused\n') });
  const { url, close } = await serve(app);

  try {
    const { body } = await post(
      `${url}/api/t/${ns.token}/context`,
      attachBody(CONTEXT_BUNDLE.image, 'a screenshot of the thread'),
    );

    assert.equal(body.file.kind, 'image');
    assert.equal(body.file.extraction, 'ok');
    assert.ok(existsSync(join(ns.filesDir, body.file.id)), 'bytes are a sibling file');
    assert.deepEqual(readdirSync(ns.filesDir), [body.file.id]);

    // The document JSON has no bytes in it.
    const raw = JSON.stringify(loadDocument('draft', { dir: ns.dir }));
    assert.doesNotMatch(raw, /[A-Za-z0-9+/]{200,}={0,2}/, 'no base64 in the document');
    assert.match(raw, new RegExp(body.file.id), 'but the metadata is there');
  } finally {
    await close();
  }
});

test('§8 C3 a broken image is stored and reported, not rejected', async () => {
  const ns = freshNamespace();
  seed(ns.dir);
  const app = createServer({ root: ns.root, callModel: async () => modelResponse('unused\n') });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/api/t/${ns.token}/context`, {
      slug: 'draft',
      filename: 'truncated.png',
      type: 'image/png',
      data: Buffer.from('this is not a png').toString('base64'),
    });

    assert.equal(status, 200, 'kept — she may still want it');
    assert.equal(body.file.extraction, 'failed');
    assert.match(body.file.extraction_error, /not a valid PNG/);
  } finally {
    await close();
  }
});

test('§8 C5 wholesale discard removes every file from disk', async () => {
  const ns = freshNamespace();
  seed(ns.dir);
  const app = createServer({ root: ns.root, callModel: async () => modelResponse('unused\n') });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${ns.token}`;

  try {
    await post(`${base}/context`, attachBody(CONTEXT_BUNDLE.text, 'a'));
    await post(`${base}/context`, attachBody(CONTEXT_BUNDLE.image, 'b'));
    assert.equal(readdirSync(ns.filesDir).length, 2);

    const { body } = await post(`${base}/context/clear`, { slug: 'draft' });
    assert.deepEqual(body.context, []);
    assert.deepEqual(readdirSync(ns.filesDir), [], 'the bytes went too');
  } finally {
    await close();
  }
});

test('an unsupported file is refused with a reason, and stores nothing', async () => {
  const ns = freshNamespace();
  seed(ns.dir);
  const app = createServer({ root: ns.root, callModel: async () => modelResponse('unused\n') });
  const { url, close } = await serve(app);

  try {
    const { status, body } = await post(`${url}/api/t/${ns.token}/context`, {
      slug: 'draft',
      filename: 'report.pdf',
      type: 'application/pdf',
      data: Buffer.from('%PDF-1.4').toString('base64'),
    });

    assert.equal(status, 400);
    assert.equal(body.reason, 'unsupported_type');
    assert.match(body.error, /Text .* and images/);
    assert.equal(existsSync(ns.filesDir) ? readdirSync(ns.filesDir).length : 0, 0);
  } finally {
    await close();
  }
});

test('§2.1 an AI turn carries the context and the rules, and does not consume them', async () => {
  // §5's third fixture exists to test exactly this: context is assembled into the
  // payload, survives a turn, and is not consumed by it.
  const ns = freshNamespace();
  seed(ns.dir);

  let seen = null;
  const app = createServer({
    root: ns.root,
    callModel: async (input) => {
      seen = input;
      return modelResponse('A revised draft, at comparable length to the one before it.\n');
    },
  });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${ns.token}`;

  try {
    await post(`${base}/context`, attachBody(CONTEXT_BUNDLE.text, 'house style — tone, not content'));
    await post(`${base}/context`, attachBody(CONTEXT_BUNDLE.image, 'the thread it came from'));
    await post(`${base}/rules`, { slug: 'draft', text: 'no em-dashes' });

    const { status, body } = await post(`${base}/ai-edit`, { slug: 'draft', prompt: 'tighten it' });
    assert.equal(status, 200);

    // The payload carried both, with the descriptions.
    assert.equal(seen.context.length, 2);
    assert.equal(seen.context.find((c) => c.kind === 'text').file.description, 'house style — tone, not content');
    // BYTE-EXACT, not merely present. A live turn can only tell you the model's
    // description was approximate; it cannot tell you whether the approximation
    // came from the model or from our own pipeline degrading the image. This
    // settles that half: what reaches `callModel` is the fixture, unchanged.
    const sentImage = seen.context.find((c) => c.kind === 'image');
    assert.deepEqual(
      Buffer.from(sentImage.base64, 'base64'),
      CONTEXT_BUNDLE.image.bytes,
      'the image on the wire is byte-identical to the file on disk',
    );
    assert.equal(sentImage.type, 'image/png', 'with the media type the API needs');
    assert.match(seen.rules, /- no em-dashes/);

    // NOT CONSUMED: still attached after the turn, in the response and on disk.
    assert.equal(body.context.length, 2, 'chips persist across submits (§12)');
    assert.equal(body.rules.length, 1);
    assert.equal(loadDocument('draft', { dir: ns.dir }).context.length, 2);
    assert.equal(readdirSync(ns.filesDir).length, 2);

    // §3: the turn records what was in scope, by id and not by content.
    assert.equal(body.ai_turn.context_ref.length, 2);
    assert.equal(body.ai_turn.rules_ref.length, 1);
    assert.doesNotMatch(JSON.stringify(body.ai_turn), /[A-Za-z0-9+/]{200,}={0,2}/, 'ids, not bytes');
  } finally {
    await close();
  }
});

test('a context file whose bytes vanished warns on the turn rather than failing it', async () => {
  const ns = freshNamespace();
  seed(ns.dir);
  const app = createServer({
    root: ns.root,
    callModel: async () => modelResponse('A revised draft, at comparable length to the one before it.\n'),
  });
  const { url, close } = await serve(app);
  const base = `${url}/api/t/${ns.token}`;

  try {
    const { body: attached } = await post(`${base}/context`, attachBody(CONTEXT_BUNDLE.text, 'notes'));
    // Bytes gone from under it — a backup restore, a stray rm.
    const { rmSync } = await import('node:fs');
    rmSync(join(ns.filesDir, attached.file.id));

    const { status, body } = await post(`${base}/ai-edit`, { slug: 'draft', prompt: 'tighten it' });
    assert.equal(status, 200, 'the turn still runs with what survives');
    assert.ok(body.ai_turn.warnings.some((w) => /missing from storage/.test(w)), 'and says what did not');
  } finally {
    await close();
  }
});
