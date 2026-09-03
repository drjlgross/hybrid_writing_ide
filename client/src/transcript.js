/**
 * Export transcript (CLAUDE.md §4, §12): the full ledger as JSON, from a button
 * in the top row. This is what replaced the raw-JSON link in the removed status
 * row.
 *
 * Built from `state.history`, which the client already holds — no new endpoint,
 * and nothing that can disagree with what the history view is showing, because
 * it is the same array. The stored document is still readable at its own GET;
 * this is a file that lands in Downloads, which the link was not.
 *
 * §4 pins the wrapper: `schema_version`, `slug`, `exported_at`, `turns`. It began
 * as chunk 10's F49 — §4 said "the full ledger as JSON" and gave no shape — and
 * was written into §4 in chunk 11 so it stops being an invention.
 *
 *   `schema_version`  §0.5 requires one on every stored document from turn zero.
 *                     An exported file outlives the app version that wrote it by
 *                     more, not less, than the stored one does, so it wants the
 *                     same protection. It is the SAME constant the store writes —
 *                     imported, never re-declared, so the two cannot drift.
 *   `slug`            `draft-transcript.json` in a folder of them is not
 *                     self-identifying once it is out of the app.
 *   `exported_at`     §11's K4 turns on reconstructing when something was looked at.
 *   `turns`           the ledger verbatim: full snapshots per §0.4, no diffs,
 *                     because diffs are computed from snapshots and never stored
 *                     (§5) and an exported diff would be a second representation
 *                     free to drift from the text it describes. Speech goes with
 *                     it — the note is on the turn (§0.7, §9 S13), so a transcript
 *                     carries the conversation without a second collection.
 */

import { SCHEMA_VERSION } from '../../src/schema.js';

/**
 * @param {string} slug
 * @param {object[]} history the ledger, in order
 * @param {Date} [now]
 */
export function buildTranscript(slug, history, now = new Date()) {
  return {
    schema_version: SCHEMA_VERSION,
    slug,
    exported_at: now.toISOString(),
    turns: history,
  };
}

/** `draft` → `draft-transcript.json` */
export function transcriptFilename(slug) {
  return `${slug}-transcript.json`;
}

/**
 * Hand `data` to the browser as a downloaded file.
 *
 * Everything it touches is injected so a headless test can watch what was saved
 * without a real browser: jsdom implements neither `URL.createObjectURL` nor a
 * download, and a test that stubbed the whole function would only prove the stub
 * works.
 *
 * The object URL is revoked immediately after the click. It is a handle to the
 * blob in memory, and a session that exports a dozen times would otherwise hold
 * a dozen copies of its own ledger alive until the tab closed.
 */
export function saveJson(filename, data, env = {}) {
  const doc = env.document ?? globalThis.document;
  const urls = env.URL ?? globalThis.URL;
  const BlobImpl = env.Blob ?? globalThis.Blob;

  const blob = new BlobImpl([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = urls.createObjectURL(blob);

  const anchor = doc.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  // Firefox ignores a click on an anchor that is not in the document.
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  urls.revokeObjectURL(href);
}

export default saveJson;
