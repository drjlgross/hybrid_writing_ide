/**
 * Response safety (CLAUDE.md §2.3) — "this is the one bug that loses work".
 *
 * Every guard here runs between the API call and the commit. A response that
 * fails a hard guard must not become the draft: the previous snapshot is the only
 * remaining copy of the work, and committing a truncated response over it loses
 * the rest.
 */

import { canonicalize } from './canonicalize.js';
import { stripOutOfDialect } from './dialect-guard.js';

/** Thrown when a response must not be committed. The draft stays where it was. */
export class AiResponseError extends Error {
  constructor(message, { reason, stopReason } = {}) {
    super(message);
    this.name = 'AiResponseError';
    this.reason = reason;
    this.stopReason = stopReason;
  }
}

/** The draft is shorter than this fraction of the input → warn (§2.3). */
export const SHRINK_WARNING_RATIO = 0.6; // "more than 40% shorter"

/**
 * max_tokens from the draft size, never a hardcoded small constant (§2.3).
 *
 * The model returns the COMPLETE revised draft, so the output is at least the
 * size of the input. Sizing: ~3 chars per token is conservative for this
 * tokenizer, times a headroom factor for a draft that grows, plus a floor for
 * thinking, which shares the same budget.
 *
 * @param {string} draft
 */
export function maxTokensForDraft(draft) {
  const estimatedDraftTokens = Math.ceil(draft.length / 3);
  const withHeadroom = Math.ceil(estimatedDraftTokens * 1.6) + 2048;
  return Math.min(Math.max(withHeadroom, 4096), 32000);
}

/**
 * Did the instruction ask for cutting? Keyword heuristic, deliberately generous:
 * a false positive suppresses a warning, a false negative adds a warning to a
 * turn that deserved none. Both are recoverable; neither loses text.
 */
export function asksForCutting(prompt) {
  return /\b(cut|cuts|cutting|shorten|shorter|trim|trims|trimming|condense|tighten|tightens|shrink|abbreviate|brief|briefer|concise|compress|delete|remove|drop|reduce|halve|prune|summari[sz]e|tl;?dr)\b/i.test(
    prompt ?? '',
  );
}

/** Strip fences the model added despite §2.2 saying not to. Defensive (§2.3). */
export function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(trimmed);
  return fenced ? fenced[2] : text;
}

/**
 * Pull the text out of an Anthropic Messages API response body.
 * Concatenates every text block; ignores thinking and any other block type.
 */
export function extractText(body) {
  if (typeof body?.content === 'string') return body.content;
  if (!Array.isArray(body?.content)) return '';
  return body.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * Run every §2.3 guard over a raw API response.
 *
 * Hard guards throw — the caller must not commit and must unlock the editor:
 *   - stop_reason is anything but end_turn (truncation, refusal, a tool loop)
 *   - the response is empty or whitespace-only
 * Soft guards return warnings on the turn, which is committed:
 *   - the draft shrank by more than 40% without being asked to
 *   - constructs outside the dialect were stripped
 *
 * @param {object} body the API response body
 * @param {{draft: string, prompt: string}} context the draft that was sent
 * @returns {{draft: string, warnings: string[], stripped: Record<string, number>}}
 */
export function validateAiResponse(body, { draft, prompt }) {
  // 1. stop_reason FIRST. A truncated response can look perfectly well-formed,
  //    and committing it would leave the full text only in the prior snapshot.
  const stopReason = body?.stop_reason;
  if (stopReason !== 'end_turn') {
    throw new AiResponseError(
      `the model stopped with stop_reason ${JSON.stringify(stopReason)} rather than ` +
        '"end_turn", so the response may be incomplete. The draft is unchanged and ' +
        'nothing was committed.' +
        (stopReason === 'max_tokens'
          ? ' The response hit max_tokens — the revised draft was cut off partway.'
          : '') +
        (stopReason === 'refusal' ? ' The model declined the request.' : ''),
      { reason: 'stop_reason', stopReason },
    );
  }

  // 2. Strip fences before anything parses the text as Markdown, then reject an
  //    empty or whitespace-only response. One check rather than two: an empty
  //    body and an empty fence both arrive here as an empty string, and a
  //    pre-fence check for the same thing is unreachable.
  const raw = extractText(body);
  const unfenced = stripCodeFences(raw);
  if (unfenced.trim() === '') {
    throw new AiResponseError(
      raw.trim() === ''
        ? 'the model returned an empty response. The draft is unchanged.'
        : 'the model returned an empty code fence and nothing else. The draft is unchanged.',
      { reason: 'empty', stopReason },
    );
  }

  // 4. Out-of-dialect constructs: strip, keep the text, count what went.
  const dialect = stripOutOfDialect(unfenced);
  const revised = canonicalize(dialect.markdown);

  if (revised.trim() === '') {
    throw new AiResponseError(
      'the response held no text once out-of-dialect constructs were stripped. ' +
        'The draft is unchanged.',
      { reason: 'empty', stopReason },
    );
  }

  const warnings = [];
  if (dialect.warning) warnings.push(dialect.warning);

  // 5. Soft shrink guard. stop_reason catches hard truncation; a model quietly
  //    dropping a paragraph still returns end_turn.
  const before = canonicalize(draft).length;
  const after = revised.length;
  if (before > 0 && after < before * SHRINK_WARNING_RATIO && !asksForCutting(prompt)) {
    const percent = Math.round((1 - after / before) * 100);
    warnings.push(
      `the draft is ${percent}% shorter than before this turn, and the instruction ` +
        'did not ask for cutting',
    );
  }

  return { draft: revised, warnings, stripped: dialect.stripped };
}
