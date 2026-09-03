/**
 * The standing live-API budget (CLAUDE.md § Sandbox → Live API spend).
 *
 * Every test here writes to a temp ledger. NOTHING in this file may touch the
 * real `.spend.json` — a test suite that reset the budget by running would be
 * worse than no budget, because it would look like it was working.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUDGET_USD,
  BudgetExceededError,
  LEDGER_PATH,
  RATES,
  assertWithinBudget,
  budgetLine,
  budgetReport,
  costOf,
  currentCommit,
  readLedger,
  recordSpend,
  worstCaseCost,
} from '../scripts/spend-guard.js';

const freshLedger = () => join(mkdtempSync(join(tmpdir(), 'spend-')), '.spend.json');

/** A throwaway `.git` whose HEAD this test controls. Nothing shells out to git. */
function fakeGit(sha, { packed = false, detached = false } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'gitdir-')), '.git');
  mkdirSync(join(dir, 'refs', 'heads'), { recursive: true });
  if (detached) {
    writeFileSync(join(dir, 'HEAD'), `${sha}\n`);
  } else {
    writeFileSync(join(dir, 'HEAD'), 'ref: refs/heads/main\n');
    if (packed) writeFileSync(join(dir, 'packed-refs'), `# pack-refs with: peeled\n${sha} refs/heads/main\n`);
    else writeFileSync(join(dir, 'refs', 'heads', 'main'), `${sha}\n`);
  }
  return { dir, move: (next) => writeFileSync(join(dir, 'refs', 'heads', 'main'), `${next}\n`) };
}

test('the ceiling is $1 and the ledger is outside the repo history', () => {
  assert.equal(BUDGET_USD, 1.0);
  assert.match(LEDGER_PATH, /\.spend\.json$/);
});

test('cost comes from the usage block at published rates', () => {
  const rate = RATES['claude-sonnet-5'];
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.equal(costOf(usage, 'claude-sonnet-5'), rate.input + rate.output);

  // A real turn from the live session: 1720 in, 517 out.
  const real = costOf({ input_tokens: 1720, output_tokens: 517 }, 'claude-sonnet-5');
  assert.ok(real > 0.008 && real < 0.009, `expected ~$0.0086, got ${real}`);

  // Cached input is cheaper, and is counted rather than ignored.
  const cached = costOf({ input_tokens: 0, cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-5');
  assert.equal(cached, rate.cacheRead);

  // An UNKNOWN model bills at the most expensive known rate, never at zero. A
  // stale rate table must over-report, never under-report.
  const unknown = costOf({ input_tokens: 1_000_000 }, 'claude-something-new');
  assert.equal(unknown, Math.max(...Object.values(RATES).map((r) => r.input)));
  assert.ok(unknown > 0, 'an unrecognized model is never free');
});

test('the pre-flight estimate prices output at the FULL max_tokens', () => {
  // The guard exists so a request that could cross the line is never sent. That
  // only holds if the estimate assumes the worst the response could cost.
  const worst = worstCaseCost({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000 });
  const actualTypical = costOf({ input_tokens: 1720, output_tokens: 517 }, 'claude-sonnet-5');
  assert.ok(worst > actualTypical, 'the estimate must exceed a typical real call');
  assert.ok(worst >= (4130 / 1_000_000) * RATES['claude-sonnet-5'].output);
});

test('spending accumulates across calls and persists', () => {
  const path = freshLedger();
  const gitDir = fakeGit('c'.repeat(40)).dir;

  const empty = readLedger(path, gitDir);
  assert.equal(empty.total_usd, 0);
  assert.deepEqual(empty.calls, []);

  const first = recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 500 }, label: 'a', path, gitDir });
  const second = recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 500 }, label: 'b', path, gitDir });

  assert.ok(second.total > first.total, 'the total moves');
  assert.equal(second.total.toFixed(6), (first.usd * 2).toFixed(6));

  const ledger = readLedger(path, gitDir);
  assert.equal(ledger.calls.length, 2, 'every call is auditable, not just the total');
  assert.deepEqual(ledger.calls.map((c) => c.label), ['a', 'b']);
  assert.ok(ledger.calls[0].at, 'with a timestamp');
});

