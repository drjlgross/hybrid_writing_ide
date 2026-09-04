/**
 * Context files (CLAUDE.md §8, §0.10, §0.5 as amended 2026-09-03).
 *
 * The load-bearing claims, in order of what would hurt most if they broke:
 *
 *   - §0.10: adding, describing and discarding context NEVER commits a turn.
 *   - §0.5 amended: bytes live under `files/{id}`; the document JSON holds
 *     metadata only, and is the source of truth for what exists.
 *   - §8 C3: extraction failure is recorded on the file, not swallowed.
 *   - §8 C5: discard works individually AND wholesale.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ContextError,
  MAX_FILE_BYTES,
  addContextFile,
  clearContext,
  describeContextFile,
  listContext,
  readContextContent,
  removeContextFile,
} from '../src/context-store.js';
import { CONTEXT_BUNDLE } from './fixtures/context/index.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));

function workspace() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'context-'));
  return { filesDir: join(dir, 'files') };
}

/** A document as storage hands it over, with a turn already in the ledger. */
const seeded = () => ({
  schema_version: 1,
  slug: 'draft',
  draft: 'The draft as it stands.\n',
  history: [{ turn_id: 1, author: 'human', snapshot: 'The draft as it stands.\n' }],
});

const attach = (doc, file, filesDir, description) =>
  addContextFile(doc, {
    filename: file.filename,
    type: file.type,
    bytes: file.bytes,
    description: description ?? file.description,
    filesDir,
  });

test('§0.5 amended: bytes go to files/{id}, the document JSON holds metadata only', () => {
  const { filesDir } = workspace();
  const { doc, file } = attach(seeded(), CONTEXT_BUNDLE.image, filesDir);

  // The content is on disk, byte-identical, under an unguessable id.
  const path = join(filesDir, file.id);
  assert.ok(existsSync(path), 'the bytes are a sibling file');
  assert.deepEqual(readFileSync(path), CONTEXT_BUNDLE.image.bytes);
  assert.match(file.id, /^[0-9a-f]{24}$/, 'and the id is filename-safe, not her filename');

  // The document carries metadata and NOT the bytes. This is the whole point of
  // the amendment: a listing must not pay for a screenshot.
  const serialized = JSON.stringify(doc);
  assert.doesNotMatch(serialized, /[A-Za-z0-9+/]{200,}={0,2}/, 'no base64 blob in the document JSON');
  assert.ok(serialized.length < 2000, `the document stays small: ${serialized.length} bytes`);
  assert.deepEqual(Object.keys(file).sort(), [
    'added_at', 'bytes', 'description', 'extraction', 'filename', 'id', 'kind', 'type',
  ]);
});

test('§0.10 attaching, describing and discarding never commit a turn', () => {
  // The locked decision, asserted at the store layer. Supplying context and
  // asking for an edit are different acts; conflating them is the failure the
  // whole design exists to prevent.
  const { filesDir } = workspace();
  const before = seeded();

  const { doc: attached, file } = attach(before, CONTEXT_BUNDLE.text, filesDir);
  const described = describeContextFile(attached, file.id, 'rewritten');
  const { doc: withImage } = attach(described, CONTEXT_BUNDLE.image, filesDir);
  const cleared = clearContext(withImage, { filesDir });

  for (const [label, doc] of [['attach', attached], ['describe', described], ['clear', cleared]]) {
    assert.equal(doc.draft, before.draft, `${label} left the draft alone`);
    assert.deepEqual(doc.history, before.history, `${label} left the ledger alone`);
  }

  // And the input was never mutated — the store is pure over documents.
  assert.deepEqual(before.context, undefined);
});

test('§8 C2/C2a a description is freeform, editable, and may be empty', () => {
  const { filesDir } = workspace();
  let { doc, file } = attach(seeded(), CONTEXT_BUNDLE.text, filesDir, 'look here for tone, not content');
  assert.equal(file.description, 'look here for tone, not content');

  doc = describeContextFile(doc, file.id, 'actually: source material');
  assert.equal(listContext(doc)[0].description, 'actually: source material');

  // Clearing it is legitimate — a blank field is a tax, not an error.
  doc = describeContextFile(doc, file.id, '');
  assert.equal(listContext(doc)[0].description, '');

  const attachedBlank = attach(seeded(), CONTEXT_BUNDLE.text, filesDir, undefined);
  assert.equal(attachedBlank.file.description, CONTEXT_BUNDLE.text.description);

  assert.throws(() => describeContextFile(doc, 'nope', 'x'), ContextError);
});

