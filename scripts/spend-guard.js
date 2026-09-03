/**
 * The standing live-API budget (CLAUDE.md § Sandbox → Live API spend).
 *
 * The dev key exists so things can be tried at low cost during development, and
 * asking permission per call defeats that. So: no asking under the ceiling, a
 * hard stop at it. This module is the ceiling.
 *
 * WHY IT LIVES HERE AND NOT IN `src/`. `src/anthropic-client.js` is the app's
 * model caller and runs in the deployed server, where a development budget would
 * be nonsense — the server must not stop working because a dev ledger somewhere
 * says $1. Every script that spends the dev key routes through this instead, and
 * nothing in `src/` imports it.
 *
 * WHAT IT CANNOT DO. It is a guardrail, not a vault. It counts what goes through
 * it, so a script that calls the API without it is uncounted, and deleting the
 * ledger resets the count. Both are deliberate: the rule in CLAUDE.md is the
 * control, and this is the thing that makes the rule hard to forget rather than
 * impossible to break.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The ceiling, PER BUDGET WINDOW — not for the life of the project.
 *
 * A window opens at a commit and closes at the next one. Ratifying a chunk (a
 * commit) starts a fresh $1. So this is a runaway detector: it catches a process
 * spending in a loop and stops it near the source, and it does not ration the
 * project's development budget.
 */
export const BUDGET_USD = 1.0;

/** Where the running total lives. Gitignored; see the note above about resets. */
export const LEDGER_PATH = fileURLToPath(new URL('../.spend.json', import.meta.url));

/** The repo's git directory, read directly — nothing here shells out to `git`. */
export const GIT_DIR = fileURLToPath(new URL('../.git/', import.meta.url));

/**
 * The commit HEAD points at, read from the filesystem.
 *
 * Deliberately NOT `git rev-parse`: CLAUDE.md's operating rules say never to run
 * git, and a budget guard is the last place to start making exceptions. Reading
 * two files is enough and cannot mutate anything.
 *
 * Returns null when it cannot tell — no repo, a `.git` file rather than a
 * directory (a worktree), an unreadable ref. Null means the window never
 * auto-closes, which is the safe direction: the budget keeps accumulating rather
 * than silently resetting.
 */
export function currentCommit(gitDir = GIT_DIR) {
  try {
    if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) return null;

    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head || null; // detached HEAD holds the sha

    const ref = head.slice(4).trim();
    const loose = join(gitDir, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim() || null;

    // A ref that has been packed lives in packed-refs instead of its own file.
    const packed = join(gitDir, 'packed-refs');
    if (!existsSync(packed)) return null;
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      if (line.startsWith('#') || line.startsWith('^')) continue;
      const [sha, name] = line.trim().split(/\s+/);
      if (name === ref) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Published per-million-token rates, USD.
 *
 * Cached from the API documentation, not fetched — a budget guard that needs a
 * network call to decide whether it may make a network call is a bad guard. They
 * are therefore a snapshot and can go stale; `costOf` rounds UP into an unknown
 * model's rate rather than treating it as free, so a stale table under-reports
 * nothing and over-reports at worst.
 */
export const RATES = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** The most expensive rate we know of. Used for a model not in the table. */
const WORST_RATE = Object.values(RATES).reduce(
  (worst, rate) => ({
    input: Math.max(worst.input, rate.input),
    output: Math.max(worst.output, rate.output),
    cacheRead: Math.max(worst.cacheRead, rate.cacheRead),
    cacheWrite: Math.max(worst.cacheWrite, rate.cacheWrite),
  }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
);

const rateFor = (model) => RATES[model] ?? WORST_RATE;

/** Thrown instead of spending. The caller reports it and stops. */
export class BudgetExceededError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'BudgetExceededError';
    Object.assign(this, detail);
  }
}

/**
 * What one response actually cost, from its `usage` block.
 *
 * @param {object} usage the API response's usage object
 * @param {string} model
 * @returns {number} USD
 */
export function costOf(usage = {}, model) {
  const rate = rateFor(model);
  const perMillion = (tokens, dollars) => ((tokens ?? 0) / 1_000_000) * dollars;
  return (
    perMillion(usage.input_tokens, rate.input) +
    perMillion(usage.output_tokens, rate.output) +
    perMillion(usage.cache_read_input_tokens, rate.cacheRead) +
    perMillion(usage.cache_creation_input_tokens, rate.cacheWrite)
  );
}

/**
 * The worst this call could cost, computed BEFORE making it.
 *
 * Output is priced at the full `max_tokens`, not at a guess, because the whole
 * point is to never begin a request that could cross the line. Input is
 * estimated from the request body at a deliberately low chars-per-token, which
 * over-counts.
 */
export function worstCaseCost({ model, maxTokens, requestChars = 0 }) {
  const rate = rateFor(model);
  const estimatedInput = Math.ceil(requestChars / 3);
  return (estimatedInput / 1_000_000) * rate.input + ((maxTokens ?? 0) / 1_000_000) * rate.output;
}

/**
 * The ledger, or an empty one. A corrupt file reads as UNKNOWN, not as zero.
 *
 * `path` is injectable for one reason: the tests must not be able to spend the
 * real budget, or to reset it by running.
 */
export function readLedger(path = LEDGER_PATH, gitDir = GIT_DIR) {
  const fresh = (commit) => ({ total_usd: 0, calls: [], commit, reset: true });

  if (!existsSync(path)) return { ...fresh(currentCommit(gitDir)), reset: false };
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof ledger?.total_usd !== 'number' || !Array.isArray(ledger.calls)) throw new Error('shape');
  } catch {
    // Deliberately NOT silent, and deliberately not zero: an unreadable ledger
    // is treated as "budget unknown", which is the safe reading.
    return { total_usd: Number.NaN, calls: [], unreadable: true };
  }

  // THE WINDOW CLOSES AT A COMMIT. A ledger anchored to a commit that is no
  // longer HEAD belongs to work that has been ratified, so its spend is settled
  // and a new window opens at zero. This is what makes the ceiling a runaway
  // detector rather than a lifetime cap.
  //
  // HEAD moving for some other reason — a branch switch, an amend — also opens a
  // window. That is a false reset in principle and harmless in practice: a
  // runaway happens inside one working session, during which HEAD does not move.
  const head = currentCommit(gitDir);
  if (head && ledger.commit && ledger.commit !== head) {
    return { ...fresh(head), previous: { total_usd: ledger.total_usd, commit: ledger.commit } };
  }

  return { ...ledger, commit: ledger.commit ?? head ?? null };
}

