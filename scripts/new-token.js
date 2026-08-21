#!/usr/bin/env node
/**
 * Mint a capability token and print the link that goes with it (§0.5).
 *
 *     node scripts/new-token.js
 *     node scripts/new-token.js --base https://example.railway.app
 *
 * §0.5 says tokens are crypto-random and generated with `node:crypto`; without a
 * way to make one, the only reachable namespace is the fixed development token,
 * which is guessable by design. This is that way.
 *
 * It creates no directory and no document. A namespace comes into being the first
 * time something is written into it, so a token that is never used costs nothing.
 */

import { DEFAULT_SLUG } from '../src/addressing.js';
import { generateToken } from '../src/namespace.js';

const baseIndex = process.argv.indexOf('--base');
const base = baseIndex === -1 ? 'http://localhost:3000' : process.argv[baseIndex + 1].replace(/\/$/, '');

const token = generateToken();

console.log(`\ntoken: ${token}`);
console.log(`link : ${base}/t/${token}/${DEFAULT_SLUG}\n`);
console.log('Anyone holding that link has full read and write access to every document');
console.log('in that namespace, and there is no way to revoke it short of moving the');
console.log('files. It is a filing system for people you know, not access control —');
console.log('say so when you hand it over.\n');
