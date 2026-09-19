/**
 * The operator report (CLAUDE.md §12b), chunk 15's pre-commit fixes.
 *
 * Run as a subprocess against a temp documents root, and asserted on its STDOUT.
 * The script has no exports — it is a CLI that reads two files and prints — and the
 * two things worth testing here are exactly the two things a reader of that output
 * acts on: the recovery link, and what a spreadsheet does when it opens the CSV.
 *
 * Both defects this file pins were found by review of uncommitted work, not by a
 * failing test, which is why the tests exist now rather than then.
 *
 * The `human`/`ai` turn columns were added later (reports/mini-users-report-turns.md)
 * and brought a third source with them: the namespace directories themselves. The
 * tests for those build real documents on disk, because the whole point of the
 * columns is that they measure something no `.jsonl` row records.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { SEED_SLUG } from '../src/seed-document.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const roots = [];
test.after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A documents root holding the given claim rows and usage rows. */
function rootWith({ claims = [], usage = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'users-report-'));
  roots.push(dir);
  if (claims.length > 0) {
    writeFileSync(join(dir, 'claims.jsonl'), claims.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  if (usage.length > 0) {
    writeFileSync(join(dir, 'usage.jsonl'), usage.map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  return dir;
}

/**
 * Write a document into a namespace directory under `root`, with one turn per
 * entry in `authors`. Built by hand rather than through `commitHumanTurn` because
 * the point is a file on disk in a known shape; going through the turn machinery
 * would make this a test of that machinery instead.
 */
function writeDoc(root, token, slug, authors) {
  const dir = join(root, token);
  mkdirSync(dir, { recursive: true });

  const history = authors.map((author, index) => ({
    turn_id: index + 1,
    timestamp: `2026-09-08T1${index}:00:00.000Z`,
    author,
    snapshot: `draft after turn ${index + 1}`,
    ...(author === 'ai' ? { prompt: 'tighten it', note: 'done' } : {}),
  }));

  writeFileSync(
    join(dir, `${slug}.json`),
    JSON.stringify({
      schema_version: 1,
      slug,
      created_at: '2026-09-08T09:00:00.000Z',
      draft: history[history.length - 1].snapshot,
      history,
      rules: [],
    }),
  );
  return dir;
}

/** Run the report and return its stdout. */
function report(root, ...args) {
  return execFileSync(process.execPath, [join(REPO_ROOT, 'scripts/users-report.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOCUMENTS_ROOT: root, WORDWRIGHT_ORIGIN: 'https://wordwright.ink' },
  });
}

const TOKEN = '0123456789abcdef0123456789abcdef';

// ── the recovery link ─────────────────────────────────────────────────────────

test('the recovery link names the document a claimed namespace actually has', () => {
  // The registry keeps whole tokens for one reason: giving someone their link back
  // when they have lost it (§12b). A link to a document that does not exist answers
  // that request with "there is no document called draft yet", which is the worst
  // available answer — so the slug has to be the one `claimNamespace` creates.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: 'ada@example.com', token: TOKEN }],
  });

  const out = report(root);
  assert.match(out, new RegExp(`https://wordwright\\.ink/t/${TOKEN}/${SEED_SLUG}`));
  assert.doesNotMatch(out, /\/draft\b/, 'never the default slug — nothing creates a document there');

  // And the same link in the CSV, which is the copy an operator pastes.
  const csv = report(root, '--csv');
  assert.match(csv, new RegExp(`https://wordwright\\.ink/t/${TOKEN}/${SEED_SLUG}`));
  assert.doesNotMatch(csv, /\/draft"/);
});

// ── CSV formula injection ─────────────────────────────────────────────────────

test('a hostile name from the public form cannot become a spreadsheet formula', () => {
  // `name` and `email` come from a form anyone on the internet can post to, and this
  // CSV exists to be opened in Excel or Sheets. A leading =, +, - or @ makes the cell
  // a FORMULA there. Quoting does not help: the quotes are CSV syntax and are gone
  // before the cell is evaluated.
  const hostile = [
    '=HYPERLINK("http://evil","click me")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
    '   =cmd|\' /c calc\'!A1',
  ];

  const root = rootWith({
    claims: hostile.map((name, index) => ({
      at: '2026-09-08T09:00:00.000Z',
      name,
      email: `n${index}@example.com`,
      token: TOKEN,
    })),
  });

  const csv = report(root, '--csv');

  for (const name of hostile) {
    // The emitted field carries the leading apostrophe that makes a spreadsheet
    // treat the rest as text, and the payload is intact — neutralised, not mangled.
    assert.ok(
      csv.includes(`"'${name.replace(/"/g, '""')}"`),
      `neutralised, with the value preserved: ${name}`,
    );
  }

  // No field anywhere in the file opens with a formula trigger. Asserted over every
  // emitted field rather than only the ones this test wrote, so a future column
  // carrying claim data cannot slip through unarmed.
  for (const line of csv.trim().split('\n').slice(1)) {
    for (const cell of line.match(/"(?:[^"]|"")*"/g) ?? []) {
      assert.doesNotMatch(cell, /^"\s*[=+\-@]/, `unarmed field: ${cell}`);
    }
  }
});

test('a hostile email is armed too, and the header row is untouched', () => {
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: '=1+1', token: TOKEN }],
  });

  const csv = report(root, '--csv');
  assert.ok(csv.includes(`"'=1+1"`), 'the email field is armed as well as the name');
  // UPDATED when the turn columns were added: two names on the end. Pinned exactly
  // rather than loosely, because this header is the contract with whatever the
  // operator has pointed at the CSV — a silent column change is what breaks it.
  assert.match(
    csv.split('\n')[0],
    /^date,name,email,prefix,link,calls,usd,last_call,human,ai$/,
    'the header is plain, and the new columns are appended rather than inserted',
  );
});

