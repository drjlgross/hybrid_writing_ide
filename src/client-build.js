/**
 * Is the built client older than the sources it was built from?
 *
 * The failure this exists to stop: `npm start` serves `client/dist`, so an edit to
 * `client/src` that was never rebuilt is served as the previous build. The page
 * loads, the app works, and the change is simply absent — which reads as "the code
 * did not do anything" rather than "the code was never compiled". That cost real
 * time in chunk 6.
 *
 * Three states, and only one of them is an error:
 *
 *   no-build  dist is absent. A fresh clone has never run a build; the server
 *             still starts and serves the API. NOT stale — there is nothing to be
 *             stale relative to, and refusing here would break the first run.
 *   fresh     every build input is older than the newest file in dist.
 *   stale     some build input is newer. Refuse to serve.
 *
 * Deliberately mtime-based rather than content-hash based: a rebuild always
 * rewrites dist, so mtime answers the question, and hashing would need a manifest
 * that is itself a thing to keep in sync.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * The inputs a client build depends on.
 *
 * `client/index.html` is here beyond the two the chunk brief named. It is a build
 * input in exactly the same way — Vite's entry document, and the file the favicon
 * link lives in — so editing it without rebuilding produces the identical silent
 * failure. Named in the chunk-07 report as an addition.
 */
export const BUILD_INPUTS = ['client/src', 'client/index.html', 'vite.config.js'];
export const BUILD_OUTPUT = 'client/dist';

/** Newest mtimeMs at or under `path`, or null if it does not exist. */
export function newestMtime(path) {
  if (!existsSync(path)) return null;

  const stats = statSync(path);
  if (!stats.isDirectory()) return { path, mtimeMs: stats.mtimeMs };

  let newest = null;
  for (const entry of readdirSync(path)) {
    // Editor swap files and .DS_Store are not build inputs; a Finder window
    // opening the folder must not make the build look stale.
    if (entry === '.DS_Store' || entry.startsWith('.')) continue;
    const found = newestMtime(join(path, entry));
    if (found && (!newest || found.mtimeMs > newest.mtimeMs)) newest = found;
  }
  return newest;
}

/**
 * @param {{root?: string}} [options]
 * @returns {{state: 'no-build'|'fresh'|'stale', newestInput: object|null,
 *   newestOutput: object|null, message: string|null}}
 */
export function checkClientBuild({ root = PROJECT_ROOT } = {}) {
  const newestOutput = newestMtime(join(root, BUILD_OUTPUT));

  if (!newestOutput) {
    return {
      state: 'no-build',
      newestInput: null,
      newestOutput: null,
      message: null,
    };
  }

  let newestInput = null;
  for (const input of BUILD_INPUTS) {
    const found = newestMtime(join(root, input));
    if (found && (!newestInput || found.mtimeMs > newestInput.mtimeMs)) newestInput = found;
  }

  if (!newestInput || newestInput.mtimeMs <= newestOutput.mtimeMs) {
    return { state: 'fresh', newestInput, newestOutput, message: null };
  }

  const relative = (p) => p.replace(root, '').replace(/^\/+/, '');
  const age = Math.round((newestInput.mtimeMs - newestOutput.mtimeMs) / 1000);

  return {
    state: 'stale',
    newestInput,
    newestOutput,
    message:
      `refusing to serve a stale client build.\n\n` +
      `  ${relative(newestInput.path)}\n` +
      `      was changed ${age >= 60 ? `${Math.round(age / 60)} minute(s)` : `${age} second(s)`} ` +
      `after the last build wrote\n` +
      `  ${relative(newestOutput.path)}\n\n` +
      `Serving anyway would hand the browser the PREVIOUS build, so your change would\n` +
      `simply not be there — which looks like a bug in the code rather than a missing\n` +
      `build step. Rebuild first:\n\n` +
      `      npx vite build\n\n` +
      `Or run \`npm run dev\`, which serves client/src directly and never goes stale.`,
  };
}

export default checkClientBuild;
