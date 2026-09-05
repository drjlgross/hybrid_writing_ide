#!/usr/bin/env node
/**
 * Mint a capability token and print the link that goes with it (§0.5).
 *
 *     node scripts/new-token.js
 *     node scripts/new-token.js --base https://staging.example.app
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

/**
 * Where the deployed app lives.
 *
 * Printed BESIDE the local link rather than instead of it, because the two links
 * have different jobs and both are wanted at the moment a token is minted. The
 * local one is for trying the namespace out; the deployed one is the link that
 * actually gets handed to a person, and that person is on the internet, not on
 * this machine. Reconstructing it by hand — pasting a host in front of a token
 * copied out of a terminal — is exactly where a character gets dropped, and a
 * mistyped token does not fail loudly for the recipient. It 404s, or worse, it is
 * a valid-looking 32 hex characters naming an empty namespace nobody can find
 * again.
 *
 * A constant rather than a lookup: there is one deployment, and `--base` is here
 * for the day there is another.
 */
const DEPLOY_ORIGIN = 'https://hybridwritingide-production.up.railway.app';

const LOCAL_ORIGIN = 'http://localhost:3000';

const baseIndex = process.argv.indexOf('--base');
const override = baseIndex === -1 ? null : process.argv[baseIndex + 1].replace(/\/$/, '');

const token = generateToken();
const link = (origin) => `${origin}/t/${token}/${DEFAULT_SLUG}`;

console.log(`\ntoken: ${token}\n`);
if (override) {
  console.log(`link    : ${link(override)}\n`);
} else {
  console.log(`local   : ${link(LOCAL_ORIGIN)}`);
  console.log(`deployed: ${link(DEPLOY_ORIGIN)}\n`);
}
console.log('Anyone holding that link has full read and write access to every document');
console.log('in that namespace, and there is no way to revoke it short of moving the');
console.log('files. It is a filing system for people you know, not access control —');
console.log('say so when you hand it over.\n');
