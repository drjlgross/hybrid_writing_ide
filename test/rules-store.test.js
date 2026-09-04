/**
 * Standing rules (CLAUDE.md §10, §0.11).
 *
 * Three things are worth failing over: the store is reached through ONE function,
 * `source` is a field rather than a second collection, and editing rules never
 * commits a turn.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SCOPE,
  HUMAN,
  MAX_RULE_CHARS,
  PROPOSED,
  RuleError,
  addRule,
  formatRulesForPrompt,
  removeRule,
  resolveRules,
  updateRule,
} from '../src/rules-store.js';

const seeded = () => ({
  schema_version: 1,
  slug: 'draft',
  draft: 'The draft.\n',
  history: [{ turn_id: 1, author: 'human', snapshot: 'The draft.\n' }],
});

test('§10 a rule carries text, scope, and a SOURCE field', () => {
  const { doc, rule } = addRule(seeded(), { text: 'no em-dashes' });

  assert.equal(rule.text, 'no em-dashes');
  assert.equal(rule.source, HUMAN, 'written by her, not proposed');
  assert.equal(rule.scope, DEFAULT_SCOPE, '§0.11: every rule carries a scope');
  assert.match(rule.id, /^[0-9a-f]{16}$/);
  assert.deepEqual(resolveRules(doc).map((r) => r.text), ['no em-dashes']);

  // §0.11: a scope narrower than the document is what stops an over-generalized
  // rule suppressing the case where refusing her frame is the right answer.
  const scoped = addRule(doc, { text: 'sentence case', scope: 'captions' });
  assert.equal(scoped.rule.scope, 'captions');
});

test('§10 source is a FIELD, not a second collection — step 16 is an addition', () => {
  // The whole point of the constraint: a model-proposed rule must be able to join
  // this store rather than needing a parallel one, or step 16 becomes a migration.
  let doc = seeded();
  ({ doc } = addRule(doc, { text: 'no em-dashes' }));

  // Simulate what step 16 will write. Nothing here needs to change to hold it.
  doc = { ...doc, rules: [...doc.rules, { id: 'p1', text: 'open on the finding', scope: 'openings', source: PROPOSED, created_at: 'x' }] };

  assert.equal(resolveRules(doc).length, 2, 'one store, both sources');
  assert.deepEqual(resolveRules(doc, { sources: [HUMAN] }).map((r) => r.text), ['no em-dashes']);
  assert.deepEqual(resolveRules(doc, { sources: [PROPOSED] }).map((r) => r.text), ['open on the finding']);

  const source = readFileSync(fileURLToPath(new URL('../src/rules-store.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /proposedRules|doc\.proposals/, 'no second collection anywhere');
});

test('§0.11 the store is reached through exactly one function', () => {
  // The seam. A later per-user default layer must be a change to `resolveRules`
  // and nothing else, which only holds if nothing else reads `doc.rules`.
  const readers = ['src/ai-edit.js', 'src/server.js', 'src/anthropic-client.js'];
  for (const file of readers) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');
    assert.doesNotMatch(source, /\.rules\b(?!-)/, `${file} must go through resolveRules, not doc.rules`);
  }

  // And the payload builder reads through it too.
  const store = readFileSync(fileURLToPath(new URL('../src/rules-store.js', import.meta.url)), 'utf8');
  const inFormat = store.slice(store.indexOf('export function formatRulesForPrompt'));
  assert.match(inFormat, /resolveRules\(doc\)/, 'even the formatter uses the one function');
});

test('§10 rules are individually revocable and editable in place', () => {
  let doc = seeded();
  const first = addRule(doc, { text: 'no em-dashes' });
  const second = addRule(first.doc, { text: 'open on the biology, not the pipeline' });
  doc = second.doc;

  doc = updateRule(doc, first.rule.id, { text: 'no em-dashes anywhere' });
  assert.equal(resolveRules(doc)[0].text, 'no em-dashes anywhere');
  assert.equal(resolveRules(doc)[0].id, first.rule.id, 'the id survives an edit');
  assert.equal(resolveRules(doc)[0].source, HUMAN, 'and so does the source');

  doc = removeRule(doc, first.rule.id);
  assert.deepEqual(resolveRules(doc).map((r) => r.id), [second.rule.id]);

  assert.throws(() => removeRule(doc, 'nope'), RuleError);
  assert.throws(() => updateRule(doc, 'nope', { text: 'x' }), RuleError);
});

test('§0.10 editing rules never commits a turn', () => {
  const before = seeded();
  const { doc: added, rule } = addRule(before, { text: 'no em-dashes' });
  const edited = updateRule(added, rule.id, { text: 'none at all' });
  const removed = removeRule(edited, rule.id);

  for (const [label, doc] of [['add', added], ['update', edited], ['remove', removed]]) {
    assert.equal(doc.draft, before.draft, `${label} left the draft alone`);
    assert.deepEqual(doc.history, before.history, `${label} left the ledger alone`);
  }
  assert.deepEqual(before.rules, undefined, 'and the input was not mutated');
});

test('an empty or enormous rule is refused', () => {
  const doc = seeded();
  for (const text of ['', '   ', '\n']) {
    assert.throws(() => addRule(doc, { text }), RuleError, JSON.stringify(text));
  }
  assert.throws(() => addRule(doc, { text: 'x'.repeat(MAX_RULE_CHARS + 1) }), RuleError);
  assert.deepEqual(doc.rules, undefined);
});

test('§2.1 item 5: the payload carries rules WITH their scopes', () => {
  assert.equal(formatRulesForPrompt(seeded()), null, 'no rules, no section');

  let doc = seeded();
  ({ doc } = addRule(doc, { text: 'no em-dashes' }));
  ({ doc } = addRule(doc, { text: 'sentence case', scope: 'captions' }));

  const formatted = formatRulesForPrompt(doc);
  assert.match(formatted, /- no em-dashes/);
  assert.match(formatted, /- sentence case {2}\(scope: captions\)/, 'a narrower scope is named');
  assert.doesNotMatch(formatted, /scope: this document/, 'the default scope is not restated as noise');
});
