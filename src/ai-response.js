/**
 * Response safety (CLAUDE.md §2.3) — "this is the one bug that loses work".
 *
 * Every guard here runs between the API call and the commit. A response that
 * fails a hard guard must not become the draft: the previous snapshot is the only
 * remaining copy of the work, and committing a truncated response over it loses
 * the rest.
 *
 * The response is now the §2.2 JSON envelope, not raw Markdown:
 *
 *     { "note": "...", "segments": [...], "draft": "..." }
 *
 * `note` is the model's speech (§0.7) and is recorded on the turn. `draft` is the
 * INTERIM field: §2.2 replaces it with `candidates` in step 13, and the guards are
 * factored so that is a field swap. `validateReplacementMarkdown` is the piece
 * §2.3's extension says must run over "each candidate's `replacement`, not only
 * over a whole draft"; today it has one caller holding a whole draft.
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
 * How long the model's speech may be before it is worth remarking on (§2.3:
 * `note` "must still be checked for length"). A soft guard — see `validateNote`.
 */
export const NOTE_MAX_CHARS = 6000;

/** §2.2: the four things a prompt segment can be read as. */
export const SEGMENT_KINDS = new Set(['edit', 'question', 'context', 'reframe']);

/**
 * The §2.2 envelope as a JSON Schema, for the API's structured-output constraint.
 *
 * THIS IS THE SAME CONTRACT `validateAiResponse` ENFORCES, stated on the request
 * side. It lives here, beside the parser, and derives `kind`'s enum from
 * `SEGMENT_KINDS` above, so the shape the model is constrained to emit cannot
 * drift from the shape this file accepts. `src/anthropic-client.js` imports it;
 * it does not restate it.
 *
 * Three details are load-bearing:
 *
 * - `additionalProperties: false` is REQUIRED on every object by the structured
 *   output implementation, and it is also what stops the model adding fields to
 *   a turn record.
 * - `draft` is `anyOf [string, null]` and REQUIRED, not optional. §0.7 keeps a
 *   revision optional, and the parser still treats an absent `draft` as the §0.9
 *   speech-only turn — but "emit null" is a decision the model makes explicitly,
 *   where "omit the key" is one it can make by forgetting. Both spellings parse
 *   identically; this asks for the one that cannot be an accident.
 * - No `minLength`/`maxLength`/numeric bounds anywhere: the schema dialect does
 *   not support them, and `NOTE_MAX_CHARS` is a soft guard on the way back in.
 *
 * When step 13 swaps `draft` for `candidates`, this object and the parser change
 * together, in one file. That is the point of it being here.
 */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    note: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          took: { type: 'string' },
          kind: { type: 'string', enum: [...SEGMENT_KINDS] },
        },
        required: ['id', 'took', 'kind'],
        additionalProperties: false,
      },
    },
    draft: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['note', 'segments', 'draft'],
  additionalProperties: false,
};

/**
 * max_tokens from the draft size, never a hardcoded small constant (§2.3).
 *
 * The model returns the COMPLETE revised draft, so the output is at least the
 * size of the input. Sizing: ~3 chars per token is conservative for this
 * tokenizer, times a headroom factor for a draft that grows, plus a flat term for
 * thinking and segments, which share the same budget.
 *
 * The §2.2 envelope adds to it: the draft now arrives JSON-escaped, alongside the
 * note and the segments. A note that runs to `NOTE_MAX_CHARS` is budgeted for
 * explicitly rather than left to the headroom factor, because a long note on a
 * short draft would otherwise be exactly the case that hits max_tokens — and a
 * response cut off mid-JSON does not parse at all.
 *
 * RAISED 2026-09-08 after a live max_tokens failure on memo-length work: an
 * analysis-heavy turn on a ~10K-character draft exhausted the budget, because
 * thinking shares it and the flat term for thinking was 2048. The formula's shape
 * was right and its constants were lean — headroom 1.6 → 2.0, the flat term
 * 2048 → 6144, the floor 4096 → 16000. See reports/mini-token-cap.md.
 *
 * THE CEILING STAYS 32000, and that is a decision rather than an oversight. With a
 * non-streaming client (F28) and a finite request timeout, an unbounded single
 * generation is the wrong trade: it converts a truncated response — which §2.3
 * catches on `stop_reason` and refuses — into a request that hangs until it is
 * aborted, which is a worse failure with the same cause. The known limit is that a
 * draft past roughly 36,000 characters is clamped here, so its budget stops
 * covering twice the draft plus the flat terms; a very long document can still hit
 * max_tokens, and that is a limit rather than a bug to be fixed by removing the
 * ceiling.
 *
 * @param {string} draft
 */