test('ordinary values are not mangled: numbers stay numbers, dates stay dates', () => {
  // The other half of the fix. Arming is worthless if it turns the report into text
  // a spreadsheet cannot sum — so the numeric columns are emitted RAW, outside the
  // quoting, and dates begin with a digit and are therefore never armed.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada Lovelace', email: 'ada@example.com', token: TOKEN }],
    usage: [
      { at: '2026-09-08T10:00:00.000Z', namespace: '01234567', usd: 0.0125 },
      // A negative figure — a refund or a correction — must survive as a number.
      { at: '2026-09-08T11:00:00.000Z', namespace: '01234567', usd: -0.0025 },
    ],
  });

  const row = report(root, '--csv').trim().split('\n')[1];
  // UPDATED with the turn columns: two more fields on the end. This root has no
  // namespace directories at all, so they are the zero case, which is the state
  // every pre-existing test in this file runs in.
  const [date, name, email, prefix, link, calls, usd, last, human, ai] = row.split(',').map((c) => c);

  assert.equal(date, '"2026-09-08"', 'a date is quoted but not armed');
  assert.equal(name, '"Ada Lovelace"', 'an ordinary name is untouched');
  assert.equal(email, '"ada@example.com"', 'an @ INSIDE a value is not a trigger — only a leading one');
  assert.equal(prefix, '"01234567"');
  assert.match(link, /^"https:\/\//);

  // Raw, unquoted, summable.
  assert.equal(calls, '2');
  assert.equal(Number(usd).toFixed(4), '0.0100', 'the two figures netted, as a number');
  assert.doesNotMatch(usd, /'/, "and the total is not armed into text");
  assert.equal(last, '"2026-09-08T11:00:00.000Z"');

  // Raw and unquoted for the same reason `calls` is: a turn count is something an
  // operator sums down the column.
  assert.equal(human, '0', 'no namespace on disk is a zero, not a blank and not an error');
  assert.equal(ai, '0');
  assert.doesNotMatch(human, /"/, 'unquoted, so the column stays numeric');
  assert.doesNotMatch(ai, /"/);
});

// ── turn counts ───────────────────────────────────────────────────────────────

test('turns are tallied by author and aggregated across a namespace\'s documents', () => {
  // The reason these columns exist: a person can write all evening without calling
  // the model, and `usage.jsonl` records none of it. Here Ada has spent nothing at
  // all — no usage rows — and must still read as someone using the tool.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: 'ada@example.com', token: TOKEN }],
  });

  writeDoc(root, TOKEN, SEED_SLUG, ['human', 'ai', 'human', 'ai', 'human']); // 3 human, 2 ai
  writeDoc(root, TOKEN, 'second-piece', ['human', 'human', 'ai']); //            2 human, 1 ai

  const out = report(root);
  assert.match(out, /\s5\s+3\s*$/m, 'five human and three ai, summed over both documents');

  const row = report(root, '--csv').trim().split('\n')[1].split(',');
  assert.equal(row[5], '0', 'no API calls at all');
  assert.equal(row[8], '5', 'and yet five human turns — the case the columns were added for');
  assert.equal(row[9], '3');
});

