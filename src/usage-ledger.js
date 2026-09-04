/**
 * Per-namespace usage ledger — MEASURE, NEVER ENFORCE.
 *
 * One JSONL row per live model call, appended to the documents volume. It answers
 * two questions and no others: what is this costing, and which namespace is it
 * coming from. That is attribution and smoke detection.
 *
 * NOTHING HERE CAN REFUSE A CALL, and nothing in `src/` may grow that ability. The
 * Console workspace limit is the enforcement layer; a cap in application code would
 * mean the app stops working for everyone because a file on a disk said so, which
 * is exactly the failure the dev guard is kept out of `src/` to avoid. There is no
 * throttle, no quota, no budget, and no read of this file anywhere on the request
 * path — `scripts/spend-report.js` is the only reader.
 *
 * TOKEN PREFIX, NEVER THE TOKEN. A capability token is the whole identity (§0.5),
 * so writing one into a log is writing a credential into a log. Eight hex
 * characters distinguish the handful of people who will ever hold a link and are
 * useless to anyone who finds the file. The prefix is derived by the one namespace
 * function, so no handler reads a token to produce it.
 *
 * APPEND-ONLY AND FAILURE-TOLERANT. A ledger write happens after a model call has
 * already succeeded and cost money; throwing there would turn a completed turn into
 * a failed one and lose the human's work to a bookkeeping error. So every failure
 * is swallowed and reported in the return value instead. Losing a row is a gap in
 * a cost report; losing a turn is a gap in someone's draft.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DOCUMENTS_ROOT } from './namespace.js';
import { costOf, isKnownModel } from './usage-rates.js';

/** One file for every namespace, beside them on the volume. */
export const USAGE_LEDGER = 'usage.jsonl';

/** @param {{root?: string}} [options] */
export function usageLedgerPath({ root = DOCUMENTS_ROOT } = {}) {
  return join(root, USAGE_LEDGER);
}

/**
 * Append one call.
 *
 * @param {{label?: string|null, model?: string, usage?: object,
 *   root?: string, at?: Date}} entry
 *   `label` is the namespace's token prefix, from `resolveNamespace`.
 * @returns {{written: boolean, row?: object, error?: string}}
 *   Never throws. See the note above about not failing a paid-for turn.
 */
export function recordUsage({ label, model, usage, root = DOCUMENTS_ROOT, at = new Date() } = {}) {
  try {
    const row = {
      at: at.toISOString(),
      namespace: typeof label === 'string' && label !== '' ? label : 'unknown',
      model: typeof model === 'string' && model !== '' ? model : 'unknown',
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
      usd: Number(costOf(usage ?? {}, model).toFixed(6)),
      // Recorded per row, not inferred later: a report reading an old ledger must
      // be able to say which rows were priced at a guess without knowing which
      // models the table held on the day they were written.
      rate_known: isKnownModel(model),
    };

    const path = usageLedgerPath({ root });
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`);
    return { written: true, row };
  } catch (error) {
    return { written: false, error: error?.message ?? String(error) };
  }
}

/**
 * Every row, oldest first.
 *
 * A MISSING FILE IS AN EMPTY LEDGER, not an error: a fresh deploy has made no
 * calls yet, and that is the normal state of the thing on its first day.
 *
 * A corrupt LINE is skipped and counted rather than fatal. The file is appended to
 * by a live server, so a truncated last line is a crash artifact, and one bad row
 * must not hide the thousand good ones above it.
 *
 * @param {{root?: string}} [options]
 * @returns {{rows: object[], skipped: number, path: string, exists: boolean}}
 */
export function readUsage({ root = DOCUMENTS_ROOT } = {}) {
  const path = usageLedgerPath({ root });
  if (!existsSync(path)) return { rows: [], skipped: 0, path, exists: false };

  const rows = [];
  let skipped = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { rows, skipped, path, exists: true };
}

/**
 * Roll rows up for a report: a total, a per-namespace table, and a daily trend.
 *
 * Kept out of the script so it can be asserted without capturing stdout.
 *
 * @param {object[]} rows
 * @param {{days?: number, now?: Date}} [options]
 */
export function summarizeUsage(rows = [], { days = 7, now = new Date() } = {}) {
  const total = { calls: 0, usd: 0, input_tokens: 0, output_tokens: 0 };
  const byNamespace = new Map();
  const byDay = new Map();
  let unpriced = 0;

  for (const row of rows) {
    const usd = Number(row?.usd) || 0;
    const input = Number(row?.input_tokens) || 0;
    const output = Number(row?.output_tokens) || 0;

    total.calls += 1;
    total.usd += usd;
    total.input_tokens += input;
    total.output_tokens += output;
    if (row?.rate_known === false) unpriced += 1;

    const ns = row?.namespace ?? 'unknown';
    const entry = byNamespace.get(ns) ?? { namespace: ns, calls: 0, usd: 0, input_tokens: 0, output_tokens: 0, last: null };
    entry.calls += 1;
    entry.usd += usd;
    entry.input_tokens += input;
    entry.output_tokens += output;
    if (typeof row?.at === 'string' && (!entry.last || row.at > entry.last)) entry.last = row.at;
    byNamespace.set(ns, entry);

    // `at` is an ISO string, so the first ten characters are the UTC date. No
    // Date parsing, which keeps a malformed timestamp from becoming an Invalid
    // Date that silently lands in whichever bucket sorts first.
    const day = typeof row?.at === 'string' ? row.at.slice(0, 10) : 'unknown';
    const bucket = byDay.get(day) ?? { day, calls: 0, usd: 0 };
    bucket.calls += 1;
    bucket.usd += usd;
    byDay.set(day, bucket);
  }

  // The trend runs over a CONTIGUOUS window ending today, so a day with no calls
  // shows as a zero rather than vanishing and making the series look continuous.
  const trend = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    trend.push(byDay.get(date) ?? { day: date, calls: 0, usd: 0 });
  }

  return {
    total,
    unpriced,
    namespaces: [...byNamespace.values()].sort((a, b) => b.usd - a.usd || b.calls - a.calls),
    trend,
  };
}
