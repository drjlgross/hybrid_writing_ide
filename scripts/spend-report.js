#!/usr/bin/env node
/**
 * What the deployed app is costing, and which namespace it is coming from.
 *
 *     npm run spend-report
 *     DOCUMENTS_ROOT=/data npm run spend-report
 *
 * Reads the append-only ledger `src/usage-ledger.js` writes and prints three
 * things: a total, a per-namespace table ranked by cost, and a seven-day trend.
 *
 * THIS IS NOT THE DEV BUDGET GUARD. `scripts/spend-guard.js` refuses to spend the
 * development key past a ceiling; this refuses nothing and cannot. It is
 * attribution and smoke detection for a deployment whose enforcement layer is the
 * Console workspace limit — see the header of `src/usage-ledger.js`.
 *
 * An empty or missing ledger is the normal state of a fresh deploy, not an error.
 * It exits 0 and says so.
 */

import { DOCUMENTS_ROOT } from '../src/namespace.js';
import { readUsage, summarizeUsage, usageLedgerPath } from '../src/usage-ledger.js';

const root = DOCUMENTS_ROOT;
const usd = (n) => `$${n.toFixed(4)}`;
const tokens = (n) => n.toLocaleString('en-US');

const { rows, skipped, exists } = readUsage({ root });

console.log('');
console.log(`usage ledger: ${usageLedgerPath({ root })}`);

if (!exists) {
  console.log('');
  console.log('  no ledger yet — nothing has called the model from this documents root.');
  console.log('  That is the normal state of a fresh deploy, not a problem.');
  console.log('');
  process.exit(0);
}

if (rows.length === 0) {
  console.log('');
  console.log('  the ledger exists but holds no rows yet.');
  console.log('');
  process.exit(0);
}

const { total, namespaces, trend, unpriced } = summarizeUsage(rows, { days: 7 });

console.log('');
console.log('─'.repeat(66));
console.log(
  `TOTAL  ${usd(total.usd)}   ${total.calls} call${total.calls === 1 ? '' : 's'}   ` +
    `${tokens(total.input_tokens)} in / ${tokens(total.output_tokens)} out`,
);
console.log('─'.repeat(66));

// ── per namespace, ranked ─────────────────────────────────────────────────────
console.log('');
console.log('BY NAMESPACE (token prefix — never the whole token)');
console.log('');
console.log('  namespace     calls        cost    in tokens   out tokens   last call');
for (const entry of namespaces) {
  console.log(
    `  ${entry.namespace.padEnd(12)}  ${String(entry.calls).padStart(5)}  ` +
      `${usd(entry.usd).padStart(10)}  ${tokens(entry.input_tokens).padStart(11)}  ` +
      `${tokens(entry.output_tokens).padStart(11)}   ${entry.last?.slice(0, 16) ?? '—'}`,
  );
}

// ── last seven days ───────────────────────────────────────────────────────────
// A contiguous window, so a quiet day shows as a zero rather than vanishing and
// making the series look busier than it was.
console.log('');
console.log('LAST 7 DAYS');
console.log('');
const busiest = Math.max(...trend.map((day) => day.usd), 0);
for (const day of trend) {
  const bar = busiest > 0 ? '█'.repeat(Math.round((day.usd / busiest) * 32)) : '';
  console.log(
    `  ${day.day}  ${usd(day.usd).padStart(10)}  ${String(day.calls).padStart(4)} ` +
      `call${day.calls === 1 ? ' ' : 's'}  ${bar}`,
  );
}

// ── caveats, only when they apply ─────────────────────────────────────────────
const notes = [];
if (unpriced > 0) {
  notes.push(
    unpriced === 1
      ? '1 row came from a model not in the rate table and was billed at the most ' +
        'expensive known rate, so the total over-reports it.'
      : `${unpriced} rows came from a model not in the rate table and were billed at the ` +
        'most expensive known rate, so the total over-reports them.',
  );
}
if (skipped > 0) {
  notes.push(
    `${skipped} line${skipped === 1 ? '' : 's'} could not be parsed and were skipped ` +
      '(a truncated last line is what a crash mid-append leaves behind).',
  );
}
if (notes.length > 0) {
  console.log('');
  for (const note of notes) console.log(`  note: ${note}`);
}

console.log('');
console.log('  Measurement only — nothing here enforces a limit (CLAUDE.md § Measurement infra).');
console.log('');