test('a call that would cross the ceiling is refused BEFORE it is made', () => {
  const path = freshLedger();
  const gitDir = fakeGit('d'.repeat(40)).dir;
  writeFileSync(path, JSON.stringify({ commit: 'd'.repeat(40), total_usd: 0.99, calls: [] }));

  assert.throws(
    () => assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000, path, gitDir }),
    (error) =>
      error instanceof BudgetExceededError &&
      error.spent === 0.99 &&
      error.next > 0 &&
      error.budget === 1.0,
  );

  // The ledger is untouched by a refusal — nothing was spent, so nothing is recorded.
  assert.equal(readLedger(path, gitDir).total_usd, 0.99);
});

test('under the ceiling it does not ask, it just proceeds', () => {
  // The whole point: iteration at low cost without litigating each call.
  const path = freshLedger();
  const gitDir = fakeGit('e'.repeat(40)).dir;
  const result = assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000, path, gitDir });
  assert.ok(result.remaining > 0.9, 'a fresh budget leaves nearly all of it');
  assert.doesNotThrow(() => assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000, path, gitDir }));
});

test('an unreadable ledger means UNKNOWN, and unknown means stop', () => {
  // The dangerous failure would be a corrupt file reading as $0 spent, which
  // would silently restore the whole budget every time it happened.
  const path = freshLedger();
  const gitDir = fakeGit('0'.repeat(40)).dir;
  writeFileSync(path, 'not json at all');

  assert.equal(readLedger(path, gitDir).unreadable, true);
  assert.notEqual(readLedger(path, gitDir).total_usd, 0);

  assert.throws(
    () => assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 100, path, gitDir }),
    (error) => error instanceof BudgetExceededError && error.spent === null && /could not be read/.test(error.message),
  );
});

test('the refusal explains the ask: spend to date, this call, and the rest of the turn', () => {
  // The standing rule is "stop and explain the request for more, with an
  // estimated total for that turn" — so the report has to carry all three
  // numbers, and say who may lift it.
  const path = freshLedger();
  const gitDir = fakeGit('f'.repeat(40)).dir;
  writeFileSync(path, JSON.stringify({ commit: 'f'.repeat(40), total_usd: 0.995, calls: [] }));

  let report = '';
  try {
    assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000, path, gitDir, remainingCalls: 4 });
  } catch (error) {
    report = budgetReport(error);
  }

  assert.match(report, /BUDGET REACHED/);
  assert.match(report, /nothing was sent/);
  assert.match(report, /\$0\.9950 of \$1\.00/, 'spend to date');
  assert.match(report, /this call\s+: up to \$/, 'what this one would cost');
  assert.match(report, /remaining work\s*: 4 calls, up to \$/, 'and the whole turn');
  assert.match(report, /human's call, not the assistant's/, 'who may lift it');
});

test('nothing in src/ imports the guard, and the guard imports nothing from src/', () => {
  // The app's model caller must not inherit a development budget: the deployed
  // server cannot stop working because a dev ledger says $1.
  const guard = readFileSync(new URL('../scripts/spend-guard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(guard, /from '\.\.\/src\//, 'the guard is standalone');

  for (const file of ['anthropic-client.js', 'ai-edit.js', 'server.js', 'ai-response.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /spend-guard/, `src/${file} must not import the dev budget`);
  }
});

// ── the budget WINDOW: a commit closes it (the runaway detector) ────────────────

test('HEAD is read from the filesystem, in all three shapes, never via git', () => {
  const sha = 'a'.repeat(40);
  assert.equal(currentCommit(fakeGit(sha).dir), sha, 'a loose ref');
  assert.equal(currentCommit(fakeGit(sha, { packed: true }).dir), sha, 'a packed ref');
  assert.equal(currentCommit(fakeGit(sha, { detached: true }).dir), sha, 'a detached HEAD');

  // Cannot tell → null, and null means the window never auto-closes. The budget
  // keeps accumulating rather than silently resetting, which is the safe way to
  // be wrong.
  assert.equal(currentCommit(join(tmpdir(), 'no-such-git-dir-at-all')), null);
});

test('committing closes the window: the next call starts from zero', () => {
  // This is the whole point. $1 is a runaway detector per chunk, not a lifetime
  // cap on the project's development.
  const path = freshLedger();
  const git = fakeGit('a'.repeat(40));

  recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 100_000, output_tokens: 50_000 }, path, gitDir: git.dir });
  const before = readLedger(path, git.dir);
  assert.ok(before.total_usd > 0.5, 'a real amount is on the ledger');
  assert.equal(before.commit, 'a'.repeat(40), 'anchored to the commit it was spent under');

  // Ratify: HEAD moves.
  git.move('b'.repeat(40));

  const after = readLedger(path, git.dir);
  assert.equal(after.total_usd, 0, 'the window closed and a new one opened at zero');
  assert.equal(after.commit, 'b'.repeat(40), 'anchored to the new commit');
  assert.equal(after.calls.length, 0);
  assert.equal(after.previous.total_usd, before.total_usd, 'and what the last window spent is still reported');
});

