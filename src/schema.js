/**
 * The stored schema version (CLAUDE.md §0.5: "`schema_version` field present from
 * turn zero").
 *
 * Its own module, and a one-line one, because two things need it and only one of
 * them may touch the filesystem. `src/storage.js` writes it into every document;
 * `client/src/transcript.js` writes it into every exported transcript (§4), and
 * that file is bundled for the browser, where importing `node:fs` is a build
 * error. Re-declaring the constant on the client would let the two drift, which is
 * the one thing a version number must not do.
 *
 * `storage.js` re-exports it, so `import { SCHEMA_VERSION } from './storage.js'`
 * keeps working and there is still exactly one declaration.
 */
export const SCHEMA_VERSION = 1;
