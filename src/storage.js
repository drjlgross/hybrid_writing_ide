/**
 * Persistence for documents (CLAUDE.md §0.5), with the §0.3 ledger invariant.
 *
 * One JSON file per document. Full snapshots, never deltas (§0.4). Every write is
 * atomic: contents land in `{slug}.json.tmp`, are flushed, then renamed over the
 * real path — rename is atomic on POSIX, so a crash mid-write leaves the previous
 * file whole.
 *
 * Canonicalize runs here, on the write path into the snapshot store, which is one
 * of the exactly two places §0.1 permits.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { canonicalize } from './canonicalize.js';

export const SCHEMA_VERSION = 1;
export const DEFAULT_DOCUMENTS_DIR = 'documents';

/** Thrown when the ledger and the working draft disagree (§0.3). */
export class LedgerInvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerInvariantError';
  }
}

/** Thrown when a slug is already taken. Never overwrite (§0.5). */
export class SlugCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlugCollisionError';
  }
}

/**
 * Lowercase, alphanumeric and hyphens, repeats collapsed (§0.5).
 *
 * A slug that sanitizes to nothing is refused rather than silently replaced with a
 * generated one: the human asked for a specific name, and quietly filing their
 * document under a timestamp would be worse than saying no.
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeSlug(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError(`slug must be a string, got ${typeof raw}`);
  }

  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // a RUN of non-slug characters becomes one hyphen,
    .replace(/^-|-$/g, ''); //     which is what collapses repeats — see the test

  if (slug === '') {
    throw new Error(
      `slug ${JSON.stringify(raw)} contains no usable characters — it sanitizes to an ` +
        'empty string. Supply a slug with at least one letter or digit, or supply none ' +
        'and one will be generated.',
    );
  }
  return slug;
}

/**
 * A slug from a timestamp, for when the human supplies none (§0.5).
 * Milliseconds are included so two documents created in the same second do not
 * collide — a collision is refused, not resolved, so it is worth avoiding.
 *
 * @param {Date} [now]
 */
export function timestampSlug(now = new Date()) {
  return `doc-${now.toISOString().replace(/[^0-9]/g, '').slice(0, 17)}`;
}

export function documentPath(slug, dir = DEFAULT_DOCUMENTS_DIR) {
  return join(dir, `${slug}.json`);
}

export function tempPath(slug, dir = DEFAULT_DOCUMENTS_DIR) {
  return `${documentPath(slug, dir)}.tmp`;
}

/**
 * The §0.3 invariant: the last committed turn's snapshot IS the working draft.
 *
 * Empty history is the turn-zero case §0.3 does not spell out. Read strictly,
 * `history[-1].snapshot === draft` would compare `undefined` to the draft, so a
 * fresh document could only ever hold an empty draft. That is the reading taken
 * here: no turns means no text, and any draft text must have arrived as a turn.
 *
 * @param {{history: unknown[], draft: string}} doc
 */
export function assertLedgerInvariant(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new LedgerInvariantError(`document is not an object: ${JSON.stringify(doc)}`);
  }
  if (!Array.isArray(doc.history)) {
    throw new LedgerInvariantError(`document.history is not an array: ${JSON.stringify(doc.history)}`);
  }
  if (typeof doc.draft !== 'string') {
    throw new LedgerInvariantError(`document.draft is not a string: ${typeof doc.draft}`);
  }

  if (doc.history.length === 0) {
    if (doc.draft !== '') {
      throw new LedgerInvariantError(
        `LEDGER INVARIANT VIOLATED in ${JSON.stringify(doc.slug)}: the document has no ` +
          `turns but the working draft holds ${doc.draft.length} characters. Text exists ` +
          'that no turn accounts for — the ledger has drifted from the draft.',
      );
    }
    return;
  }

  const last = doc.history[doc.history.length - 1];
  if (last?.snapshot !== doc.draft) {
    throw new LedgerInvariantError(
      `LEDGER INVARIANT VIOLATED in ${JSON.stringify(doc.slug)}: the working draft does ` +
        `not match turn ${last?.turn_id}'s snapshot, which is the last committed turn.\n` +
        `  draft   : ${JSON.stringify(String(doc.draft).slice(0, 120))}\n` +
        `  snapshot: ${JSON.stringify(String(last?.snapshot).slice(0, 120))}`,
    );
  }
}

