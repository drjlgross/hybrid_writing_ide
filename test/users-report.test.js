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
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  assert.match(csv.split('\n')[0], /^date,name,email,prefix,link,calls,usd,last_call$/, 'the header is plain');
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
  const [date, name, email, prefix, link, calls, usd, last] = row.split(',').map((c) => c);

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
});

test('an empty registry still exits 0 and says so', () => {
  // Unchanged by these fixes, asserted because both of them touch this path.
  const out = report(rootWith());
  assert.match(out, /no registry yet/);
  assert.match(out, /not a problem/);
});