export function maxTokensForDraft(draft) {
  const estimatedDraftTokens = Math.ceil(draft.length / 3);
  const noteBudget = Math.ceil(NOTE_MAX_CHARS / 3);
  const withHeadroom = Math.ceil(estimatedDraftTokens * 2.0) + noteBudget + 6144;
  return Math.min(Math.max(withHeadroom, 16000), 32000);
}

/**
 * Did the instruction plausibly ask for compression? Keyword heuristic.
 *
 * It no longer SUPPRESSES the shrink warning — it only softens its wording
 * (chunk 7 item 6). The old behaviour let one keyword hide the whole guard, and
 * the guard exists for the case §2.3 names: a model that quietly drops a
 * paragraph and still returns `end_turn`. "Tighten the second paragraph" is
 * exactly the instruction under which that happens, and it is also exactly the
 * instruction this heuristic matches — so suppressing on a match turned the
 * guard off in the case it was written for.
 *
 * The heuristic is still deliberately generous, but the cost of a false positive
 * is now a sentence that reads slightly wrong rather than a missing warning.
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
 * The dialect guards, run over ONE piece of proposed Markdown (§2.3 extended).
 *
 * Factored out as its own function because §2.3's extension says the guards apply
 * to "each candidate's `replacement`, not only to a whole draft". Today there is
 * one caller and it passes the whole draft; in step 13 there is one caller per
 * candidate and this function does not change. That is what makes the §2.2
 * interim contract a field swap rather than a rewrite.
 *
 * What it does NOT do: reject empty text, or measure shrink. Both are properties
 * of the WHOLE DRAFT — an empty candidate replacement is a deletion, which is
 * legitimate — so both stay with the caller that knows it is looking at a draft.
 *
 * @param {string} markdown
 * @returns {{markdown: string, warnings: string[], stripped: Record<string, number>}}
 */
export function validateReplacementMarkdown(markdown) {
  const dialect = stripOutOfDialect(stripCodeFences(markdown));
  const warnings = [];
  if (dialect.warning) warnings.push(dialect.warning);
  return { markdown: canonicalize(dialect.markdown), warnings, stripped: dialect.stripped };
}

/**
 * The soft shrink guard (§2.3). stop_reason catches hard truncation; a model
 * quietly dropping a paragraph still returns `end_turn`.
 *
 * @returns {string|null}
 */
export function shrinkWarning(before, after, prompt) {
  if (before <= 0 || after >= before * SHRINK_WARNING_RATIO) return null;
  const percent = Math.round((1 - after / before) * 100);
  return asksForCutting(prompt)
    ? `the draft is ${percent}% shorter than before this turn. The instruction did ` +
        'ask for cutting, so this may be exactly right — check that nothing you ' +
        'meant to keep went with it.'
    : `the draft is ${percent}% shorter than before this turn, and the instruction ` +
        'did not ask for cutting';
}

/**
 * Parse the §2.2 envelope. Malformed JSON is a FAILED TURN (§2.3): surface the
 * error, unlock the editor, leave the draft alone. No partial recovery — a
 * half-parsed response is exactly how the wrong sentence gets edited.
 *
 * @param {string} text the response text, fences already stripped
 * @returns {object}
 */