/**
 * Canonicalize everything that will be stored, then check the invariant against the
 * canonical forms — checking before would compare a canonical snapshot to a draft
 * that is about to become canonical, and fail spuriously.
 */
function normalize(doc) {
  return {
    ...doc,
    draft: canonicalize(doc.draft),
    history: doc.history.map((turn) => ({ ...turn, snapshot: canonicalize(turn.snapshot) })),
  };
}

/**
 * Write atomically: temp file, flush to disk, rename over the target.
 *
 * @param {string} finalPath
 * @param {string} tmp
 * @param {string} contents
 * @param {{beforeRename?: () => void}} [hooks] test seam for simulating a crash
 */
function atomicWrite(finalPath, tmp, contents, hooks = {}) {
  mkdirSync(dirname(finalPath), { recursive: true });

  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd); // the rename is only atomic with respect to data already on disk
  } finally {
    closeSync(fd);
  }

  // A crash here is the case §0.5 cares about: the temp file exists and is complete,
  // the real file is untouched, and nothing has been lost.
  hooks.beforeRename?.();

  renameSync(tmp, finalPath);
}

/**
 * Create a new document. Refuses to overwrite an existing slug (§0.5).
 *
 * A new document is always empty. There is deliberately no way to seed a draft
 * here: the §0.3 invariant forbids text that no turn accounts for, so initial text
 * has to arrive as a turn like any other edit.
 *
 * @param {{slug?: string, dir?: string, now?: Date, hooks?: object}} options
 */
export function createDocument({ slug, dir = DEFAULT_DOCUMENTS_DIR, now = new Date(), hooks } = {}) {
  const resolved = slug === undefined || slug === null || slug === '' ? timestampSlug(now) : sanitizeSlug(slug);

  const path = documentPath(resolved, dir);
  if (existsSync(path)) {
    throw new SlugCollisionError(
      `a document already exists at ${path}. Slugs are never overwritten (§0.5) — ` +
        'choose another slug.',
    );
  }

  const doc = normalize({
    schema_version: SCHEMA_VERSION,
    slug: resolved,
    created_at: now.toISOString(),
    draft: '',
    history: [],
  });

  assertLedgerInvariant(doc);
  atomicWrite(path, tempPath(resolved, dir), `${JSON.stringify(doc, null, 2)}\n`, hooks);
  return doc;
}

/**
 * Persist a document. Canonicalizes, asserts the §0.3 invariant, writes atomically.
 *
 * @param {object} doc
 * @param {{dir?: string, hooks?: object}} [options]
 */
export function saveDocument(doc, { dir = DEFAULT_DOCUMENTS_DIR, hooks } = {}) {
  if (!doc?.slug) {
    throw new Error('cannot save a document with no slug');
  }
  if (doc.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `refusing to write schema_version ${JSON.stringify(doc.schema_version)}; ` +
        `this build writes ${SCHEMA_VERSION}`,
    );
  }

  const normalized = normalize(doc);
  assertLedgerInvariant(normalized);
  atomicWrite(
    documentPath(doc.slug, dir),
    tempPath(doc.slug, dir),
    `${JSON.stringify(normalized, null, 2)}\n`,
    hooks,
  );
  return normalized;
}

/**
 * Read a document. Verifies schema_version and the §0.3 invariant on the way in, so
 * a file corrupted or hand-edited into an inconsistent state fails loudly at load
 * rather than silently becoming the working draft.
 *
 * @param {string} slug
 * @param {{dir?: string}} [options]
 */
export function loadDocument(slug, { dir = DEFAULT_DOCUMENTS_DIR } = {}) {
  const path = documentPath(slug, dir);
  const doc = JSON.parse(readFileSync(path, 'utf8'));

  if (doc.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `${path} has schema_version ${JSON.stringify(doc.schema_version)}; ` +
        `this build reads ${SCHEMA_VERSION}`,
    );
  }

  assertLedgerInvariant(doc);
  return doc;
}

/** True if a document with this slug exists. */
export function documentExists(slug, { dir = DEFAULT_DOCUMENTS_DIR } = {}) {
  return existsSync(documentPath(slug, dir));
}