test('§8 C3 images are first-class, and a broken one says so on the file', () => {
  const { filesDir } = workspace();

  const good = attach(seeded(), CONTEXT_BUNDLE.image, filesDir);
  assert.equal(good.file.kind, 'image');
  assert.equal(good.file.extraction, 'ok');
  assert.ok(!('extraction_error' in good.file));

  // Bytes that are not the PNG they claim to be. The file is KEPT — she may
  // still want it — and the failure is recorded for the chip.
  const broken = addContextFile(seeded(), {
    filename: 'truncated.png',
    type: 'image/png',
    bytes: Buffer.from('not a png at all'),
    filesDir,
  });
  assert.equal(broken.file.extraction, 'failed');
  assert.match(broken.file.extraction_error, /not a valid PNG/);
  assert.ok(existsSync(join(filesDir, broken.file.id)), 'and the bytes are still stored');

  // Text that is not UTF-8 fails the same way.
  const binaryText = addContextFile(seeded(), {
    filename: 'notes.txt',
    type: 'text/plain',
    bytes: Buffer.from([0xff, 0xfe, 0x00, 0x41]),
    filesDir,
  });
  assert.equal(binaryText.file.extraction, 'failed');
  assert.match(binaryText.file.extraction_error, /UTF-8/);
});

test('§8 C5 discard works one at a time and wholesale, and the bytes go too', () => {
  const { filesDir } = workspace();
  let { doc, file: text } = attach(seeded(), CONTEXT_BUNDLE.text, filesDir);
  const { doc: two, file: image } = attach(doc, CONTEXT_BUNDLE.image, filesDir);

  const afterOne = removeContextFile(two, text.id, { filesDir });
  assert.deepEqual(listContext(afterOne).map((f) => f.id), [image.id]);
  assert.equal(existsSync(join(filesDir, text.id)), false, 'deleting context deletes the file');
  assert.ok(existsSync(join(filesDir, image.id)), 'and only that one');

  const afterAll = clearContext(afterOne, { filesDir });
  assert.deepEqual(listContext(afterAll), []);
  assert.equal(existsSync(join(filesDir, image.id)), false);

  assert.throws(() => removeContextFile(afterAll, image.id, { filesDir }), ContextError);
});

test('the document is the source of truth: an orphan file is not context', () => {
  // The direction that matters. A half-finished write leaves junk on disk rather
  // than a phantom entry in the document, and `listContext` never invents one.
  const { filesDir } = workspace();
  mkdirSync(filesDir, { recursive: true });
  writeFileSync(join(filesDir, 'a'.repeat(24)), 'orphaned bytes');

  assert.deepEqual(listContext(seeded()), [], 'a file with no metadata is not context');
});

test('what cannot be attached is refused, and refusal leaves the document alone', () => {
  const { filesDir } = workspace();
  const doc = seeded();

  for (const [label, input] of [
    ['a PDF', { filename: 'a.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }],
    ['an empty file', { filename: 'a.txt', type: 'text/plain', bytes: Buffer.alloc(0) }],
    ['no bytes', { filename: 'a.txt', type: 'text/plain', bytes: 'a string' }],
    ['too large', { filename: 'a.txt', type: 'text/plain', bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 0x41) }],
  ]) {
    assert.throws(() => addContextFile(doc, { ...input, filesDir }), ContextError, label);
  }

  assert.deepEqual(doc.context, undefined, 'nothing was attached');
});

test('content is read only when a turn needs it, and a missing file is reported', () => {
  const { filesDir } = workspace();
  const { doc, file } = attach(seeded(), CONTEXT_BUNDLE.text, filesDir);

  const loaded = readContextContent(file, { filesDir });
  assert.equal(loaded.kind, 'text');
  assert.match(loaded.text, /House style notes/);

  const image = attach(doc, CONTEXT_BUNDLE.image, filesDir);
  const loadedImage = readContextContent(image.file, { filesDir });
  assert.equal(loadedImage.kind, 'image');
  assert.equal(loadedImage.type, 'image/png');
  assert.equal(Buffer.from(loadedImage.base64, 'base64').length, CONTEXT_BUNDLE.image.bytes.length);

  // Bytes gone from under it: reported, not thrown. A turn should still run with
  // the context that survives, and the warning says which did not.
  const missing = readContextContent({ ...file, id: 'b'.repeat(24) }, { filesDir });
  assert.match(missing.error, /missing from storage/);
});