/** Append one call and persist. Returns the new total. */
export function recordSpend({ model, usage, label, path = LEDGER_PATH, gitDir = GIT_DIR }) {
  const ledger = readLedger(path, gitDir);
  const usd = costOf(usage, model);
  const entry = {
    at: new Date().toISOString(),
    label: label ?? null,
    model,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    usd: Number(usd.toFixed(6)),
  };
  const total = (Number.isFinite(ledger.total_usd) ? ledger.total_usd : 0) + usd;
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        // The commit this window is anchored to. The next commit closes it.
        commit: ledger.commit ?? currentCommit(gitDir),
        total_usd: Number(total.toFixed(6)),
        calls: [...ledger.calls, entry],
      },
      null,
      2,
    )}\n`,
  );
  return { usd, total };
}

/**
 * Refuse to spend past the ceiling.
 *
 * Called BEFORE each request. Throws `BudgetExceededError` carrying everything
 * the report needs — spend to date, what this call would have cost, and what the
 * remaining work would cost — so the caller can explain the ask rather than just
 * saying no.
 */
export function assertWithinBudget({
  model,
  maxTokens,
  requestChars,
  label,
  remainingCalls = 1,
  path = LEDGER_PATH,
  gitDir = GIT_DIR,
  budget = BUDGET_USD,
}) {
  const ledger = readLedger(path, gitDir);
  const spent = Number.isFinite(ledger.total_usd) ? ledger.total_usd : 0;
  const next = worstCaseCost({ model, maxTokens, requestChars });

  if (ledger.unreadable) {
    throw new BudgetExceededError(
      `the spend ledger at ${path} could not be read, so the running total is unknown. ` +
        'Refusing to spend rather than guessing. Delete the file to start a fresh budget.',
      { spent: null, next, budget },
    );
  }

  if (spent + next > budget) {
    throw new BudgetExceededError(
      `the $${budget.toFixed(2)} live-API budget would be exceeded by this call.`,
      {
        spent,
        next,
        projected: next * remainingCalls,
        remainingCalls,
        budget,
        remaining: budget - spent,
        label,
      },
    );
  }

  return { spent, next, remaining: budget - spent };
}

/** A one-line status, for a script that wants to print where it stands. */
export function budgetLine(path = LEDGER_PATH, gitDir = GIT_DIR) {
  const ledger = readLedger(path, gitDir);
  if (ledger.unreadable) return `spend ledger unreadable at ${path}`;

  const spent = ledger.total_usd;
  const window = ledger.commit ? ` since ${ledger.commit.slice(0, 7)}` : ' (no commit anchor)';
  const line =
    `$${spent.toFixed(4)} of $${BUDGET_USD.toFixed(2)}${window}, ` +
    `${ledger.calls.length} call${ledger.calls.length === 1 ? '' : 's'} ` +
    `($${(BUDGET_USD - spent).toFixed(4)} left this window)`;

  // Say so when a commit has just opened a new window, rather than letting the
  // total appear to drop for no visible reason.
  return ledger.previous
    ? `${line} — reset at ${ledger.commit.slice(0, 7)}; the previous window spent $${ledger.previous.total_usd.toFixed(4)}`
    : line;
}

/**
 * What to print when the guard fires.
 *
 * The standing rule says: stop, and explain the request for more, with an
 * estimated total for the turn. That sentence is generated here so it is the
 * same sentence every time and cannot drift into a vaguer one.
 */
export function budgetReport(error) {
  const lines = [
    '',
    '─'.repeat(76),
    'LIVE API BUDGET REACHED — nothing was sent.',
    '',
    error.spent === null
      ? '  spent so far   : unknown (ledger unreadable)'
      : `  spent so far   : $${error.spent.toFixed(4)} of $${error.budget.toFixed(2)}`,
    `  this call      : up to $${error.next.toFixed(4)}`,
  ];
  if (error.remainingCalls > 1) {
    lines.push(`  remaining work : ${error.remainingCalls} calls, up to $${error.projected.toFixed(4)}`);
  }
  lines.push(
    '',
    '  This is a PER-WINDOW ceiling: a window opens at a commit and closes at the',
    '  next one, so ratifying a chunk starts a fresh $1. Reaching it inside one',
    '  window is the signal it exists for — something is spending in a loop.',
    '',
    '  To continue without committing, raise BUDGET_USD in scripts/spend-guard.js',
    '  or clear the ledger with:  rm .spend.json',
    '',
    '  Both are the human\'s call, not the assistant\'s (CLAUDE.md § Sandbox).',
    '─'.repeat(76),
    '',
  );
  return lines.join('\n');
}
