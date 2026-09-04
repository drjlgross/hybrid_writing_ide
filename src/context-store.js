/**
 * Context files (CLAUDE.md §8, locked behavior §0.10, storage §0.5 as amended).
 *
 * SPLIT STORAGE, and the split is the whole design:
 *
 *   metadata  → the document JSON, `doc.context[]`. Read on every load.
 *   content   → `documents/{token}/files/{id}`. Read only when a turn needs it.
 *
 * The document JSON is the SOURCE OF TRUTH for what exists. A file on disk with
 * no metadata entry is not context — it is an orphan, and `listContext` will
 * never show it. That direction matters: it means a half-finished write leaves
 * junk rather than phantom context, and deleting metadata is what deletes
 * context (the bytes go with it).
 *
 * §0.10 is the rule that shapes the API here: **nothing in this file commits a
 * turn.** Adding, describing and discarding context are document mutations that
 * leave `history` and `draft` untouched. Supplying context and asking for an
 * edit are different acts, and conflating them produces the unrequested rewrite
 * the evidence says most reliably destroys trust. Every function returns the
 * document; none of them can reach `commitHumanTurn`.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** What the model can read. §8 C3: images are first-class, not an exception. */
export const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);
export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * Per-file ceiling. The API caps a whole request at 32MB and a long draft has to
 * fit beside the context, so this leaves room rather than spending it all in one
 * attachment.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Thrown when a file cannot be accepted. The document is left alone. */
export class ContextError extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = 'ContextError';
    this.reason = reason;
  }
}

/** Ids are unguessable and filename-safe: they become paths under `files/`. */
export function generateContextId() {
  return randomBytes(12).toString('hex');
}

/** `files/{id}` — never derived from the human's filename, which is not sanitized. */
export function contextPath(id, filesDir) {
  if (!/^[0-9a-f]{24}$/.test(id)) {
    throw new ContextError(`refusing to resolve a context path for ${JSON.stringify(id)}`, {
      reason: 'bad_id',
    });
  }
  return join(filesDir, id);
}

/** A filename a human can read back. Sanitized for display, never for the path. */
export function displayName(filename) {
  const trimmed = String(filename ?? '').trim().slice(0, 120);
  return trimmed === '' ? 'untitled' : trimmed;
}

/**
 * Attach a file to a document (§8 C1).
 *
 * @param {object} doc
 * @param {{filename: string, type: string, bytes: Buffer, description?: string,
 *   filesDir: string, now?: Date}} input
 * @returns {{doc: object, file: object}}
 */
export function addContextFile(doc, { filename, type, bytes, description, filesDir, now = new Date() }) {
  if (!Buffer.isBuffer(bytes)) throw new ContextError('a context file needs its bytes', { reason: 'no_bytes' });
  if (bytes.length === 0) throw new ContextError('that file is empty', { reason: 'empty' });
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ContextError(
      `that file is ${Math.round(bytes.length / 1024)}KB, over the ` +
        `${Math.round(MAX_FILE_BYTES / 1024)}KB limit for one context file`,
      { reason: 'too_large' },
    );
  }

  const kind = kindOf(type);
  if (kind === null) {
    throw new ContextError(
      `${JSON.stringify(type)} is not something the model can read as context. ` +
        `Text (${[...TEXT_TYPES].join(', ')}) and images (${[...IMAGE_TYPES].join(', ')}).`,
      { reason: 'unsupported_type' },
    );
  }

  const id = generateContextId();
  const path = contextPath(id, filesDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);

  // §8 C3: extraction is attempted at attach time so a failure surfaces on the
  // chip rather than silently degrading a turn hours later. For text that means
  // decoding; for an image it means confirming the bytes are what the type says,
  // since the model does the reading and a truncated PNG fails at the API.
  const extraction = extract({ kind, type, bytes });

  const file = {
    id,
    filename: displayName(filename),
    type,
    kind,
    bytes: bytes.length,
    // §8 C2/C2a: freeform, pre-populated by the caller from the prompt where she
    // stated it inline. Empty is allowed — a blank field is a tax, not an error.
    description: typeof description === 'string' ? description : '',
    added_at: now.toISOString(),
    extraction: extraction.status,
    ...(extraction.error ? { extraction_error: extraction.error } : {}),
  };

  return { doc: { ...doc, context: [...(doc.context ?? []), file] }, file };
}

