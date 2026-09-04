#!/usr/bin/env node
/**
 * Headless provenance smoke test (CLAUDE.md §9 step 4).
 *
 * Drives the store directly — no HTTP, no browser, AI turns stubbed with a canned
 * response — through the exact sequence the spec names, asserting the §0.3 invariant
 * after every step. Run it after every subsequent chunk as a regression check:
 *
 *     node scripts/smoke-session.js
 *     node scripts/smoke-session.js --dir .tmp-test/smoke   # somewhere else
 *
 * It exits non-zero on the first failed assertion, and prints the whole turn list on
 * success so the provenance model can be read by eye.
 */

import { existsSync, unlinkSync } from 'node:fs';

import { DEFAULT_TOKEN } from '../src/addressing.js';
import { defaultNamespace } from '../src/namespace.js';
import { validateAiResponse } from '../src/ai-response.js';
import {
  assertLedgerInvariant,
  createDocument,
  documentPath,
  loadDocument,
  saveDocument,
} from '../src/storage.js';
import { commitHumanTurn, restoreToTurn, submitAiPrompt } from '../src/turns.js';
import { formatReport, scanRepository } from './secret-scan.js';

const SLUG = 'smoke';

// §0.5: documents live under a namespace, `documents/{token}/{slug}.json`. The
// smoke session drives the store directly, so it resolves the namespace the same
// way the server does rather than assuming a directory layout.
const argDir = process.argv.indexOf('--dir');
const DIR = argDir === -1 ? defaultNamespace().dir : process.argv[argDir + 1];

// A throw from anywhere in the session — a broken invariant, a missing turn — should
// read as a smoke-test failure, not as a stack trace with no context.
const die = (error) => {
  console.error(`\n${'─'.repeat(76)}`);
  console.error('smoke-session FAILED — the provenance model is broken.\n');
  console.error(error?.stack ?? String(error));
  console.error('─'.repeat(76));
  process.exit(1);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

// ── output helpers ──────────────────────────────────────────────────────────────
const say = (line = '') => console.log(line);
const step = (letter, description) => say(`\n(${letter}) ${description}`);
let checks = 0;

function check(condition, description) {
  checks += 1;
  if (!condition) {
    say(`      FAILED: ${description}`);
    console.error(`\nsmoke-session FAILED: ${description}`);
    process.exit(1);
  }
  say(`      ok — ${description}`);
}

/** The §0.3 invariant, re-asserted after every step as the spec requires. */
function checkInvariant(doc, after) {
  checks += 1;
  try {
    assertLedgerInvariant(doc);
  } catch (error) {
    console.error(`\nsmoke-session FAILED: §0.3 invariant broken after ${after}\n${error.message}`);
    process.exit(1);
  }
  say(`      ok — §0.3 invariant holds after ${after}`);
}

/** Persist after every step, so the on-disk file is exercised too, not just memory. */
function persist(doc) {
  return saveDocument(doc, { dir: DIR });
}

/**
 * The stub stands in for the model. No network, no API key, no streaming.
 *
 * It returns a canned §2.2 envelope THROUGH the real `validateAiResponse`, rather
 * than handing `submitAiPrompt` a bare string. The point of this script is that
 * the provenance model still holds after a chunk; a stub that skipped the response
 * contract would stop exercising the path the app actually takes the moment the
 * contract changed — which is exactly what chunk 11 changed.
 */
const cannedResponse = (text, note) => ({ draft }) => {
  const envelope = { note };
  if (text !== undefined) envelope.draft = text;
  return validateAiResponse(
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(envelope) }] },
    { draft, prompt: 'smoke' },
  );
};

// ── (0) secrets ─────────────────────────────────────────────────────────────────
// Before anything else, because this is the check whose cost of being skipped is
// unbounded. Everything below verifies that the provenance model still holds; a
// committed credential is not a thing a later check can undo.
//
// It runs here rather than only at commit time so it is exercised on every
// session-opening run, which is the difference between a scanner that works and
// a scanner nobody has run since the day it was written.
say('smoke-session — provenance model, driven directly against the store');
say(`document: ${documentPath(SLUG, DIR)}`);
step('0', 'scan staged and tracked content for key material (CLAUDE.md § Operating rules)');
const secrets = scanRepository();
// `ok`, not `findings.length`: a scan that COULD NOT RUN produces the same empty
// findings as a scan that found nothing, and reporting the first as a pass would
// be the failure this step exists to prevent.
if (!secrets.ok) {
  console.error(formatReport(secrets));
  console.error(
    secrets.findings.length > 0
      ? '\nsmoke-session FAILED: key material found. Do not commit.\n'
      : '\nsmoke-session FAILED: the secret scan could not run, so nothing is verified.\n',
  );
  process.exit(1);
}
check(
  true,
  `no key material in ${secrets.tracked.files} tracked and ${secrets.staged.files} staged file` +
    `${secrets.staged.files === 1 ? '' : 's'}` +
    `${secrets.tracked.binary ? `, ${secrets.tracked.binary} binary skipped` : ''}`,
);

