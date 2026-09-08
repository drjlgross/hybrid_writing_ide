#!/usr/bin/env node
/**
 * Who signed up, and what they have cost (CLAUDE.md §12b).
 *
 *     npm run users-report
 *     npm run users-report -- --csv
 *     DOCUMENTS_ROOT=/data npm run users-report
 *
 * Joins two append-only files on the documents volume:
 *
 *   claims.jsonl   who claimed a namespace, and when — the operator's user table
 *   usage.jsonl    what each namespace has spent, by TOKEN PREFIX
 *
 * The join key is the prefix: `claims.jsonl` holds the whole token and the usage
 * ledger deliberately holds only its first eight characters (see the headers of
 * both `src/claims.js` and `src/usage-ledger.js`). This script is the only place
 * the two meet, and it is the only reader of the registry.
 *
 * IT PRINTS THE PREFIX, NOT THE TOKEN, in the human table — a terminal is
 * screen-shared, scrolled past, and pasted into chat far more often than a file is
 * opened. The full link is printed too, because recovering someone's lost link is
 * the reason the registry keeps whole tokens at all; that is the row's last
 * column, where it is deliberate to reach for. `--csv` carries the full link as
 * well: a CSV exists to be worked with, and a user table with no way back to the
 * user is not one.
 *
 * THIS REFUSES NOTHING AND CANNOT. Like `scripts/spend-report.js`, it is
 * attribution and smoke detection; the enforcement layer is the Console workspace
 * limit. Nothing in `src/` imports it.
 *
 * An empty or missing registry is the normal state before the first sign-up, not
 * an error. It exits 0 and says so, in the same manner as the spend report.
 */

import { documentAddress } from '../src/addressing.js';
import { claimsRegistryPath, joinClaimsAndUsage, readClaims } from '../src/claims.js';
import { DOCUMENTS_ROOT } from '../src/namespace.js';
import { SEED_SLUG } from '../src/seed-document.js';
import { readUsage, usageLedgerPath } from '../src/usage-ledger.js';

const root = DOCUMENTS_ROOT;
const csv = process.argv.includes('--csv');

/** The deployment a link belongs to. Overridable for a staging host. */
const SITE = process.env.WORDWRIGHT_ORIGIN || 'https://wordwright.ink';

const usd = (n) => `$${n.toFixed(4)}`;

/**
 * One CSV field: quoted, with any quote inside it doubled, and **neutralised against
 * spreadsheet formula injection**.
 *
 * `name` and `email` arrive from a public form that anyone on the internet can post
 * to, and this file's whole purpose is to be opened in Excel or Sheets. A value
 * beginning `=`, `+`, `-` or `@` is a FORMULA to those programs, not text — so a
 * name of `=HYPERLINK("http://evil","click")` becomes a live link in the operator's
 * spreadsheet, and worse things are available. Quoting alone does not stop it: the
 * quotes are CSV syntax and are stripped before the cell is evaluated.
 *
 * The fix is a leading apostrophe, which every spreadsheet reads as "treat the rest
 * as text" and does not display. Applied after trimming leading whitespace, because
 * ` =CMD()` is evaluated exactly as `=CMD()` is.
 *
 * Numbers are NOT passed through here — `calls` and `usd` are emitted raw, so a
 * negative figure stays a number and is not turned into text by this. Dates are, and
 * are unaffected: an ISO timestamp begins with a digit.
 */
const field = (value) => {
  const text = String(value ?? '');
  const armed = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${armed.replace(/"/g, '""')}"`;
};

// ── read both files ───────────────────────────────────────────────────────────

const claims = readClaims({ root });
const usage = readUsage({ root });

// The join itself lives in src/claims.js so it can be asserted without capturing
// stdout — the same split `summarizeUsage` has from the spend report. This file
// formats; it does not decide anything.
const { rows: joined, unaccounted } = joinClaimsAndUsage({
  claims: claims.rows,
  usage: usage.rows,
});

// SEED_SLUG, not §0.5's DEFAULT_SLUG. A claimed namespace's document is created at
// `welcome-doc` (§12b), and nothing creates one at `draft` — so a link built with the
// default slug lands on "there is no document called draft yet", which is the worst
// possible answer to give someone who has lost their link and asked for help.
// Composed with `documentAddress` rather than by hand, so the shape stays §0.5's.
const rows = joined.map((row) => ({ ...row, link: `${SITE}${documentAddress(row.token, SEED_SLUG)}` }));

// ── CSV ───────────────────────────────────────────────────────────────────────

if (csv) {
  console.log(['date', 'name', 'email', 'prefix', 'link', 'calls', 'usd', 'last_call'].join(','));
  for (const row of rows) {
    console.log(
      [
        field(row.date),
        field(row.name),
        field(row.email),
        field(row.prefix),
        field(row.link),
        row.calls,
        row.usd.toFixed(6),
        field(row.last ?? ''),
      ].join(','),
    );
  }
  // Unaccounted namespaces go into the same CSV rather than a second one, with
  // the columns they have. A spreadsheet with two shapes in it is still one file
  // to open; a row silently missing is a namespace nobody looks at.
  for (const row of unaccounted) {
    console.log(
      [
        field(row.last?.slice(0, 10) ?? ''),
        field('(hand-minted or unknown)'),
        field(''),
        field(row.prefix),
        field(''),
        row.calls,
        row.usd.toFixed(6),
        field(row.last ?? ''),
      ].join(','),
    );
  }
  process.exit(0);
}

// ── the human view ────────────────────────────────────────────────────────────

console.log('');
console.log(`claims registry: ${claimsRegistryPath({ root })}`);
console.log(`usage ledger:    ${usageLedgerPath({ root })}`);

if (!claims.exists) {
  console.log('');
  console.log('  no registry yet — nobody has signed up through the landing page.');
  console.log('  That is the normal state before the first claim, not a problem.');
  console.log('');
  process.exit(0);
}

if (rows.length === 0) {
  console.log('');
  console.log('  the registry exists but holds no rows yet.');
  console.log('');
  process.exit(0);
}

console.log('');
console.log(`${rows.length} sign-up${rows.length === 1 ? '' : 's'}`);
console.log('');
console.log('  date        name                  email                           prefix      calls       cost   last call');

for (const row of rows) {
  console.log(
    `  ${row.date.padEnd(10)}  ${row.name.slice(0, 20).padEnd(20)}  ` +
      `${row.email.slice(0, 30).padEnd(30)}  ${row.prefix.padEnd(8)}  ` +
      `${String(row.calls).padStart(5)}  ${usd(row.usd).padStart(9)}   ${row.last?.slice(0, 16) ?? '—'}`,
  );
  console.log(`    ${row.link}`);
}

if (unaccounted.length > 0) {
  console.log('');
  console.log('HAND-MINTED OR UNKNOWN — namespaces in the usage ledger that no claim accounts for');
  console.log('');
  console.log('  prefix      calls       cost   last call');
  for (const row of unaccounted) {
    console.log(
      `  ${row.prefix.padEnd(8)}  ${String(row.calls).padStart(5)}  ${usd(row.usd).padStart(9)}   ` +
        `${row.last?.slice(0, 16) ?? '—'}`,
    );
  }
}

if (claims.skipped > 0) {
  console.log('');
  console.log(`  ${claims.skipped} unreadable row${claims.skipped === 1 ? '' : 's'} in the registry were skipped.`);
}
if (usage.skipped > 0) {
  console.log(`  ${usage.skipped} unreadable row${usage.skipped === 1 ? '' : 's'} in the usage ledger were skipped.`);
}

console.log('');
