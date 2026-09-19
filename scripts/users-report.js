#!/usr/bin/env node
/**
 * Who signed up, and what they have cost (CLAUDE.md §12b).
 *
 *     npm run users-report
 *     npm run users-report -- --csv
 *     DOCUMENTS_ROOT=/data npm run users-report
 *
 * Joins two append-only files on the documents volume, plus the documents:
 *
 *   claims.jsonl   who claimed a namespace, and when — the operator's user table
 *   usage.jsonl    what each namespace has spent, by TOKEN PREFIX
 *   the namespaces what has been WRITTEN in them, tallied by turn author
 *
 * The third source is there because the first two measure model spend and nothing
 * else. A person can write all evening, checkpoint a dozen times and never call
 * the model — §3's human turns cost nothing and leave no row in `usage.jsonl` — so
 * a report built on calls alone shows that person as a zero and reads them as
 * someone who signed up and left. The `human` and `ai` columns are the count of
 * turns in their documents, which is the cheapest measure of engagement that is
 * already on disk.
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

import { readdirSync } from 'node:fs';

import { documentAddress } from '../src/addressing.js';
import { claimsRegistryPath, joinClaimsAndUsage, readClaims } from '../src/claims.js';
import { DOCUMENTS_ROOT, isValidToken, resolveNamespace } from '../src/namespace.js';
import { SEED_SLUG } from '../src/seed-document.js';
import { listDocuments, loadDocument } from '../src/storage.js';
import { AI, HUMAN } from '../src/turns.js';
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

// ── what has been written, per namespace ──────────────────────────────────────

/**
 * Turn counts by author, for every namespace on disk, keyed by TOKEN PREFIX.
 *
 * Keyed by prefix because that is what both tables already have: the usage ledger
 * holds only a prefix by design (src/usage-ledger.js), so the unaccounted table has
 * nothing longer to look up with, and `joinClaimsAndUsage` keys on it too. Two
 * tokens sharing a prefix would aggregate into one row here, exactly as they
 * already would in the existing join — the same known limitation, not a new one.
 *
 * NEVER THROWS, AND NEVER PARTIALLY FAILS. An operator report that dies on one bad
 * file tells you nothing about the other forty. Every layer is tolerant:
 *
 *   - a documents root that does not exist yet → an empty tally
 *   - anything under it that is not a namespace → skipped, by the SAME predicate
 *     the server uses to accept a token (`isValidToken`), so a volume's
 *     `lost+found`, a stray file, `claims.jsonl` itself and a half-made directory
 *     all fall out without being enumerated by name
 *   - a document that will not read → counted as unreadable and skipped
 *
 * Paths come from `resolveNamespace` and listings from `listDocuments`, rather than
 * being built here: §0.5 says one function turns an identity into a place on disk,
 * and a report is not a reason to make a second one.
 *
 * @param {{root: string}} options
 * @returns {Map<string, {human: number, ai: number, unreadable: number}>}
 */
function tallyTurns({ root: documentsRoot }) {
  const byPrefix = new Map();

  let entries;
  try {
    entries = readdirSync(documentsRoot, { withFileTypes: true });
  } catch {
    return byPrefix; // no documents root yet — the state before the first claim
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidToken(entry.name)) continue;

    const { dir, label } = resolveNamespace(entry.name, { root: documentsRoot });
    const tally = byPrefix.get(label) ?? { human: 0, ai: 0, unreadable: 0 };

    for (const listed of listDocuments({ dir })) {
      try {
        // `loadDocument` is the reader everything else uses, so this report agrees
        // with the app about what a readable document is. It verifies
        // schema_version and the §0.3 invariant, which means a document that is
        // corrupt or out of invariant counts as unreadable rather than
        // half-tallied — the conservative direction for a number someone reads as
        // engagement.
        const doc = loadDocument(listed.slug, { dir });
        for (const turn of doc.history ?? []) {
          if (turn?.author === HUMAN) tally.human += 1;
          else if (turn?.author === AI) tally.ai += 1;
          // §3 allows `mixed` too, once staging lands (step 16). It is deliberately
          // in neither column rather than folded into one of them.
        }
      } catch {
        tally.unreadable += 1;
      }
    }

    byPrefix.set(label, tally);
  }

  return byPrefix;
}

