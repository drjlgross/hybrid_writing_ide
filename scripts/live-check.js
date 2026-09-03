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

const rule = (label = '') => console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 74 - label.length))}`);

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

// ── one turn ────────────────────────────────────────────────────────────────────
for (const turn of TURNS) {
  rule(`TURN: ${turn.label}`);
  console.log(`  prompt         : ${JSON.stringify(turn.prompt)}`);

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

  console.log(`\n  elapsed        : ${elapsed}ms`);
  console.log(`  model returned : ${body.model}`);
  console.log(`  stop_reason    : ${JSON.stringify(body.stop_reason)}`);
  console.log(`  usage          : in ${body.usage?.input_tokens}, out ${body.usage?.output_tokens}`);

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
console.log('headers, model ID and the §2.2 response contract are all real.\n');
