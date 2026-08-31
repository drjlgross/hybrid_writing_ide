#!/usr/bin/env node
/**
 * The server entry point.
 *
 *     npm start                       # serves the API, and client/dist if it is built
 *     npm run dev                     # this plus Vite, which proxies /api here
 *
 * The API key is read here and nowhere else on this path (§0.6). Missing it fails
 * at startup rather than at the first prompt, so the failure lands on the operator
 * instead of on someone mid-sentence.
 *
 * The staleness gate below is the same idea applied to the build: a stale
 * client/dist fails at startup rather than in the browser, where "my change is not
 * there" is indistinguishable from "my change does not work".
 */

import { checkClientBuild } from '../src/client-build.js';
import { startServer } from '../src/server.js';

const build = checkClientBuild();

if (build.state === 'stale') {
  console.error(`\n${build.message}\n`);
  process.exit(1);
}

if (build.state === 'no-build') {
  // A fresh clone. The API is fully usable; only the browser UI is missing, and
  // saying so beats a blank page at /.
  console.log(
    'no client build found at client/dist — serving the API only.\n' +
      'Run `npx vite build` for the app, or `npm run dev` to serve client/src directly.',
  );
}

try {
  startServer();
} catch (error) {
  console.error(`\nthe server did not start: ${error.message}\n`);
  process.exit(1);
}