const NO_TURNS = { human: 0, ai: 0, unreadable: 0 };

// ── read both files ───────────────────────────────────────────────────────────

const claims = readClaims({ root });
const usage = readUsage({ root });
const turns = tallyTurns({ root });

/** A namespace with nothing on disk is zeros, not an absence and not an error. */
const written = (prefix) => turns.get(prefix) ?? NO_TURNS;

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
  // `human` and `ai` are APPENDED rather than slotted in beside `calls`, so every
  // column an existing consumer already reads keeps its position.
  console.log(
    ['date', 'name', 'email', 'prefix', 'link', 'calls', 'usd', 'last_call', 'human', 'ai'].join(','),
  );
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
        // Raw and unquoted, like `calls` and `usd`: a count is a number a
        // spreadsheet should sum, and `field()` would make it text. They are also
        // machine-generated integers, so there is nothing here to arm — the values
        // never touch the public form.
        written(row.prefix).human,
        written(row.prefix).ai,
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
        written(row.prefix).human,
        written(row.prefix).ai,
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
console.log(
  '  date        name                  email                           prefix      calls       cost   '
    + 'last call          human      ai',
);

for (const row of rows) {
  console.log(
    `  ${row.date.padEnd(10)}  ${row.name.slice(0, 20).padEnd(20)}  ` +
      `${row.email.slice(0, 30).padEnd(30)}  ${row.prefix.padEnd(8)}  ` +
      `${String(row.calls).padStart(5)}  ${usd(row.usd).padStart(9)}   ${(row.last?.slice(0, 16) ?? '—').padEnd(16)}  ${String(written(row.prefix).human).padStart(6)}  ${String(written(row.prefix).ai).padStart(6)}`,
  );
  console.log(`    ${row.link}`);
}

if (unaccounted.length > 0) {
  console.log('');
  console.log('HAND-MINTED OR UNKNOWN — namespaces in the usage ledger that no claim accounts for');
  console.log('');
  console.log('  prefix      calls       cost   last call          human      ai');
  for (const row of unaccounted) {
    console.log(
      `  ${row.prefix.padEnd(8)}  ${String(row.calls).padStart(5)}  ${usd(row.usd).padStart(9)}   ` +
        `${(row.last?.slice(0, 16) ?? '—').padEnd(16)}  ${String(written(row.prefix).human).padStart(6)}  ${String(written(row.prefix).ai).padStart(6)}`,
    );
  }
}

// What was on disk and could not be read. The third line is said out loud for the
// same reason the first two are: a turn count quietly missing a document reads as a
// quiet person, which is the one wrong conclusion these columns exist to prevent.
//
// Collected rather than printed in place so the blank line above them appears
// whichever of the three fires. Previously it was attached to the registry notice,
// so a usage-only notice butted against the table.
const unreadableDocs = [...turns.values()].reduce((sum, t) => sum + t.unreadable, 0);
const plural = (n, one, many) => (n === 1 ? one : many);

const notices = [];
if (claims.skipped > 0) {
  notices.push(`  ${claims.skipped} unreadable ${plural(claims.skipped, 'row', 'rows')} in the registry were skipped.`);
}
if (usage.skipped > 0) {
  notices.push(`  ${usage.skipped} unreadable ${plural(usage.skipped, 'row', 'rows')} in the usage ledger were skipped.`);
}
if (unreadableDocs > 0) {
  notices.push(
    `  ${unreadableDocs} ${plural(unreadableDocs, 'document', 'documents')} could not be read and ` +
      `${plural(unreadableDocs, 'is', 'are')} not counted in the turn columns.`,
  );
}
if (notices.length > 0) {
  console.log('');
  for (const notice of notices) console.log(notice);
}

console.log('');
