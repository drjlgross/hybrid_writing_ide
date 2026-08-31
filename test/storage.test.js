/**
 * CLAUDE.md §0.5 storage shape and §0.3 ledger invariant.
 *
 * Every test writes into a fresh directory under `.tmp-test/`, which is gitignored.
 * Test artifacts stay out of `documents/` so a test run cannot disturb real drafts,
 * and out of the committed tree. `.tmp-test/` is inside the project root because the
 * sandbox rule forbids writing anywhere above it, including the OS temp directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LedgerInvariantError,
  SCHEMA_VERSION,
  SlugCollisionError,
  assertLedgerInvariant,
  createDocument,
  documentExists,
  documentPath,
  listDocuments,
  loadDocument,
  sanitizeSlug,
  saveDocument,
  tempPath,
  timestampSlug,
} from '../src/storage.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

/** A fresh directory per test, so no test can see another's files. */
function freshDir() {
  mkdirSync(TMP_ROOT, { recursive: true });
  return mkdtempSync(join(TMP_ROOT, 'storage-'));
}

test('sanitizeSlug: lowercase, alphanumeric and hyphens, repeats collapsed', () => {
  const cases = [
    ['My First Draft', 'my-first-draft'],
    ['already-clean', 'already-clean'],
    ['UPPER', 'upper'],
    ['spaces   everywhere', 'spaces-everywhere'],
    ['under_scores_and.dots', 'under-scores-and-dots'],
    ['a---b', 'a-b'],
    ['a___b', 'a-b'],
    ['--leading-and-trailing--', 'leading-and-trailing'],
    ['punctuation!?#$', 'punctuation'],
    ['keeps123digits', 'keeps123digits'],
    ['café résumé', 'caf-r-sum'], // non-ASCII is dropped, not transliterated
  ];
  for (const [input, expected] of cases) {
    assert.equal(sanitizeSlug(input), expected, `sanitizeSlug(${JSON.stringify(input)})`);
  }
});

test('sanitizeSlug refuses a slug that sanitizes to nothing', () => {
  for (const input of ['', '   ', '!!!', '---', '日本語']) {
    assert.throws(
      () => sanitizeSlug(input),
      /contains no usable characters/,
      `expected ${JSON.stringify(input)} to be refused`,
    );
  }
  assert.throws(() => sanitizeSlug(undefined), TypeError);
});

test('timestampSlug is derived from the timestamp and is slug-shaped', () => {
  const slug = timestampSlug(new Date('2026-07-25T16:45:00.123Z'));
  assert.equal(slug, 'doc-20260725164500123');
  assert.equal(sanitizeSlug(slug), slug, 'a generated slug must already be canonical');
});

test('createDocument writes one file per document, with schema_version from turn zero', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'My First Draft', dir });

  assert.equal(doc.slug, 'my-first-draft');
  assert.equal(doc.schema_version, SCHEMA_VERSION);
  assert.deepEqual(doc.history, []);
  assert.equal(doc.draft, '');

  const path = documentPath('my-first-draft', dir);
  assert.ok(existsSync(path), `expected ${path} to exist`);

  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk.schema_version, SCHEMA_VERSION, 'schema_version must be present from turn zero');
  assert.equal(onDisk.slug, 'my-first-draft');
  assert.deepEqual(onDisk.history, []);
  assert.ok(onDisk.created_at, 'created_at must be present');
});

test('createDocument generates a timestamp slug when none is given', () => {
  const dir = freshDir();
  const doc = createDocument({ dir, now: new Date('2026-07-25T16:45:00.123Z') });
  assert.equal(doc.slug, 'doc-20260725164500123');
  assert.ok(documentExists(doc.slug, { dir }));

  // An empty-string slug is "no slug given", not a slug that sanitizes to nothing.
  const blank = createDocument({ slug: '', dir, now: new Date('2026-07-25T16:45:01.000Z') });
  assert.equal(blank.slug, 'doc-20260725164501000');
});

test('a slug collision is refused, and the existing document is untouched', () => {
  const dir = freshDir();
  const original = createDocument({ slug: 'shared', dir });
  saveDocument(
    { ...original, draft: 'original text\n', history: [{ turn_id: 1, snapshot: 'original text\n' }] },
    { dir },
  );
  const before = readFileSync(documentPath('shared', dir), 'utf8');

  assert.throws(() => createDocument({ slug: 'shared', dir }), SlugCollisionError);
  // Different input, same sanitized slug — the collision check runs after sanitizing.
  assert.throws(() => createDocument({ slug: 'SHARED', dir }), SlugCollisionError);
  assert.throws(() => createDocument({ slug: 'Shared!!', dir }), SlugCollisionError);

  assert.equal(readFileSync(documentPath('shared', dir), 'utf8'), before, 'existing file changed');
});

test('a successful write leaves no .tmp file behind', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'tidy', dir });
  assert.equal(existsSync(tempPath('tidy', dir)), false, 'temp file survived createDocument');

  saveDocument({ ...doc, draft: 'text\n', history: [{ turn_id: 1, snapshot: 'text\n' }] }, { dir });
  assert.equal(existsSync(tempPath('tidy', dir)), false, 'temp file survived saveDocument');
});

