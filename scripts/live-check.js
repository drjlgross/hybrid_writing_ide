#!/usr/bin/env node
/**
 * One real API call, so the request shape, headers, and model ID stop being
 * unverified (chunk-05 §5 named all three).
 *
 *     ANTHROPIC_API_KEY=sk-... node scripts/live-check.js
 *     ANTHROPIC_API_KEY=sk-... node scripts/live-check.js "make it warmer"
 *
 * Deliberately NOT part of `npm test`: the suite must keep running with no key and
 * no network. This script is the opposite — it exists only to touch the network,
 * and it costs money every time it runs.
 *
 * It touches no document and no storage. Nothing is committed; the draft it uses
 * is a literal in this file.
 */

import { createModelCaller, API_URL, API_VERSION, MODEL, SYSTEM_PROMPT } from '../src/anthropic-client.js';
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
const PROMPT = process.argv[2] ?? 'Make the second sentence a little more direct.';

// ── the call ────────────────────────────────────────────────────────────────────
// Wrap fetch rather than rebuilding the request here: what gets printed must be the
// bytes the real client sends, or this check verifies a reconstruction instead of
// the thing that will run in production.
let sent = null;
const recordingFetch = async (url, init) => {
  sent = { url, init };
  return fetch(url, init);
};

const callModel = createModelCaller({ apiKey, fetchImpl: recordingFetch });

rule('REQUEST');
console.log(`  url            : ${API_URL}`);
console.log(`  model          : ${MODEL}`);
console.log(`  anthropic-ver  : ${API_VERSION}`);
console.log(`  max_tokens     : ${maxTokensForDraft(DRAFT)}  (computed from ${DRAFT.length} draft chars, §2.3)`);
console.log(`  system prompt  : ${SYSTEM_PROMPT.length} chars (§6 verbatim)`);
console.log(`  instruction    : ${JSON.stringify(PROMPT)}`);
console.log(`  human-edit diff: none — this script commits no turns, so there is no prior human turn`);

const started = Date.now();
let body;
try {
  body = await callModel({ draft: DRAFT, prompt: PROMPT, humanEditDiff: null });
} catch (error) {
  rule('FAILED');
  console.error(`  ${error.message}`);
  console.error('\n  The request never produced a body. Headers, model ID, or the key itself');
  console.error('  are the things to suspect — those are exactly what this script exists to test.');
  process.exit(1);
}
const elapsed = Date.now() - started;

// Now that the request has actually gone out, show what it looked like on the wire.
// The key is redacted: this output gets pasted into reports.
const parsed = JSON.parse(sent.init.body);
console.log('\n  headers actually sent:');
for (const [name, value] of Object.entries(sent.init.headers)) {
  console.log(`    ${name}: ${name === 'x-api-key' ? `${value.slice(0, 11)}…[redacted]` : value}`);
}
console.log(`  body keys: ${Object.keys(parsed).join(', ')}`);
console.log(`  messages : ${parsed.messages.length} × role=${parsed.messages.map((m) => m.role).join(',')}`);
console.log(`  user message (${parsed.messages[0].content.length} chars):`);
for (const line of parsed.messages[0].content.split('\n')) console.log(`    | ${line}`);

// ── the response ────────────────────────────────────────────────────────────────
rule('RESPONSE');
console.log(`  elapsed        : ${elapsed}ms`);
console.log(`  id             : ${body.id}`);
console.log(`  model returned : ${body.model}`);
console.log(`  stop_reason    : ${JSON.stringify(body.stop_reason)}`);
console.log(`  usage          : in ${body.usage?.input_tokens}, out ${body.usage?.output_tokens}`);
console.log(`  content blocks : ${(body.content ?? []).map((b) => b.type).join(', ') || '(none)'}`);

const raw = extractText(body);
console.log(`\n  raw text (${raw.length} chars):`);
for (const line of raw.split('\n')) console.log(`    | ${line}`);

// A model ID the API silently substitutes is the failure this script is best placed
// to catch, and it would otherwise never be noticed.
if (body.model && !String(body.model).startsWith(MODEL)) {
  console.log(`\n  NOTE: requested ${MODEL}, served ${body.model}. The model ID may be an alias.`);
}

// ── the §2.3 guards ─────────────────────────────────────────────────────────────
rule('GUARDS (§2.3)');
let result;
try {
  result = validateAiResponse(body, { draft: DRAFT, prompt: PROMPT });
} catch (error) {
  const detail = error instanceof AiResponseError ? ` (reason: ${error.reason})` : '';
  console.log(`  REJECTED${detail}: ${error.message}`);
  console.log('\n  In the app this is a 502 with draft_unchanged: true, and the editor unlocks.');
  process.exit(1);
}

console.log(`  committed      : yes`);
console.log(`  warnings       : ${result.warnings.length === 0 ? 'none fired' : ''}`);
for (const warning of result.warnings) console.log(`    - ${warning}`);
console.log(
  `  stripped       : ${
    Object.keys(result.stripped).length === 0 ? 'nothing — the response stayed inside the dialect' : JSON.stringify(result.stripped)
  }`,
);
console.log(`  fences stripped: ${raw.trim().startsWith('```') ? 'YES — the model ignored §2.2' : 'no'}`);
console.log(`  canonical form : ${result.draft.length} chars (input was ${DRAFT.length})`);
console.log(`\n  the draft that would have been committed:`);
for (const line of result.draft.split('\n')) console.log(`    | ${line}`);

rule('');
console.log('live-check passed: the request shape, headers, and model ID are real.\n');