export function parseResponseEnvelope(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new AiResponseError(
      'the model returned something that is not the JSON object the response contract ' +
        `asks for (${error.message}). The draft is unchanged and nothing was committed.`,
      { reason: 'malformed' },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiResponseError(
      `the model returned JSON, but a ${Array.isArray(parsed) ? 'array' : typeof parsed} rather ` +
        'than the object the response contract asks for. The draft is unchanged.',
      { reason: 'malformed' },
    );
  }

  return parsed;
}

/**
 * The model's speech (§0.7, §2.2 `note`).
 *
 * §2.3: "`note` is prose for a human, not draft text. It is not canonicalized into
 * the draft and never reaches TipTap. It must still be checked for length and for
 * the fence artifacts the parser cares about." Both of those and nothing more —
 * canonicalizing speech would be applying a draft rule to something that is not
 * the draft, and stripping out-of-dialect constructs from prose addressed to a
 * human would silently edit what the model said.
 *
 * Length is a SOFT guard. The ledger holds the speech (§9 S13) and truncating it
 * would destroy the record; an over-long note is an anomaly worth naming, not one
 * worth deleting. What it is really watching for is the model pasting the draft
 * back into the panel, which §12 forbids outright.
 *
 * @returns {{note: string, warnings: string[]}}
 */
export function validateNote(raw) {
  if (typeof raw !== 'string') {
    throw new AiResponseError(
      `the response carried no \`note\` (§0.7: every AI turn returns a note); got ${
        raw === undefined ? 'nothing' : typeof raw
      }. The draft is unchanged.`,
      { reason: 'contract' },
    );
  }

  const note = stripCodeFences(raw).trim();
  const warnings = [];
  if (note.length > NOTE_MAX_CHARS) {
    warnings.push(
      `the model's note is ${note.length} characters, over the ${NOTE_MAX_CHARS} this panel ` +
        'expects. It is kept in full — check it is speech and not the draft pasted back.',
    );
  }
  return { note, warnings };
}

/**
 * The model's decomposition of the prompt (§2.2 `segments`).
 *
 * Segments are metadata about how the prompt was read; they are not the draft and
 * not the speech. So a malformed one is DROPPED with a warning rather than failing
 * the turn — losing a good revision over a misspelled `kind` would be the §2.3
 * failure class running backwards. Malformed JSON is still a failed turn; this is
 * well-formed JSON carrying a bad value, which is a different thing.
 *
 * Not rendered anywhere yet: §2.2's segments are surfaced in step 15, and §9 marks
 * that provisional. They are stored on the turn from now so step 15 has a record
 * to surface rather than a schema change to make.
 *
 * @returns {{segments: object[], warnings: string[]}}
 */
export function validateSegments(raw) {
  const warnings = [];
  if (raw === undefined || raw === null) return { segments: [], warnings };

  if (!Array.isArray(raw)) {
    return {
      segments: [],
      warnings: [`the response's \`segments\` was ${typeof raw} rather than a list, so it was dropped`],
    };
  }

  const segments = [];
  let dropped = 0;
  for (const entry of raw) {
    const ok =
      entry !== null &&
      typeof entry === 'object' &&
      typeof entry.id === 'string' &&
      typeof entry.took === 'string' &&
      SEGMENT_KINDS.has(entry.kind);
    if (!ok) {
      dropped += 1;
      continue;
    }
    segments.push({ id: entry.id, took: entry.took, kind: entry.kind });
  }

  if (dropped > 0) {
    warnings.push(
      `${dropped} of ${raw.length} segment${raw.length === 1 ? '' : 's'} did not match the ` +
        `response contract (id, took, kind in ${[...SEGMENT_KINDS].join('/')}) and ${
          dropped === 1 ? 'was' : 'were'
        } dropped`,
    );
  }
  return { segments, warnings };
}