// ── the session ─────────────────────────────────────────────────────────────────

// (a) create a document with slug `smoke`
step('a', 'create a document with slug "smoke"');
const path = documentPath(SLUG, DIR);
if (existsSync(path)) {
  unlinkSync(path);
  say(`      (removed the previous ${path} so this run starts clean)`);
}
let doc = createDocument({ slug: SLUG, dir: DIR });
check(doc.slug === SLUG, `slug is "${SLUG}"`);
check(doc.schema_version === 1, 'schema_version is present from turn zero');
check(doc.history.length === 0, 'a new document has no turns');
check(
  argDir !== -1 || path === `documents/${DEFAULT_TOKEN}/${SLUG}.json`,
  `the file lands inside a namespace, not loose in documents/ (§0.5): ${path}`,
);
checkInvariant(doc, 'creation');

// (b) commit a human turn: bold, a bullet, and a link
step('b', 'commit a human turn holding bold, a bullet, and a link');
const firstDraft = [
  'The **opening line** carries some weight.',
  '',
  '- A bullet that mentions [the docs](https://example.com/docs).',
  '',
].join('\n');
let turn;
({ doc, turn } = commitHumanTurn(doc, firstDraft));
doc = persist(doc);
check(turn?.turn_id === 1 && turn.author === 'human', 'turn 1 is a human turn');
check(/\*\*opening line\*\*/.test(turn.snapshot), 'the snapshot holds the bold text');
check(/^- A bullet/m.test(turn.snapshot), 'the snapshot holds the bullet');
check(/\[the docs\]\(https:\/\/example\.com\/docs\)/.test(turn.snapshot), 'the snapshot holds the link');
checkInvariant(doc, 'the first human turn');

// (c) a stubbed AI turn with a known prompt string
step('c', 'commit a stubbed AI turn with a known prompt string');
const KNOWN_PROMPT = 'Make the opening line calmer, and leave the bullet alone.';
const aiDraftOne = [
  'The **opening line** settles quietly.',
  '',
  '- A bullet that mentions [the docs](https://example.com/docs).',
  '',
].join('\n');

let submission = await submitAiPrompt(doc, {
  pendingDraft: doc.draft, // nothing typed since the checkpoint
  prompt: KNOWN_PROMPT,
  callModel: cannedResponse(aiDraftOne, 'Calmer, and the bullet is untouched.'),
});
doc = persist(submission.doc);
check(submission.humanTurn === null, 'no empty human turn, since nothing was typed since turn 1');
check(submission.aiTurn.turn_id === 2 && submission.aiTurn.author === 'ai', 'turn 2 is an AI turn');
check(submission.aiTurn.prompt === KNOWN_PROMPT, 'the AI turn stores the exact prompt string');
check(submission.aiTurn.note === 'Calmer, and the bullet is untouched.', '§0.7: the AI turn records the model\'s speech');
checkInvariant(doc, 'the AI turn');

// (d) another human turn: a hand edit on top of the AI output
step('d', 'commit a human turn hand-editing the AI output');
const handEdited = doc.draft.replace('settles quietly', 'settles, quietly, into place');
({ doc, turn } = commitHumanTurn(doc, handEdited));
doc = persist(doc);
check(turn?.turn_id === 3 && turn.author === 'human', 'turn 3 is a human turn');
check(/settles, quietly, into place/.test(turn.snapshot), 'the snapshot holds the hand edit');
check(!('prompt' in turn), 'a human turn carries no prompt');
checkInvariant(doc, 'the hand edit');

