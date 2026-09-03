#!/usr/bin/env node
/**
 * Real API calls, so the request shape, headers, model ID, and — since chunk 11 —
 * WHETHER THE MODEL HONOURS THE §2.2 RESPONSE CONTRACT stop being unverified.
 *
 *     ANTHROPIC_API_KEY=sk-... node scripts/live-check.js
 *     ANTHROPIC_API_KEY=sk-... node scripts/live-check.js --legacy
 *     ANTHROPIC_API_KEY=sk-... node scripts/live-check.js "make it warmer"
 *
 * By default it runs BOTH shapes the contract allows, because they fail
 * differently and only one of them is exercised by an editing prompt:
 *
 *   a question  → §0.9 speech-only: a note, and no `draft` field
 *   an edit     → a note AND a complete revised draft
 *
 * `--legacy` sends the same two requests WITHOUT `output_config.format`, which is
 * how the original bug reproduces: the instruction alone was not enough, and
 * "what do you think of this draft?" came back as `**What I n…`. Keep this flag.
 * The day a model honours the contract on the instruction alone is a day worth
 * being able to detect, and without it nobody could.
 *
 * Deliberately NOT part of `npm test`: the suite must keep running with no key and
 * no network. This script is the opposite — it exists only to touch the network,
 * and it costs money every time it runs.
 *
 * It touches no document and no storage. Nothing is committed; the draft it uses
 * is a literal in this file.
 */

import {
  createModelCaller,
  API_URL,
  API_VERSION,
  MODEL,
  OUTPUT_FORMAT,
  SYSTEM_PROMPT,
  buildUserMessage,
} from '../src/anthropic-client.js';
import { AiResponseError, extractText, maxTokensForDraft, validateAiResponse } from '../src/ai-response.js';
import { canonicalize } from '../src/canonicalize.js';
import {
  BudgetExceededError,
  assertWithinBudget,
  budgetLine,
  budgetReport,
  costOf,
  recordSpend,
} from './spend-guard.js';