test('a reset is announced, not silent', () => {
  // A total that drops with no visible reason is worse than no total.
  const path = freshLedger();
  const git = fakeGit('a'.repeat(40));
  recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 100_000, output_tokens: 50_000 }, path, gitDir: git.dir });
  git.move('b'.repeat(40));

  const line = budgetLine(path, git.dir);
  assert.match(line, /reset at bbbbbbb/);
  assert.match(line, /previous window spent \$0\.\d+/);
  assert.match(line, /since bbbbbbb/, 'and names the commit the new window is anchored to');
});

test('a window that has NOT been committed keeps accumulating', () => {
  // The failure that would defeat the guard: resetting on something other than a
  // commit, so a runaway never reaches the ceiling.
  const path = freshLedger();
  const git = fakeGit('a'.repeat(40));

  let total = 0;
  for (let i = 0; i < 5; i += 1) {
    ({ total } = recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 10_000, output_tokens: 10_000 }, path, gitDir: git.dir }));
  }
  assert.equal(readLedger(path, git.dir).calls.length, 5, 'five calls, one window');
  assert.ok(total > 0.5, `five calls accumulate: ${total}`);

  // And the ceiling still fires inside the window.
  assert.throws(
    () => assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 128_000, requestChars: 5000, path, gitDir: git.dir }),
    BudgetExceededError,
  );
});

test('the refusal explains that a commit opens a fresh window', () => {
  // Otherwise the report reads as "the project is out of budget", which is not
  // what happened and would send the human looking for the wrong fix.
  const path = freshLedger();
  const git = fakeGit('a'.repeat(40));
  writeFileSync(path, JSON.stringify({ commit: 'a'.repeat(40), total_usd: 0.99, calls: [] }));

  let report = '';
  try {
    assertWithinBudget({ model: 'claude-sonnet-5', maxTokens: 4130, requestChars: 5000, path, gitDir: git.dir });
  } catch (error) {
    report = budgetReport(error);
  }
  assert.match(report, /PER-WINDOW ceiling/);
  assert.match(report, /ratifying a chunk starts a fresh \$1/);
  assert.match(report, /spending in a loop/, 'and says what reaching it actually signals');
});

test('an un-anchored ledger is retired, not carried into the current window', () => {
  // Migration, and a bug caught by watching the first real commit after this
  // guard shipped fail to reset. A file written before anchoring existed has no
  // `commit` field, so it belongs to some earlier window — carrying its spend
  // forward would charge a fresh chunk for work already ratified.
  const path = freshLedger();
  const git = fakeGit('a'.repeat(40));
  writeFileSync(path, JSON.stringify({ total_usd: 0.0442, calls: [{ label: 'old' }] }));

  const ledger = readLedger(path, git.dir);
  assert.equal(ledger.total_usd, 0, 'the earlier window is closed');
  assert.equal(ledger.commit, 'a'.repeat(40), 'and this one is anchored to HEAD');
  assert.equal(ledger.previous.total_usd, 0.0442, 'with the retired total still reported');
});

test('with no readable HEAD there are no windows, so spend accumulates', () => {
  // The other half of the rule above, and the dangerous one to get wrong: if a
  // missing anchor always reset, a checkout with no git directory would reset on
  // every read and effectively have no budget at all.
  const path = freshLedger();
  const noGit = join(tmpdir(), 'definitely-not-a-git-dir');

  recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 10_000, output_tokens: 10_000 }, path, gitDir: noGit });
  recordSpend({ model: 'claude-sonnet-5', usage: { input_tokens: 10_000, output_tokens: 10_000 }, path, gitDir: noGit });

  const ledger = readLedger(path, noGit);
  assert.equal(ledger.calls.length, 2, 'both calls counted');
  assert.ok(ledger.total_usd > 0.2, 'and the total kept climbing');
  assert.ok(!ledger.previous, 'nothing was retired, because nothing closed a window');
});