test('a malformed document is skipped, counted, and never crashes the run', () => {
  // An operator report that dies on one bad file tells you nothing about the other
  // forty. The good document in the same namespace must still be counted.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: 'ada@example.com', token: TOKEN }],
  });

  const dir = writeDoc(root, TOKEN, SEED_SLUG, ['human', 'ai', 'human']);
  writeFileSync(join(dir, 'truncated.json'), '{"schema_version": 1, "slug": "trunc');
  // Parses as JSON but is not a document this build reads — the other failure shape.
  writeFileSync(join(dir, 'wrong-schema.json'), JSON.stringify({ schema_version: 99, history: [] }));

  const out = report(root);
  assert.match(out, /\s2\s+1\s*$/m, 'the readable document is still counted');
  assert.match(out, /2 documents could not be read/, 'and the skip is said out loud, not swallowed');

  const row = report(root, '--csv').trim().split('\n')[1].split(',');
  assert.equal(row[8], '2');
  assert.equal(row[9], '1');
});

test('a directory that is not a namespace is skipped, not enumerated by name', () => {
  // A persistent volume has a `lost+found`; a half-made directory or a stray file
  // can be anything. The predicate is `isValidToken`, the same one the server uses
  // to accept a token — so nothing needs a blocklist of known intruders.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: 'ada@example.com', token: TOKEN }],
  });

  writeDoc(root, TOKEN, SEED_SLUG, ['human', 'ai']);
  mkdirSync(join(root, 'lost+found'), { recursive: true });
  writeFileSync(join(root, 'lost+found', 'junk.json'), 'not json at all');
  writeDoc(root, 'not-a-token', 'whatever', ['human', 'human', 'human']);

  const out = report(root);
  assert.match(out, /\s1\s+1\s*$/m, "only the real namespace's turns are counted");
  assert.doesNotMatch(out, /lost\+found/, 'and nothing outside a namespace is mentioned');
  assert.doesNotMatch(out, /could not be read/, 'a non-namespace directory is not a read failure');
});

test('the hand-minted table carries the turn columns too', () => {
  // A namespace nobody can account for is the smoke detector (§12b). What has been
  // WRITTEN in it is exactly as interesting as what it spent, and arguably more so.
  const other = 'fedcba9876543210fedcba9876543210';
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Ada', email: 'ada@example.com', token: TOKEN }],
    usage: [{ at: '2026-09-08T10:00:00.000Z', namespace: other.slice(0, 8), usd: 0.01 }],
  });

  writeDoc(root, other, SEED_SLUG, ['human', 'ai', 'ai']);

  const out = report(root);
  const table = out.slice(out.indexOf('HAND-MINTED OR UNKNOWN'));
  assert.match(table, /prefix\s+calls\s+cost\s+last call\s+human\s+ai/, 'the heading gained both columns');
  assert.match(table, new RegExp(`${other.slice(0, 8)}.*\\s1\\s+2\\s*$`, 'm'), 'one human, two ai');

  // And in the CSV, where the unaccounted rows share the claimed rows' shape.
  const unaccountedRow = report(root, '--csv').trim().split('\n').at(-1).split(',');
  assert.equal(unaccountedRow[1], '"(hand-minted or unknown)"');
  assert.equal(unaccountedRow[8], '1');
  assert.equal(unaccountedRow[9], '2');
});

test('a claimed namespace with no documents on disk reads as zeros', () => {
  // Someone who signed up and never opened the link. Not an error, not a blank —
  // a zero, which is a fact about them.
  const root = rootWith({
    claims: [{ at: '2026-09-08T09:00:00.000Z', name: 'Grace', email: 'grace@example.com', token: TOKEN }],
  });

  const out = report(root);
  assert.match(out, /\s0\s+0\s*$/m);
  assert.doesNotMatch(out, /could not be read/);

  const row = report(root, '--csv').trim().split('\n')[1].split(',');
  assert.equal(row[8], '0');
  assert.equal(row[9], '0');
});

test('an empty registry still exits 0 and says so', () => {
  // Unchanged by these fixes, asserted because both of them touch this path.
  const out = report(rootWith());
  assert.match(out, /no registry yet/);
  assert.match(out, /not a problem/);
});