/** text | image | null. */
export function kindOf(type) {
  if (TEXT_TYPES.has(type)) return 'text';
  if (IMAGE_TYPES.has(type)) return 'image';
  return null;
}

/**
 * Can the model actually read this? (§8 C3)
 *
 * Deliberately NOT OCR or captioning — §8 says the MODEL reads images, so the
 * only question here is whether the bytes will survive the trip. What fails at
 * this stage is a file that is not what it claims: a text file that is not valid
 * UTF-8, or an image whose magic bytes disagree with its type. Both would
 * otherwise fail inside a turn, where the human has already waited.
 */
export function extract({ kind, type, bytes }) {
  if (kind === 'text') {
    const text = bytes.toString('utf8');
    // A replacement character means the bytes were not UTF-8. The file is kept —
    // the human may still want it — but the chip says it could not be read.
    if (text.includes('�')) {
      return { status: 'failed', error: 'not valid UTF-8 text, so the model cannot read it' };
    }
    if (text.trim() === '') return { status: 'failed', error: 'the file has no readable text in it' };
    return { status: 'ok' };
  }

  const signature = MAGIC[type];
  if (signature && !bytes.subarray(0, signature.length).equals(signature)) {
    return { status: 'failed', error: `the bytes are not a valid ${type.replace('image/', '').toUpperCase()}` };
  }
  return { status: 'ok' };
}

/** First bytes of each image format, for the "is it what it says" check. */
const MAGIC = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/gif': Buffer.from('GIF8', 'latin1'),
};

/** §8 C2: the human rewrites a description whenever she likes. Never a turn. */
export function describeContextFile(doc, id, description) {
  const context = (doc.context ?? []).map((file) =>
    file.id === id ? { ...file, description: String(description ?? '') } : file,
  );
  if (!context.some((file) => file.id === id)) {
    throw new ContextError(`no context file ${JSON.stringify(id)} on this document`, { reason: 'not_found' });
  }
  return { ...doc, context };
}

/**
 * §8 C5: discard one file. A first-class operation, not a session restart.
 *
 * The metadata goes first and the bytes follow. That order is what keeps the
 * document the source of truth: if the unlink fails, the file is already not
 * context, and the leftover bytes are an orphan rather than a phantom entry.
 */
export function removeContextFile(doc, id, { filesDir }) {
  const before = doc.context ?? [];
  const context = before.filter((file) => file.id !== id);
  if (context.length === before.length) {
    throw new ContextError(`no context file ${JSON.stringify(id)} on this document`, { reason: 'not_found' });
  }
  rmSync(contextPath(id, filesDir), { force: true });
  return { ...doc, context };
}

/**
 * §8 C5: discard ALL of it, in one action.
 *
 * Two of the three long records the spec was derived from destroy context on
 * purpose to get their best output — an audit that must not reuse its own
 * conclusions, a cold read that works by clearing history — so this is a
 * first-class move, not a cleanup utility.
 */
export function clearContext(doc, { filesDir }) {
  for (const file of doc.context ?? []) rmSync(contextPath(file.id, filesDir), { force: true });
  return { ...doc, context: [] };
}

/** The metadata, which is all the UI ever needs. Never reads the bytes. */
export function listContext(doc) {
  return [...(doc.context ?? [])];
}

/**
 * Load one file's content, for a turn.
 *
 * The ONLY function here that touches bytes, and it is called from the payload
 * builder and nowhere else — which is what keeps a document listing cheap.
 * Missing bytes are reported rather than thrown: a turn should still run with
 * the context that survives, and the warning says which did not.
 */
export function readContextContent(file, { filesDir }) {
  const path = contextPath(file.id, filesDir);
  if (!existsSync(path)) {
    return { id: file.id, error: `${file.filename} is missing from storage and was not sent` };
  }
  try {
    const bytes = readFileSync(path);
    return file.kind === 'image'
      ? { id: file.id, kind: 'image', type: file.type, base64: bytes.toString('base64') }
      : { id: file.id, kind: 'text', text: bytes.toString('utf8') };
  } catch (error) {
    return { id: file.id, error: `${file.filename} could not be read (${error.code ?? 'unreadable'})` };
  }
}
