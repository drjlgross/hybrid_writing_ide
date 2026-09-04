/**
 * The app version (CLAUDE.md § Operating rules → Versioning).
 *
 * ONE SOURCE OF TRUTH: `package.json`. The rule says the version bumps as part of
 * a ratified commit, so it lives in the file a commit already touches, and every
 * place that reports a version reads it from here rather than carrying a copy that
 * can drift a patch behind.
 *
 * Read at import time, from disk, deliberately. A constant written into this file
 * would be a second place to bump and therefore a second place to forget.
 *
 * NOT the same number as `schema_version` in stored documents and exports (§0.5,
 * §4). That one moves when the data shape changes; this one moves on every
 * ratified commit. Neither implies the other, and a patch bump must never be read
 * as a data migration.
 */

import { readFileSync } from 'node:fs';

/**
 * @returns {string} the version in package.json, or '0.0.0-unknown' if it cannot
 *   be read. Never throws: a version string is diagnostic, and failing to start
 *   the server because one could not be read would be a worse outcome than
 *   serving without it.
 */
function readVersion() {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const version = JSON.parse(raw)?.version;
    return typeof version === 'string' && version !== '' ? version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

/** The running app's version. */
export const APP_VERSION = readVersion();

export default APP_VERSION;
