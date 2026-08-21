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
 */

import { startServer } from '../src/server.js';

try {
  startServer();
} catch (error) {
  console.error(`\nthe server did not start: ${error.message}\n`);
  process.exit(1);
}
