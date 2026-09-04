/**
 * Standing rules (CLAUDE.md §10, locked behavior §0.11).
 *
 * THE STORE IS RESOLVED IN EXACTLY ONE FUNCTION — `resolveRules` below. §0.11 is
 * explicit about why: a later per-user default layer, where one writer's standing
 * "no em-dashes" applies to every new document, must be a change to that function
 * and nothing else. Every reader in the codebase goes through it. No handler and
 * no payload builder reaches into `doc.rules` directly.
 *
 * That is a SEAM, not a feature. There is no nesting, no precedence, and no
 * inheritance in the MVP, and §7 lists multi-level rules as an explicit non-goal.
 * `resolveRules` today returns one document's rules and is one line long; its
 * value is entirely in being the only door.
 *
 * TWO OTHER THINGS ARE LOAD-BEARING:
 *
 * `source` is a FIELD, never a second collection (§10). Step 16 adds a writer and
 * a proposal state to the same store rather than a parallel one, so a
 * model-proposed rule is an addition and not a migration.
 *
 * Every rule carries a SCOPE (§0.11), defaulting to the artifact class the
 * correction was about. A correction about caption wording becomes a rule about
 * captions, not a rule about the model's behaviour in general — over-generalized
 * rules suppress the case where the model refusing the human's frame is the right
 * answer.
 *
 * And, per §0.10: nothing here commits a turn. Editing the list is a document
 * mutation and leaves `history` and `draft` untouched.
 */

import { randomBytes } from 'node:crypto';

/** Where a rule came from. A field, not a collection (§10). */
export const HUMAN = 'human';
export const PROPOSED = 'proposed';

/**
 * The default scope: everything in this document.
 *
 * §0.11 wants scope to default to "the artifact class the correction was about",
 * which for a rule the human types herself is the document she typed it in —
 * there is no correction to infer a narrower class from. Step 16's proposals are
 * where a narrower default becomes derivable.
 */
export const DEFAULT_SCOPE = 'this document';

export const MAX_RULE_CHARS = 400;

/** Thrown when a rule cannot be stored. The document is left alone. */
export class RuleError extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = 'RuleError';
    this.reason = reason;
  }
}

export const generateRuleId = () => randomBytes(8).toString('hex');

/**
 * THE ONE FUNCTION (§0.11). The only place rules are read from.
 *
 * Today: this document's rules, in order. Tomorrow, when per-user defaults
 * arrive, the merge happens HERE and every caller is unchanged — which is the
 * entire reason it exists as a function rather than as a property access.
 *
 * @param {object} doc
 * @param {{sources?: string[]}} [options] filter by origin; step 16 uses it
 * @returns {object[]}
 */
export function resolveRules(doc, { sources } = {}) {
  const rules = doc?.rules ?? [];
  return sources ? rules.filter((rule) => sources.includes(rule.source)) : [...rules];
}

/**
 * Add a rule the human wrote (§10, step 12's half).
 *
 * `source` is fixed to `human` here on purpose: this is the human-written writer,
 * and step 16 adds a separate entry point for proposals rather than passing a
 * flag through this one. A caller that could set `source` freely would let a
 * proposal masquerade as something she said.
 */
export function addRule(doc, { text, scope, now = new Date() }) {
  const body = String(text ?? '').trim();
  if (body === '') throw new RuleError('a rule needs some words in it', { reason: 'empty' });
  if (body.length > MAX_RULE_CHARS) {
    throw new RuleError(
      `that rule is ${body.length} characters; keep it under ${MAX_RULE_CHARS}. A rule ` +
        'the model has to parse is a rule it will apply unevenly.',
      { reason: 'too_long' },
    );
  }

  const rule = {
    id: generateRuleId(),
    text: body,
    scope: String(scope ?? '').trim() || DEFAULT_SCOPE,
    source: HUMAN,
    created_at: now.toISOString(),
  };
  return { doc: { ...doc, rules: [...(doc.rules ?? []), rule] }, rule };
}

/** Edit a rule in place. Its id, source and creation time survive. */
export function updateRule(doc, id, { text, scope }) {
  const rules = doc.rules ?? [];
  if (!rules.some((rule) => rule.id === id)) {
    throw new RuleError(`no rule ${JSON.stringify(id)} on this document`, { reason: 'not_found' });
  }

  const body = text === undefined ? undefined : String(text).trim();
  if (body !== undefined && body === '') {
    throw new RuleError('a rule needs some words in it', { reason: 'empty' });
  }
  if (body !== undefined && body.length > MAX_RULE_CHARS) {
    throw new RuleError(`that rule is ${body.length} characters; keep it under ${MAX_RULE_CHARS}.`, {
      reason: 'too_long',
    });
  }

  return {
    ...doc,
    rules: rules.map((rule) =>
      rule.id === id
        ? {
            ...rule,
            ...(body === undefined ? {} : { text: body }),
            ...(scope === undefined ? {} : { scope: String(scope).trim() || DEFAULT_SCOPE }),
          }
        : rule,
    ),
  };
}

/** §10: rules are individually revocable. */
export function removeRule(doc, id) {
  const before = doc.rules ?? [];
  const rules = before.filter((rule) => rule.id !== id);
  if (rules.length === before.length) {
    throw new RuleError(`no rule ${JSON.stringify(id)} on this document`, { reason: 'not_found' });
  }
  return { ...doc, rules };
}

/**
 * The rules as the model sees them (§2.1 item 5: "with their scopes").
 *
 * Reads through `resolveRules`, like everything else. Returns null when there are
 * none, so the payload builder omits the section rather than sending an empty
 * heading — an empty "Standing rules:" reads as "she has considered this and has
 * none", which is a different claim from "she has not set any".
 */
export function formatRulesForPrompt(doc) {
  const rules = resolveRules(doc);
  if (rules.length === 0) return null;

  return rules
    .map((rule) => `- ${rule.text}${rule.scope && rule.scope !== DEFAULT_SCOPE ? `  (scope: ${rule.scope})` : ''}`)
    .join('\n');
}
