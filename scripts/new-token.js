#!/usr/bin/env node
/**
 * Mint a capability token and print the links that go with it (§0.5).
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
 * ── THE HOSTNAME LIST ────────────────────────────────────────────────────────
 *
 * Every host a freshly minted token gets printed for. One constant, one place to
 * edit when a hostname changes, and the label travels with the origin it names so
 * the two cannot drift apart.
 *
 * ORDER IS OUTPUT ORDER, and it is load-bearing: the sending link is last, where
 * a terminal leaves it closest to the cursor and hardest to confuse with the
 * local one. `send: true` marks it in the output. That property lives on the data
 * rather than in the printing code so the mark cannot end up on the wrong line.
 *
 * Both links are printed because the two have different jobs and both are wanted
 * at the moment a token is minted. The local one is for trying the namespace out;
 * the ink one is the link that actually gets handed to a person, and that person
 * is on the internet, not on this machine. Reconstructing it by hand — pasting a
 * host in front of a token copied out of a terminal — is exactly where a
 * character gets dropped, and a mistyped token does not fail loudly for the
 * recipient. It 404s, or worse, it is a valid-looking 32 hex characters naming an
 * empty namespace nobody can find again.
 */
const HOSTS = [
  { label: 'local', origin: 'http://localhost:3000' },
  { label: 'ink', origin: 'https://wordwright.ink', send: true },
];

const baseIndex = process.argv.indexOf('--base');
const override = baseIndex === -1 ? null : process.argv[baseIndex + 1].replace(/\/$/, '');

const token = generateToken();
const link = (origin) => `${origin}/t/${token}/${DEFAULT_SLUG}`;

// An explicit --base replaces the whole list: it is for a host that is neither of
// them, and printing the defaults beside it would be three links where one was
// asked for.
const rows = override ? [{ label: 'link', origin: override }] : HOSTS;

// Padded from the list rather than to a hardcoded width, so adding a longer label
// above realigns the block instead of ragging it.
const width = Math.max(...rows.map((row) => row.label.length));

// The token on a line of its own, first, and in the shape it has always had —
// anything parsing this output is looking for exactly `token: <32 hex>`.
console.log(`\ntoken: ${token}\n`);

for (const row of rows) {
  const label = `${row.label}:`.padEnd(width + 2);
  console.log(`${label}${link(row.origin)}${row.send ? '   ← send this one' : ''}`);
}

console.log('');
console.log('Anyone holding that link has full read and write access to every document');
console.log('in that namespace, and there is no way to revoke it short of moving the');
console.log('files. It is a filing system for people you know, not access control —');
console.log('say so when you hand it over.\n');