/**
 * Run every §2.3 guard over a raw API response.
 *
 * Hard guards throw — the caller must not commit and must unlock the editor:
 *   - stop_reason is anything but end_turn (truncation, refusal, a tool loop)
 *   - the response is empty or whitespace-only
 *   - the response is not the JSON object §2.2 describes
 *   - it carries no `note` (§0.7)
 *   - it carries neither speech nor a revision, which is not a turn at all
 * Soft guards return warnings on the turn, which is committed:
 *   - the draft shrank by more than 40% without being asked to
 *   - constructs outside the dialect were stripped
 *   - the note is over length; a segment was malformed
 *
 * @param {object} body the API response body
 * @param {{draft: string, prompt: string}} context the draft that was sent
 * @returns {{note: string, segments: object[], draft: string, changed: boolean,
 *   warnings: string[], stripped: Record<string, number>}}
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
          ? ' The response hit max_tokens — the reply was cut off partway.'
          : '') +
        (stopReason === 'refusal' ? ' The model declined the request.' : ''),
      { reason: 'stop_reason', stopReason },
    );
  }

  // 2. Strip fences before anything parses the text, then reject an empty or
  //    whitespace-only response. One check rather than two: an empty body and an
  //    empty fence both arrive here as an empty string.
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

  // 3. The §2.2 envelope. Malformed JSON is a failed turn, full stop.
  const envelope = parseResponseEnvelope(unfenced);

  // 4. Speech (§0.7) and the decomposition (§2.2).
  const speech = validateNote(envelope.note);
  const decomposition = validateSegments(envelope.segments);
  const warnings = [...speech.warnings, ...decomposition.warnings];

  const previous = canonicalize(draft);

  // 5. The revision. §2.2 (amended, chunk 11a): `draft` is REQUIRED and NULLABLE,
  //    and `null` is how the model says it is proposing no revision — the §0.9
  //    speech-only turn, whose snapshot carries the prior text unchanged as a
  //    positive assertion that the model touched nothing.
  //
  //    Required-but-nullable, rather than optional, keeps the anti-forgetting
  //    property: the model must DECLARE no-edit, and cannot arrive at one by
  //    omitting a key. `RESPONSE_SCHEMA` enforces the presence on the request
  //    side, so an absent `draft` should not reach here at all.
  //
  //    An absent `draft` is nonetheless accepted, and read the same way as null.
  //    That is deliberate leniency, not a second spelling of the contract: the
  //    schema is what asks for the field, and a parser that ALSO refused the
  //    absent case would turn a request-side regression into a lost turn — with
  //    the draft the only casualty and the model's speech thrown away with it.
  const proposed = envelope.draft;
  if (proposed === undefined || proposed === null) {
    if (speech.note === '') {
      throw new AiResponseError(
        'the response carried neither speech nor a revision. That is not a turn — the ' +
          'draft is unchanged and nothing was committed.',
        { reason: 'empty', stopReason },
      );
    }
    return {
      note: speech.note,
      segments: decomposition.segments,
      draft: previous,
      changed: false,
      warnings,
      stripped: {},
    };
  }

  if (typeof proposed !== 'string') {
    throw new AiResponseError(
      `the response's \`draft\` was ${typeof proposed} rather than the complete revised ` +
        'Markdown the response contract asks for. The draft is unchanged.',
      { reason: 'contract', stopReason },
    );
  }

  // 6. Out-of-dialect constructs: strip, keep the text, count what went.
  const checked = validateReplacementMarkdown(proposed);
  warnings.push(...checked.warnings);

  if (checked.markdown.trim() === '') {
    throw new AiResponseError(
      'the revised draft held no text once out-of-dialect constructs were stripped. ' +
        'The draft is unchanged.',
      { reason: 'empty', stopReason },
    );
  }

  // 7. The soft shrink guard.
  const shrink = shrinkWarning(previous.length, checked.markdown.length, prompt);
  if (shrink) warnings.push(shrink);

  return {
    note: speech.note,
    segments: decomposition.segments,
    draft: checked.markdown,
    changed: checked.markdown !== previous,
    warnings,
    stripped: checked.stripped,
  };
}