test('a crash between write and rename leaves the previous file intact', () => {
  const dir = freshDir();
  const first = createDocument({ slug: 'crashy', dir });
  const committed = saveDocument(
    { ...first, draft: 'first version\n', history: [{ turn_id: 1, snapshot: 'first version\n' }] },
    { dir },
  );

  const path = documentPath('crashy', dir);
  const beforeBytes = readFileSync(path);

  // The crash: the temp file is written and flushed, then the process dies before
  // the rename. Nothing has touched the real path.
  assert.throws(
    () =>
      saveDocument(
        { ...committed, draft: 'second version\n', history: [{ turn_id: 1, snapshot: 'second version\n' }] },
        { dir, hooks: { beforeRename: () => { throw new Error('simulated crash'); } } },
      ),
    /simulated crash/,
  );

  assert.deepEqual(readFileSync(path), beforeBytes, 'the previous file was modified by a crashed write');

  const reloaded = loadDocument('crashy', { dir });
  assert.equal(reloaded.draft, 'first version\n', 'the previous session was lost');
  assert.equal(reloaded.history.length, 1);

  // The abandoned temp file holds the complete new version — it is written and
  // flushed before the rename — and is ignored by the reader.
  assert.ok(existsSync(tempPath('crashy', dir)), 'expected the temp file to survive the crash');
  assert.equal(JSON.parse(readFileSync(tempPath('crashy', dir), 'utf8')).draft, 'second version\n');

  // And a later good write still succeeds over the stale temp file.
  saveDocument(
    { ...committed, draft: 'third version\n', history: [{ turn_id: 1, snapshot: 'third version\n' }] },
    { dir },
  );
  assert.equal(loadDocument('crashy', { dir }).draft, 'third version\n');
  assert.equal(existsSync(tempPath('crashy', dir)), false);
});

test('the §0.3 invariant throws when violated deliberately', () => {
  // Constructed violation: the ledger says one thing, the draft says another.
  assert.throws(
    () =>
      assertLedgerInvariant({
        slug: 'drifted',
        draft: 'what the human sees\n',
        history: [{ turn_id: 1, snapshot: 'what the ledger recorded\n' }],
      }),
    (error) =>
      error instanceof LedgerInvariantError &&
      /LEDGER INVARIANT VIOLATED/.test(error.message) &&
      /turn 1/.test(error.message),
  );

  // Text with no turn to account for it.
  assert.throws(
    () => assertLedgerInvariant({ slug: 'ghost', draft: 'appeared from nowhere\n', history: [] }),
    (error) => error instanceof LedgerInvariantError && /no turns but the working draft/.test(error.message),
  );

  // It is the LAST turn that must match, not any turn.
  assert.throws(
    () =>
      assertLedgerInvariant({
        slug: 'stale',
        draft: 'turn one text\n',
        history: [
          { turn_id: 1, snapshot: 'turn one text\n' },
          { turn_id: 2, snapshot: 'turn two text\n' },
        ],
      }),
    LedgerInvariantError,
  );

  // Malformed documents fail as invariant violations too, not as TypeErrors.
  assert.throws(() => assertLedgerInvariant(null), LedgerInvariantError);
  assert.throws(() => assertLedgerInvariant({ draft: 'x', history: 'not an array' }), LedgerInvariantError);
  assert.throws(() => assertLedgerInvariant({ draft: 42, history: [] }), LedgerInvariantError);
});

test('the §0.3 invariant holds for well-formed documents', () => {
  assert.doesNotThrow(() => assertLedgerInvariant({ slug: 'empty', draft: '', history: [] }));
  assert.doesNotThrow(() =>
    assertLedgerInvariant({
      slug: 'fine',
      draft: 'current\n',
      history: [{ turn_id: 1, snapshot: 'older\n' }, { turn_id: 2, snapshot: 'current\n' }],
    }),
  );
});

test('saveDocument refuses to write a document that violates the invariant', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'guarded', dir });
  const path = documentPath('guarded', dir);
  const before = readFileSync(path, 'utf8');

  assert.throws(
    () =>
      saveDocument(
        { ...doc, draft: 'draft text\n', history: [{ turn_id: 1, snapshot: 'different text\n' }] },
        { dir },
      ),
    LedgerInvariantError,
  );

  assert.equal(readFileSync(path, 'utf8'), before, 'a rejected write still changed the file');
  assert.equal(existsSync(tempPath('guarded', dir)), false, 'a rejected write left a temp file');
});

test('canonicalize runs on the write path (§0.1)', () => {
  const dir = freshDir();
  const messy = '* star bullet\n\n* another star bullet\n';
  const doc = createDocument({ slug: 'canon', dir });

  const saved = saveDocument(
    { ...doc, draft: messy, history: [{ turn_id: 1, snapshot: messy }] },
    { dir },
  );
  assert.equal(saved.draft, '- star bullet\n- another star bullet\n', 'draft was not canonicalized');
  assert.equal(saved.history[0].snapshot, '- star bullet\n- another star bullet\n', 'snapshot was not canonicalized');
  assert.equal(
    JSON.parse(readFileSync(documentPath('canon', dir), 'utf8')).history[0].snapshot,
    '- star bullet\n- another star bullet\n',
  );
});

