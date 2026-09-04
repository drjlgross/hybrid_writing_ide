/**
 * Published per-million-token rates, for the per-namespace usage ledger.
 *
 * WHY THIS DUPLICATES `scripts/spend-guard.js`. It has to. CLAUDE.md's Sandbox
 * rules say nothing in `src/` may import the dev guard, and
 * `test/spend-guard.test.js` asserts it: the deployed server must not inherit a
 * development budget, or it stops working because a dev ledger on someone's laptop
 * said $1. The guard is a CEILING that refuses; this table feeds a LEDGER that only
 * records. They share arithmetic and share no fate, and merging them would couple
 * the server's operation to a rule written for a developer's machine.
 *
 * The convention is copied deliberately, because a number that means one thing in
 * the dev report and another in the deploy report is worse than a duplicated table:
 * rates are a DATED SNAPSHOT, cached from the API documentation rather than
 * fetched, and an unknown model bills at the most expensive known rate. A stale
 * table therefore over-reports at worst and never under-reports, which is the
 * direction a cost figure should be wrong in.
 *
 * RATES ARE ATTRIBUTION, NOT ENFORCEMENT. Nothing here can refuse a call, and
 * nothing in `src/` may grow that ability (§ Measurement infra): the Console
 * workspace limit is the enforcement layer.
 */

/**
 * USD per million tokens. Snapshot date below is the date the table was last
 * checked against the published pricing, not the date it was written.
 */
export const RATES_AS_OF = '2026-09-04';

export const RATES = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
};

/**
 * The most expensive rate in the table, used for any model not in it.
 *
 * Computed rather than written down, so adding a pricier model to `RATES` cannot
 * leave the fallback quietly cheaper than something real.
 */
export const WORST_RATE = Object.values(RATES).reduce(
  (worst, rate) => ({
    input: Math.max(worst.input, rate.input),
    output: Math.max(worst.output, rate.output),
    cacheRead: Math.max(worst.cacheRead, rate.cacheRead),
    cacheWrite: Math.max(worst.cacheWrite, rate.cacheWrite),
  }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
);

/** @param {string} model */
export const rateFor = (model) => RATES[model] ?? WORST_RATE;

/** True when this model was priced from the table rather than from the fallback. */
export const isKnownModel = (model) => Object.hasOwn(RATES, model);

/**
 * What one response cost, from its `usage` block.
 *
 * @param {object} usage the API response's usage object
 * @param {string} model
 * @returns {number} USD
 */
export function costOf(usage = {}, model) {
  const rate = rateFor(model);
  const perMillion = (tokens, dollars) => ((tokens ?? 0) / 1_000_000) * dollars;
  return (
    perMillion(usage?.input_tokens, rate.input) +
    perMillion(usage?.output_tokens, rate.output) +
    perMillion(usage?.cache_read_input_tokens, rate.cacheRead) +
    perMillion(usage?.cache_creation_input_tokens, rate.cacheWrite)
  );
}
