/**
 * Reading an exported transcript back (CLAUDE.md §4, and the /view subsection).
 *
 * This is the counterpart to `transcript.js`. That one writes the §4 wrapper; this
 * one reads it, and the two are deliberately separate functions rather than one
 * module that round-trips, because they are used by different people at different
 * times — the writer runs inside a live session, the reader runs against a file
 * that may be a year old and may not have come from this version of the app.
 *
 * THE VALIDATION IS ON THE BYTES, not on an object someone already parsed. §4 is
 * explicit that "the only thing a later reader ever sees is those bytes", which is
 * why the export asserts `schema_version` on the file rather than trusting the code
 * that wrote it. A reader that took a parsed object would be trusting whoever did
 * the parsing, which is the same mistake one layer up.
 *
 * It never throws. A viewer whose failure mode is an exception is a viewer whose
 * failure mode is a blank page, and a blank page is indistinguishable from a page
 * that has not loaded. Every rejection comes back as a sentence naming what was
 * expected and what arrived.
 *
 * Nothing here reaches the network, the filesystem, or storage of any kind. The
 * text comes from a file the visitor chose in their own browser.
 */

import { SCHEMA_VERSION } from '../../src/schema.js';

/** The one shape this reader accepts. Imported, never re-declared, so it cannot
 * drift from the constant the writer stamps (§4: it is the SAME constant). */
export { SCHEMA_VERSION };

/**
 * @param {unknown} value
 * @returns {boolean} true for a plain object — not null, not an array. A JSON
 *   file whose top level is `[…]` parses fine and has no `schema_version`, and
 *   "expected an object" is a more useful sentence than "schema_version missing".
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate the bytes of an exported transcript.
 *
 * @param {string} text the file's contents, verbatim
 * @param {string} [filename] used only in messages, so the sentence can name the
 *   file the visitor actually chose
 * @returns {{ok: true, transcript: object} | {ok: false, error: string}}
 */
export function readExport(text, filename = '') {
  const named = filename ? `${filename} ` : '';

  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: `That file ${named}is empty. An export is a JSON file with a turn log in it.` };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // The parser's own message is kept: it names a line and a column, which is
    // the only thing that helps when a file has been edited by hand or truncated
    // by a download that stopped early.
    return {
      ok: false,
      error: `That file ${named}is not valid JSON, so there is nothing to read: ${error.message}`,
    };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      error:
        `That file ${named}is JSON, but a WordWright export is a JSON object with a ` +
        `"schema_version" of ${SCHEMA_VERSION} and a "turns" list. This one is ${
          Array.isArray(parsed) ? 'a list' : `a ${parsed === null ? 'null' : typeof parsed}`
        }.`,
    };
  }

  if (!('schema_version' in parsed)) {
    return {
      ok: false,
      error:
        `That file ${named}has no "schema_version". Every WordWright export carries ` +
        `one, and this reader expects ${SCHEMA_VERSION} — so this is either not an ` +
        'export, or something rewrote it on the way here.',
    };
  }

  if (parsed.schema_version !== SCHEMA_VERSION) {
    // Refused, never guessed at. A newer file may have fields this viewer would
    // silently drop, and dropping part of a record while displaying the rest is
    // the one thing a read-only view of a ledger must never do.
    return {
      ok: false,
      error:
        `That file ${named}says "schema_version": ${JSON.stringify(parsed.schema_version)}, ` +
        `and this reader understands ${SCHEMA_VERSION}. It is not read rather than ` +
        'read partly — a record shown with pieces missing is worse than one not shown.',
    };
  }

  if (!Array.isArray(parsed.turns)) {
    // Beyond what the brief asked for, and deliberate: `turns` IS the transcript
    // (§4), so a wrapper without it has passed the version check and still has
    // nothing to render. Caught here as a sentence rather than downstream as an
    // empty page.
    return {
      ok: false,
      error:
        `That file ${named}carries "schema_version": ${SCHEMA_VERSION} but no "turns" list, ` +
        'so there is no session in it to show.',
    };
  }

  return { ok: true, transcript: parsed };
}

/**
 * Index a table of records by id, for resolving a turn's `context_ref` and
 * `rules_ref` (§3) against the export's own `context` and `rules` tables (§4).
 *
 * A Map rather than an object: ids are opaque strings from a file this code did
 * not write, and `{}` lookups would answer `__proto__` and `constructor` with
 * something that is not a record.
 *
 * @param {unknown} table
 * @returns {Map<string, object>}
 */
export function indexById(table) {
  const index = new Map();
  if (!Array.isArray(table)) return index;
  for (const row of table) {
    if (isPlainObject(row) && typeof row.id === 'string') index.set(row.id, row);
  }
  return index;
}

export default readExport;