// (e) restore to turn 2
step('e', 'restore to turn 2');
const historyBefore = structuredClone(doc.history);
({ doc, turn } = restoreToTurn(doc, 2));
doc = persist(doc);
check(turn?.turn_id === 4 && turn.author === 'human', 'restore appended turn 4 as a human turn');
check(doc.history.length === historyBefore.length + 1, 'restore APPENDED a turn, it did not truncate history');
check(
  JSON.stringify(doc.history.slice(0, historyBefore.length)) === JSON.stringify(historyBefore),
  'the turns before the restore are byte-identical — history was not rewritten',
);
check(doc.draft === doc.history[1].snapshot, "the working draft is now turn 2's snapshot");
check(/settles quietly/.test(doc.draft) && !/into place/.test(doc.draft), 'the hand edit is gone from the draft');
check(/into place/.test(doc.history[2].snapshot), 'the hand edit still exists in turn 3, unchanged');
checkInvariant(doc, 'the restore');

// (f) another stubbed AI turn
step('f', 'commit another stubbed AI turn');
const SECOND_PROMPT = 'Now make the bullet more specific.';
const aiDraftTwo = [
  'The **opening line** settles quietly.',
  '',
  '- A bullet that links [the deployment docs](https://example.com/docs).',
  '',
].join('\n');

submission = await submitAiPrompt(doc, {
  pendingDraft: doc.draft,
  prompt: SECOND_PROMPT,
  callModel: cannedResponse(aiDraftTwo, 'Named the docs the bullet actually points at.'),
});
doc = persist(submission.doc);
check(submission.aiTurn.turn_id === 5 && submission.aiTurn.author === 'ai', 'turn 5 is an AI turn');
check(submission.aiTurn.prompt === SECOND_PROMPT, 'the second AI turn stores its own exact prompt');
checkInvariant(doc, 'the second AI turn');

// (g) a speech-only turn — §0.9's degenerate case
step('g', 'commit a speech-only AI turn: a note, and no change to the draft');
const QUESTION = 'Weigh in on the change I just made — do not touch the draft.';
const draftBefore = doc.draft;
const historyBeforeSpeech = doc.history.length;

submission = await submitAiPrompt(doc, {
  pendingDraft: doc.draft,
  prompt: QUESTION,
  callModel: cannedResponse(undefined, 'The bullet now names the thing it links to. Leave it.'),
});
doc = persist(submission.doc);

const speechTurn = submission.aiTurn;
check(speechTurn.turn_id === 6 && speechTurn.author === 'ai', 'turn 6 is an AI turn');
check(doc.history.length === historyBeforeSpeech + 1, '§3: a speech-only turn is NOT an empty turn');
check(speechTurn.prompt === QUESTION, 'it stores the exact prompt string');
check(/Leave it\./.test(speechTurn.note), '§0.7: and the model\'s speech');
check(speechTurn.snapshot === draftBefore, '§0.9: the snapshot carries the prior text unchanged');
check(doc.draft === draftBefore, 'and the working draft did not move');
checkInvariant(doc, 'the speech-only turn');

// ── the ledger ──────────────────────────────────────────────────────────────────
const reloaded = loadDocument(SLUG, { dir: DIR });
check(JSON.stringify(reloaded.history) === JSON.stringify(doc.history), 'the reloaded file matches the session');

say('\n────────────────────────────────────────────────────────────────────────────');
say('TURN LIST');
say('────────────────────────────────────────────────────────────────────────────');
for (const entry of reloaded.history) {
  const first80 = entry.snapshot.slice(0, 80).replace(/\n/g, '⏎');
  say('');
  say(`  turn ${entry.turn_id}  [${entry.author.toUpperCase().padEnd(5)}]  ${entry.timestamp}`);
  say(`    prompt:   ${entry.author === 'ai' ? JSON.stringify(entry.prompt) : '—'}`);
  say(`    snapshot: ${first80}${entry.snapshot.length > 80 ? '…' : ''}`);
  if (entry.note !== undefined) say(`    note:     ${JSON.stringify(entry.note)}`);
  if (entry.warnings?.length) say(`    warnings: ${entry.warnings.join('; ')}`);
}

say('\n────────────────────────────────────────────────────────────────────────────');
say(`${reloaded.history.length} turns, ${checks} assertions passed.`);
say('Human turns hold only hand edits; AI turns hold only model changes, with the');
say('prompt that caused them. Turn 3 survives the restore at turn 4 — history is');
say('append-only, so nothing the human wrote was destroyed by going back. Turn 6');
say('changed nothing and is kept anyway: the note and the unchanged snapshot are a');
say('positive assertion that the model was asked something and touched no text.');
say('────────────────────────────────────────────────────────────────────────────');