test('load round-trips a document and rejects unreadable ones', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'round-trip', dir });
  const saved = saveDocument(
    { ...doc, draft: 'text with **bold**\n', history: [{ turn_id: 1, snapshot: 'text with **bold**\n' }] },
    { dir },
  );

  assert.deepEqual(loadDocument('round-trip', { dir }), saved);
  assert.throws(() => loadDocument('no-such-document', { dir }), /ENOENT/);

  // A file from a future or missing schema is refused rather than guessed at.
  writeFileSync(documentPath('future', dir), JSON.stringify({ schema_version: 99, draft: '', history: [] }));
  assert.throws(() => loadDocument('future', { dir }), /schema_version 99/);

  writeFileSync(documentPath('versionless', dir), JSON.stringify({ draft: '', history: [] }));
  assert.throws(() => loadDocument('versionless', { dir }), /schema_version undefined/);

  // A file that is internally inconsistent fails at load, not silently.
  writeFileSync(
    documentPath('tampered', dir),
    JSON.stringify({
      schema_version: SCHEMA_VERSION,
      slug: 'tampered',
      draft: 'hand-edited text\n',
      history: [{ turn_id: 1, snapshot: 'what was committed\n' }],
    }),
  );
  assert.throws(() => loadDocument('tampered', { dir }), LedgerInvariantError);
});

test('a new document is empty — text cannot be seeded behind the ledger', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'no-seeding', dir });
  assert.equal(doc.draft, '', 'a new document must hold no text');
  assert.deepEqual(doc.history, []);

  // The invariant is what forbids it: a draft with no turn accounting for it cannot
  // be written at all, so there is no way to create one by another route.
  assert.throws(
    () => saveDocument({ ...doc, draft: 'seeded behind the ledger\n' }, { dir }),
    LedgerInvariantError,
  );
});

test('saveDocument refuses a schema_version it does not write', () => {
  const dir = freshDir();
  const doc = createDocument({ slug: 'versioned', dir });
  assert.throws(() => saveDocument({ ...doc, schema_version: 99 }, { dir }), /refusing to write/);
  assert.throws(() => saveDocument({ ...doc, slug: undefined }, { dir }), /no slug/);
});

// ── listDocuments: one namespace, and only one (chunk 7 item 4) ────────────────

test('listDocuments returns this directory only, newest activity first', () => {
  const dir = freshDir();
  const sibling = freshDir(); // stands in for another namespace under the same root

  createDocument({ slug: 'alpha', dir, now: new Date('2026-01-01T00:00:00.000Z') });
  createDocument({ slug: 'beta', dir, now: new Date('2026-01-02T00:00:00.000Z') });
  createDocument({ slug: 'not-yours', dir: sibling });

  // Give alpha a turn dated after beta's creation, so ordering is by ACTIVITY
  // rather than by creation or by filename.
  const alpha = loadDocument('alpha', { dir });
  saveDocument(
    {
      ...alpha,
      draft: 'Alpha moved.\n',
      history: [
        {
          turn_id: 1,
          timestamp: '2026-03-01T00:00:00.000Z',
          author: 'human',
          snapshot: 'Alpha moved.\n',
        },
      ],
    },
    { dir },
  );

  const listed = listDocuments({ dir });

  assert.deepEqual(
    listed.map((doc) => doc.slug),
    ['alpha', 'beta'],
    'alpha edited most recently, and the sibling directory is invisible',
  );
  assert.equal(listed[0].turns, 1);
  assert.equal(listed[1].turns, 0);
  assert.equal(listed[0].updated_at, '2026-03-01T00:00:00.000Z');

  // The other direction, so this is scoping and not an artifact of ordering.
  assert.deepEqual(listDocuments({ dir: sibling }).map((doc) => doc.slug), ['not-yours']);
});

test('listDocuments ignores a write in flight and reports an unreadable file', () => {
  const dir = freshDir();
  createDocument({ slug: 'good', dir });

  // A `.json.tmp` is a half-written atomic write (§0.5). It is not a document.
  writeFileSync(join(dir, 'good.json.tmp'), '{"partial":');
  // A file that will not parse IS a document, as far as the human is concerned.
  writeFileSync(join(dir, 'broken.json'), 'this is not json');

  const listed = listDocuments({ dir });

  assert.deepEqual(listed.map((doc) => doc.slug).sort(), ['broken', 'good']);
  const broken = listed.find((doc) => doc.slug === 'broken');
  assert.ok(broken.unreadable, 'an unparseable document is shown as broken, never dropped');
  assert.equal(listed.find((doc) => doc.slug === 'good').unreadable, undefined);
});

test('listDocuments on a namespace that was never written to returns []', () => {
  assert.deepEqual(listDocuments({ dir: join(freshDir(), 'never-created') }), []);
});