const rule = (label = '') => console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 74 - label.length))}`);

// ── the budget (CLAUDE.md § Sandbox → Live API spend) ───────────────────────────
// Checked before the key, so `--budget` answers "where do I stand" without
// needing one.
if (process.argv.includes('--budget')) {
  console.log(`\n  ${budgetLine()}\n`);
  process.exit(0);
}

// ── the key ─────────────────────────────────────────────────────────────────────
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    '\nlive-check FAILED: ANTHROPIC_API_KEY is not set in the environment.\n\n' +
      'This script makes one real API call, so it needs a real key. Set it for this\n' +
      'command only:\n\n' +
      '    ANTHROPIC_API_KEY=sk-ant-... node scripts/live-check.js\n\n' +
      'The key stays server-side (§0.6). Nothing else in this project needs it — the\n' +
      'whole test suite runs without one.\n',
  );
  process.exit(1);
}

// ── the input ───────────────────────────────────────────────────────────────────
// Two sentences, already canonical, carrying one construct from the §1 dialect so
// the response has something to preserve.
const DRAFT = canonicalize(
  'The prototype keeps **one** working draft that both parties edit.\n' +
    'Every change is recorded with attribution, and the history is reviewable at the end.\n',
);

const legacy = process.argv.includes('--legacy');
const custom = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

/**
 * Both shapes the §2.2 contract allows. They fail differently, and an editing
 * prompt exercises only one of them — the bug that prompted this script's rewrite
 * was on the question, which is the shape nothing else covers.
 *
 * The question is the exact prompt that lost the first live turn.
 */
const TURNS = custom
  ? [{ label: 'custom', prompt: custom, expect: 'either' }]
  : [
      { label: 'speech-only (§0.9)', prompt: 'what do you think of this draft?', expect: 'no draft' },
      { label: 'edit', prompt: 'Make the second sentence a little more direct.', expect: 'a draft' },
    ];

const callModel = createModelCaller({
  apiKey,
  fetchImpl: async (url, init) => {
    lastSent = { url, init };
    return fetch(url, init);
  },
  ...(legacy ? { structuredOutput: false } : {}),
});

let lastSent = null;
let failures = 0;
const measured = [];

// ── what every request looks like ───────────────────────────────────────────────
rule('REQUEST SHAPE');
console.log(`  url            : ${API_URL}`);
console.log(`  model          : ${MODEL}`);
console.log(`  anthropic-ver  : ${API_VERSION}`);
console.log(`  max_tokens     : ${maxTokensForDraft(DRAFT)}  (computed from ${DRAFT.length} draft chars, §2.3)`);
console.log(`  system prompt  : ${SYSTEM_PROMPT.length} chars (§6, plus §2.2's contract spelt out)`);
console.log(
  `  output_config  : ${
    legacy
      ? 'NONE — --legacy, the pre-fix request shape (instruction only)'
      : `format=${OUTPUT_FORMAT.type}, ${Object.keys(OUTPUT_FORMAT.schema.properties).join('/')} (§2.2 enforcement)`
  }`,
);
console.log(`  closing line   : ${JSON.stringify(buildUserMessage({ draft: 'D', prompt: 'P' }).split('---').at(-1).trim().slice(0, 60))}…`);
console.log(`  human-edit diff: none — this script commits no turns, so there is no prior human turn`);
console.log(`  budget         : ${budgetLine()}`);

// ── one turn ────────────────────────────────────────────────────────────────────
for (const turn of TURNS) {
  rule(`TURN: ${turn.label}`);
  console.log(`  prompt         : ${JSON.stringify(turn.prompt)}`);

  // BEFORE the call, never after: the ceiling exists so a request that would
  // cross it is not sent, not so it can be regretted.
  try {
    assertWithinBudget({
      model: MODEL,
      maxTokens: maxTokensForDraft(DRAFT),
      requestChars: SYSTEM_PROMPT.length + buildUserMessage({ draft: DRAFT, prompt: turn.prompt }).length,
      label: turn.label,
      remainingCalls: TURNS.length - TURNS.indexOf(turn),
    });
  } catch (error) {
    if (!(error instanceof BudgetExceededError)) throw error;
    console.log(budgetReport(error));
    process.exit(2);
  }

  const started = Date.now();
  let body;
  try {
    body = await callModel({ draft: DRAFT, prompt: turn.prompt, humanEditDiff: null });
  } catch (error) {
    console.log(`  FAILED before a body existed: ${error.message}`);
    console.log('  Headers, model ID, or the key itself are what to suspect.');
    failures += 1;
    continue;
  }
  const elapsed = Date.now() - started;

  // Only on the first turn, and only after a request has actually gone out. The
  // key is redacted: this output gets pasted into reports.
  if (turn === TURNS[0]) {
    const parsed = JSON.parse(lastSent.init.body);
    console.log('\n  headers actually sent:');
    for (const [name, value] of Object.entries(lastSent.init.headers)) {
      console.log(`    ${name}: ${name === 'x-api-key' ? `${value.slice(0, 11)}…[redacted]` : value}`);
    }
    console.log(`  body keys      : ${Object.keys(parsed).join(', ')}`);
    console.log(`  messages       : ${parsed.messages.map((m) => m.role).join(', ')} (must end with user — this model rejects a prefill)`);
  }

  // §2.2's amendment turns on OUTPUT tokens: a speech-only turn that returns
  // `"draft": null` writes a note; one that reproduces the draft writes the note
  // plus the whole draft again, and the human waits for it. Printing the numbers
  // is what turns "it felt slow" into a measurement, and it is the check that
  // says whether the null instruction is landing.
  const u = body.usage ?? {};
  const perSecond = u.output_tokens ? Math.round(u.output_tokens / (elapsed / 1000)) : 0;
  const spend = recordSpend({ model: body.model ?? MODEL, usage: u, label: turn.label });
  console.log(`\n  elapsed        : ${elapsed}ms`);
  console.log(`  model returned : ${body.model}`);
  console.log(`  stop_reason    : ${JSON.stringify(body.stop_reason)}`);
  console.log(`  input tokens   : ${u.input_tokens}${
    u.cache_read_input_tokens ? ` (+${u.cache_read_input_tokens} cache read)` : ''
  }${u.cache_creation_input_tokens ? ` (+${u.cache_creation_input_tokens} cache write)` : ''}`);
  console.log(`  OUTPUT tokens  : ${u.output_tokens}  — ${perSecond} tok/s, and the whole of the wait`);
  console.log(`  max_tokens     : ${maxTokensForDraft(DRAFT)} (headroom used: ${
    Math.round((100 * (u.output_tokens ?? 0)) / maxTokensForDraft(DRAFT))
  }%)`);
  console.log(`  cost           : $${spend.usd.toFixed(4)}  (running total $${spend.total.toFixed(4)})`);

  // A model ID the API silently substitutes is the failure this script is best
  // placed to catch, and it would otherwise never be noticed.
  if (body.model && !String(body.model).startsWith(MODEL)) {
    console.log(`  NOTE: requested ${MODEL}, served ${body.model}. The model ID may be an alias.`);
  }

  const raw = extractText(body);
  console.log(`\n  the reply as §2.3 sees it (${raw.length} chars):`);
  for (const line of raw.slice(0, 1400).split('\n')) console.log(`    | ${line}`);
  if (raw.length > 1400) console.log(`    | …[${raw.length - 1400} more chars]`);

  // THE QUESTION THIS SCRIPT EXISTS TO ANSWER.
  console.log(`\n  starts with "{" : ${raw.trimStart().startsWith('{') ? 'YES' : 'NO — this reply is not the §2.2 envelope'}`);

  // §2.2 amended: `draft: null` is the speech-only spelling. `result.changed`
  // cannot tell you which the model did — a reproduced draft and a null draft
  // both leave the snapshot unchanged — so read the raw envelope for it.
  let rawDraftWasNull = null;
  let rawDraftChars = 0;
  try {
    const envelope = JSON.parse(raw);
    rawDraftWasNull = envelope.draft === null;
    rawDraftChars = String(envelope.draft ?? '').length;
    console.log(
      `  "draft" field   : ${
        envelope.draft === null
          ? 'null — §2.2, no regeneration'
          : `a string of ${String(envelope.draft ?? '').length} chars`
      }`,
    );
  } catch {
    /* the guards below will report it */
  }

  let result;
  try {
    result = validateAiResponse(body, { draft: DRAFT, prompt: turn.prompt });
  } catch (error) {
    const detail = error instanceof AiResponseError ? ` (reason: ${error.reason})` : '';
    console.log(`  PARSED         : NO${detail}`);
    console.log(`    ${error.message}`);
    console.log('\n  In the app this is a 502 with draft_unchanged: true, and the editor unlocks.');
    console.log('  This is exactly the red box in the panel.');
    failures += 1;
    continue;
  }

  console.log(`  PARSED         : YES`);
  console.log(`  changed        : ${result.changed ? 'yes — a revision' : 'NO — §0.9 speech-only turn'}`);
  measured.push({
    label: turn.label,
    changed: result.changed,
    nullDraft: rawDraftWasNull,
    draftChars: rawDraftChars,
    out: u.output_tokens ?? 0,
    ms: elapsed,
    note: result.note.length,
  });
  console.log(`  expected       : ${turn.expect}`);
  console.log(`  segments       : ${result.segments.length === 0 ? 'none' : JSON.stringify(result.segments)}`);
  console.log(`  warnings       : ${result.warnings.length === 0 ? 'none fired' : ''}`);
  for (const warning of result.warnings) console.log(`    - ${warning}`);
  console.log(
    `  stripped       : ${
      Object.keys(result.stripped).length === 0 ? 'nothing — the response stayed inside the dialect' : JSON.stringify(result.stripped)
    }`,
  );

  console.log(`\n  the note (§0.7 — what the panel would show):`);
  for (const line of (result.note || '(the model said nothing)').split('\n')) console.log(`    | ${line}`);

  if (result.changed) {
    console.log(`\n  the draft that would have been committed (${result.draft.length} chars, input was ${DRAFT.length}):`);
    for (const line of result.draft.split('\n')) console.log(`    | ${line}`);
  } else {
    console.log(`\n  the draft is untouched — §0.9's snapshot carries the prior text unchanged.`);
  }
}

// ── the verdict ─────────────────────────────────────────────────────────────────
rule('');
if (failures > 0) {
  console.log(`live-check FAILED: ${failures} of ${TURNS.length} turns did not parse as the §2.2 envelope.`);
  console.log(legacy ? 'That is what --legacy is for — this is the pre-fix request shape.\n' : '\n');
  process.exit(legacy ? 0 : 1);
}
console.log(`live-check passed: ${TURNS.length}/${TURNS.length} turns parsed. The request shape,`);
console.log('headers, model ID and the §2.2 response contract are all real.');
console.log(`\n  ${budgetLine()}\n`);

if (measured.length > 1) {
  rule('WHAT A SPEECH-ONLY TURN COSTS (§2.2)');

  // A RATIO OF TOTAL OUTPUT TOKENS IS THE WRONG METRIC and the first live run of
  // this table proved it: the speech-only turn came out at 158% of the edit
  // turn's output, which reads like a failure and is not one. It wrote a longer
  // NOTE. The draft in this script is two sentences, so regenerating it costs
  // ~40 tokens — noise next to the note, which varies by hundreds.
  //
  // The thing F66 is actually about is whether any output tokens go on draft
  // text at all. That is a yes/no from the raw envelope, and the cost avoided
  // scales with the draft, so it is reported as a scale rather than a ratio.
  console.log('  turn                 "draft"      out tok   note ch     ms');
  for (const m of measured) {
    console.log(
      `  ${m.label.padEnd(20)} ${(m.nullDraft ? 'null' : `${m.draftChars} ch`).padEnd(12)} ${String(m.out).padStart(7)} ${String(m.note).padStart(9)} ${String(m.ms).padStart(6)}`,
    );
  }

  const speech = measured.filter((m) => !m.changed);
  const regenerated = speech.filter((m) => !m.nullDraft);

  console.log('');
  if (speech.length === 0) {
    console.log('  No speech-only turn in this run, so §2.2\'s null path was not exercised.');
  } else if (regenerated.length > 0) {
    console.log(`  FAILING: ${regenerated.length} of ${speech.length} speech-only turns reproduced the draft`);
    console.log('  instead of returning null. §2.2\'s null instruction is not landing, and every');
    console.log('  question she asks is costing her a full draft of generation.');
  } else {
    const perToken = 3.5; // chars per token, conservative for this tokenizer
    const avoided = Math.round(DRAFT.length / perToken);
    console.log(`  PASSING: every speech-only turn returned "draft": null — zero output tokens`);
    console.log(`  spent on draft text (§2.2, F66).`);
    console.log('');
    console.log(`  Cost avoided scales with the draft, not with this test. Here the draft is`);
    console.log(`  ${DRAFT.length} chars, so regenerating it would have cost about ${avoided} tokens. At 1,500`);
    console.log(`  chars that is ~${Math.round(1500 / perToken)}; at 6,000, ~${Math.round(6000 / perToken)} — on every question asked.`);
  }
  console.log('');
}
