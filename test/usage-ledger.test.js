/**
 * The per-namespace usage ledger: MEASURE, NEVER ENFORCE.
 *
 * The tests that matter here are the negative ones. It is easy to write a ledger
 * that counts correctly and then quietly grows the ability to refuse, or that
 * writes a whole capability token into a log line, or that turns a paid-for turn
 * into a failed one because a disk was full. Each of those has an assertion.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RATES, RATES_AS_OF, costOf, isKnownModel, rateFor } from '../src/usage-rates.js';
import { readUsage, recordUsage, summarizeUsage, usageLedgerPath } from '../src/usage-ledger.js';

const roots = [];
function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'usage-ledger-'));
  roots.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

const usage = (input, output) => ({ input_tokens: input, output_tokens: output });

// ── rates ─────────────────────────────────────────────────────────────────────

test('rates are a dated snapshot and an unknown model bills at the worst known rate', () => {
  assert.match(RATES_AS_OF, /^\d{4}-\d{2}-\d{2}$/, 'the table says when it was checked');

  const known = costOf(usage(1_000_000, 1_000_000), 'claude-sonnet-5');
  assert.equal(known, RATES['claude-sonnet-5'].input + RATES['claude-sonnet-5'].output);

  // The spend-guard convention, carried over deliberately: a model the table has
  // never heard of is priced at the most expensive rate in it, so a stale table
  // over-reports and never under-reports.
  const worst = Object.values(RATES).reduce((max, rate) => Math.max(max, rate.output), 0);
  assert.equal(rateFor('claude-something-unreleased').output, worst);
  assert.ok(
    costOf(usage(0, 1_000_000), 'claude-something-unreleased') >=
      costOf(usage(0, 1_000_000), 'claude-sonnet-5'),
    'never cheaper than a model we do know',
  );
  assert.equal(isKnownModel('claude-sonnet-5'), true);
  assert.equal(isKnownModel('claude-something-unreleased'), false);
});

test('cache tokens are priced, not ignored', () => {
  const withCache = costOf(
    { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 1_000_000 },
    'claude-sonnet-5',
  );
  const withoutCache = costOf(usage(100, 100), 'claude-sonnet-5');
  assert.ok(withCache > withoutCache, 'a cache read costs something and is counted');
});

// ── writing ───────────────────────────────────────────────────────────────────

test('one call, one JSONL row, carrying the prefix and never the token', () => {
  const root = freshRoot();
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

  const result = recordUsage({
    label: token.slice(0, 8),
    model: 'claude-sonnet-5',
    usage: usage(1000, 500),
    root,
  });
  assert.equal(result.written, true);

  const raw = readFileSync(usageLedgerPath({ root }), 'utf8');
  assert.equal(raw.trimEnd().split('\n').length, 1, 'exactly one row');

  const row = JSON.parse(raw);
  assert.equal(row.namespace, 'a1b2c3d4');
  assert.equal(row.model, 'claude-sonnet-5');
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 500);
  assert.equal(row.rate_known, true);
  assert.ok(row.usd > 0);
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T/);

  // THE ONE THAT MATTERS. A capability token is the whole identity; a ledger
  // that logs one has written a credential to disk.
  assert.doesNotMatch(raw, new RegExp(token), 'the whole token is never in the file');
});

test('rows append; nothing is rewritten', () => {
  const root = freshRoot();
  for (let i = 0; i < 5; i += 1) {
    recordUsage({ label: `ns${i}`, model: 'claude-sonnet-5', usage: usage(10, 10), root });
  }
  const { rows } = readUsage({ root });
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => row.namespace),
    ['ns0', 'ns1', 'ns2', 'ns3', 'ns4'],
    'oldest first, in the order they happened',
  );
});

test('a missing label or model is recorded as unknown, not as a crash', () => {
  const root = freshRoot();
  assert.equal(recordUsage({ root }).written, true);
  const [row] = readUsage({ root }).rows;
  assert.equal(row.namespace, 'unknown');
  assert.equal(row.model, 'unknown');
  assert.equal(row.input_tokens, 0);
  assert.equal(row.rate_known, false, 'and an unknown model is flagged as unpriced');
});

test('a ledger write that FAILS does not throw — a paid-for turn must not fail on bookkeeping', () => {
  const root = freshRoot();
  // A path that cannot be written: the ledger's own location is a directory.
  const blocked = join(root, 'blocked');
  writeFileSync(join(root, 'placeholder'), '');
  const result = recordUsage({ label: 'ns', model: 'claude-sonnet-5', usage: usage(1, 1), root: join(blocked, 'x\0y') });

  assert.equal(result.written, false, 'it reports the failure');
  assert.ok(typeof result.error === 'string' && result.error !== '', 'and says what happened');
  // The point: it returned. It did not throw, and the turn above it survives.
});

// ── reading ───────────────────────────────────────────────────────────────────

test('a missing ledger is an empty ledger, not an error — that is a fresh deploy', () => {
  const root = freshRoot();
  const result = readUsage({ root });
  assert.deepEqual(result.rows, []);
  assert.equal(result.exists, false);
  assert.equal(result.skipped, 0);

  // And the summary of nothing is a valid, zeroed summary rather than a throw.
  const summary = summarizeUsage(result.rows);
  assert.equal(summary.total.calls, 0);
  assert.equal(summary.total.usd, 0);
  assert.deepEqual(summary.namespaces, []);
  assert.equal(summary.trend.length, 7, 'seven days of zeroes, not an empty series');
});

test('a truncated last line is skipped, not fatal', () => {
  const root = freshRoot();
  recordUsage({ label: 'good1', model: 'claude-sonnet-5', usage: usage(10, 10), root });
  recordUsage({ label: 'good2', model: 'claude-sonnet-5', usage: usage(10, 10), root });

  // What a crash mid-append leaves behind.
  const path = usageLedgerPath({ root });
  writeFileSync(path, `${readFileSync(path, 'utf8')}{"at":"2026-09-04T00:00:00.000Z","name`);

  const { rows, skipped } = readUsage({ root });
  assert.equal(rows.length, 2, 'the good rows above it survive');
  assert.equal(skipped, 1, 'and the bad one is counted rather than hidden');
});

// ── summarizing ───────────────────────────────────────────────────────────────

test('the summary totals, ranks by cost, and fills quiet days with zeroes', () => {
  const now = new Date('2026-09-04T12:00:00.000Z');
  const rows = [
    { at: '2026-09-04T09:00:00.000Z', namespace: 'aaaaaaaa', model: 'claude-sonnet-5', input_tokens: 100, output_tokens: 10, usd: 0.5, rate_known: true },
    { at: '2026-09-04T10:00:00.000Z', namespace: 'bbbbbbbb', model: 'claude-sonnet-5', input_tokens: 200, output_tokens: 20, usd: 2.0, rate_known: true },
    { at: '2026-09-02T10:00:00.000Z', namespace: 'aaaaaaaa', model: 'claude-sonnet-5', input_tokens: 300, output_tokens: 30, usd: 1.0, rate_known: true },
    { at: '2026-09-02T11:00:00.000Z', namespace: 'zzzzzzzz', model: 'made-up', input_tokens: 1, output_tokens: 1, usd: 0.01, rate_known: false },
  ];

  const summary = summarizeUsage(rows, { days: 7, now });

  assert.equal(summary.total.calls, 4);
  assert.equal(summary.total.usd.toFixed(2), '3.51');
  assert.equal(summary.total.input_tokens, 601);
  assert.equal(summary.unpriced, 1, 'rows billed at the fallback rate are named');

  // Ranked by cost, not by call count: aaaaaaaa made two calls costing 1.5,
  // bbbbbbbb made one costing 2.0, and the money is what the report is about.
  assert.deepEqual(
    summary.namespaces.map((entry) => entry.namespace),
    ['bbbbbbbb', 'aaaaaaaa', 'zzzzzzzz'],
  );
  assert.equal(summary.namespaces[1].calls, 2);
  assert.equal(summary.namespaces[1].last, '2026-09-04T09:00:00.000Z', 'most recent call');

  // A contiguous window ending today. 2026-09-03 saw nothing and must appear as
  // a zero — a series that silently omits quiet days reads as busier than it was.
  assert.equal(summary.trend.length, 7);
  assert.deepEqual(
    summary.trend.map((day) => day.day),
    ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'],
  );
  const quiet = summary.trend.find((day) => day.day === '2026-09-03');
  assert.deepEqual(quiet, { day: '2026-09-03', calls: 0, usd: 0 });
  assert.equal(summary.trend.at(-1).usd, 2.5, 'today');
});

// ── the boundary that must not move ───────────────────────────────────────────

test('NOTHING in src/ can refuse a call on a cost ground', async () => {
  // The Console workspace limit is the enforcement layer (CLAUDE.md § Measurement
  // infra). A cap in application code would mean the app stops working for
  // everyone because a file on a disk said so — which is exactly why the DEV
  // guard is kept out of src/ as well. This asserts the ledger never grew one.
  const ledger = readFileSync(new URL('../src/usage-ledger.js', import.meta.url), 'utf8');
  const rates = readFileSync(new URL('../src/usage-rates.js', import.meta.url), 'utf8');

  for (const [name, source] of [['usage-ledger.js', ledger], ['usage-rates.js', rates]]) {
    // An IMPORT, not the word. `usage-rates.js` names the guard in prose on
    // purpose — it explains why it duplicates the table — and a check that
    // forbade saying so would delete the explanation rather than the coupling.
    assert.doesNotMatch(source, /from\s+'[^']*spend-guard/, `src/${name} must not import the dev budget`);
    // No ceiling, no refusal, no throwing on a threshold.
    assert.doesNotMatch(source, /BUDGET_USD|assertWithinBudget|BudgetExceeded/, `src/${name} enforces nothing`);
  }

  // And the module exports no way to ask "may I spend?" — the shape of the API
  // is the guarantee, not the absence of a call site today.
  assert.deepEqual(
    Object.keys(await import('../src/usage-ledger.js')).sort(),
    ['USAGE_LEDGER', 'readUsage', 'recordUsage', 'summarizeUsage', 'usageLedgerPath'],
  );
});

test('the DEV guard and the DEPLOY ledger stay separate in both directions', () => {
  const guard = readFileSync(new URL('../scripts/spend-guard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guard, /usage-ledger|usage-rates/, 'the guard does not read the app ledger');

  // The duplication of the rate table is deliberate and must stay deliberate:
  // if these ever diverge in CONVENTION — not in numbers — the two reports stop
  // meaning the same thing.
  const rates = readFileSync(new URL('../src/usage-rates.js', import.meta.url), 'utf8');
  assert.match(rates, /spend-guard/, 'and says in prose why it duplicates it');
});

// ── the wiring: a real turn through the server writes a real row ──────────────

test('an /ai-edit turn appends one row, attributed to the right namespace', async () => {
  const { createServer } = await import('../src/server.js');
  const { generateToken } = await import('../src/namespace.js');
  const { DEFAULT_SLUG } = await import('../src/addressing.js');

  const root = freshRoot();
  const app = createServer({
    root,
    host: '127.0.0.1',
    // A stub standing in for the API, returning the `usage` block a real
    // response carries. The ledger reads fields off the response body, so this
    // exercises the same path a live call would.
    callModel: async () => ({
      model: 'claude-sonnet-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1234, output_tokens: 56 },
      content: [{ type: 'text', text: JSON.stringify({ note: 'ok', segments: [], draft: null }) }],
    }),
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const token = generateToken();
    await fetch(`${base}/api/t/${token}/documents`);

    assert.equal(readUsage({ root }).rows.length, 0, 'nothing recorded before the turn');

    const response = await fetch(`${base}/api/t/${token}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: DEFAULT_SLUG, prompt: 'what is this about?', pendingDraft: 'Hello.' }),
    });
    assert.equal(response.status, 200, 'the turn itself succeeded');

    const { rows } = readUsage({ root });
    assert.equal(rows.length, 1, 'one call, one row');
    assert.equal(rows[0].namespace, token.slice(0, 8), 'attributed to this namespace');
    assert.equal(rows[0].model, 'claude-sonnet-5');
    assert.equal(rows[0].input_tokens, 1234);
    assert.equal(rows[0].output_tokens, 56);
    assert.ok(rows[0].usd > 0, 'and priced');

    // The ledger sits beside the namespaces on the volume, not inside one — a
    // per-namespace file would be readable by anyone holding that link.
    assert.equal(usageLedgerPath({ root }), join(root, 'usage.jsonl'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a FAILED turn records no usage — nothing was spent', async () => {
  const { createServer } = await import('../src/server.js');
  const { generateToken } = await import('../src/namespace.js');
  const { DEFAULT_SLUG } = await import('../src/addressing.js');

  const root = freshRoot();
  const app = createServer({
    root,
    host: '127.0.0.1',
    callModel: async () => {
      throw new Error('upstream exploded');
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = generateToken();
    await fetch(`${base}/api/t/${token}/documents`);
    await fetch(`${base}/api/t/${token}/ai-edit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: DEFAULT_SLUG, prompt: 'go', pendingDraft: 'Hello.' }),
    });

    assert.deepEqual(readUsage({ root }).rows, [], 'a call that never returned cost nothing');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
