/**
 * The model call (CLAUDE.md §2, §6). The API key stays server-side (§0.6).
 *
 * Raw fetch rather than `@anthropic-ai/sdk`: §5 lists the packages this project
 * may install and the SDK is not among them, so the HTTP call is written by hand.
 * Reported as a finding — the SDK would be the better choice if approved.
 *
 * Nothing here reads the environment at import time, so the whole test suite runs
 * with no API key and no network. `createModelCaller` is only ever constructed by
 * the server at request time, and tests inject a stub in its place.
 */

import { RESPONSE_SCHEMA, maxTokensForDraft } from './ai-response.js';

export const MODEL = 'claude-sonnet-5';
export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

/**
 * How long to wait for the whole response before giving up.
 *
 * §0.6 rules out streaming, so a long draft is one long non-streaming request and
 * the only wrong answer is to wait forever: without this, a hung connection holds
 * the editor locked (§0.2) with no error and no way back except a reload. Two
 * minutes is well past a normal turn at the §2.3 token ceiling and well short of
 * "the tab is broken".
 *
 * A timeout aborts before any response exists, so it lands in the §2.4 window
 * where the draft is unchanged and the human turn stays committed.
 */
export const REQUEST_TIMEOUT_MS = 120_000;

/**
 * §6's system prompt, rewritten 2026-09-02 for §0.7 and §0.8.
 *
 * Two departures from §6's text, both named in the chunk-11 report:
 *
 * 1. THE RECEIVE-LIST IS TRIMMED to what step 11 actually sends. §6 lists context
 *    files, standing rules and the recent conversation; those are steps 12 and
 *    beyond, and telling the model it will receive things it will not is a lie
 *    that costs attention on every turn. Each one goes back in with the chunk
 *    that starts sending it.
 * 2. THE RESPONSE CONTRACT IS SPELT OUT. §6 ends "Return ONLY the JSON object
 *    described in the contract" — the contract is §2.2 and the model cannot read
 *    the spec, so it is written out here. This is §2.2's INTERIM shape: `draft`
 *    holds the complete revised Markdown, and step 13 swaps it for `candidates`.
 *
 * The prompt is now the SECOND half of contract enforcement, not the first.
 * `OUTPUT_FORMAT` below is what makes the reply parseable; these words shape what
 * the model chooses to put in the fields, and are what would still be standing if
 * the format constraint were ever turned off.
 *
 * Everything else is §6 verbatim, including the two paragraphs about speech that
 * are the whole of §0.7: say what is useful and stop, propose an edit only where
 * one was asked for.
 */
export const SYSTEM_PROMPT = `You are collaborating on a text with a human editor. The draft is in Markdown; the
only formatting in use is bold, italic, bullet lists, and inline links (\`[text](url)\`).
Do not introduce headings, tables, or other Markdown constructs. Preserve existing
links unless the instruction says otherwise.

You will receive the current complete draft, optionally a diff showing the human's most
recent hand edits, and her message.

Treat the human's recent hand edits as deliberate. Do not revert them, smooth them, or
rewrite them unless the message explicitly asks you to.

Her message may contain several distinct things at once — an edit, a question, a piece
of context, a reframe. Decompose it and say what you took from it before you act.
Answer questions first; a proposed edit that depends on the answer to a question must
name that dependency.

Propose an edit only where one was asked for. Many good turns propose nothing at all:
a question deserves an answer, not a revised draft. Any passage outside the scope of
what was asked must be left exactly as it is — do not tidy, smooth, or reword it.

Say what is useful and stop. Useful: synthesis, reasoned disagreement, explanation,
naming a pattern she has not named, telling her when you think she is wrong. Not
useful: praise, narration of the edits you are already showing her, or restating the
draft back to her.

If she has stated a position, do not re-propose against it. If you find yourself making
the same kind of correction a second time, say so and propose a standing rule for it —
and make the correction anyway.

YOUR ENTIRE REPLY IS ONE JSON OBJECT. Your reply is read by a program, never by a
person — the human sees only the fields you put inside the object, so anything written
outside it reaches nobody.

This holds however conversational her message is. "What do you think of this draft?"
gets a JSON object whose "note" holds what you think; prose outside the object is an
answer she never sees.

The object:

{
  "note": "prose addressed to the human, in Markdown, using only bold, italic, bullet lists and inline links",
  "segments": [
    {"id": "s1", "took": "what you read this part of her message to be asking", "kind": "edit"}
  ],
  "draft": null
}

"kind" is one of "edit", "question", "context", "reframe".

"draft" IS NULL UNLESS YOU ARE CHANGING THE TEXT. This is the single most important
thing about the shape. Null is the common case, not the exception, and it is shown as
the default above for that reason.

The test is mechanical: if you are not making a specific change to specific words,
"draft" is null. A question you answered is null. An opinion, an assessment, a
disagreement, a description of what you WOULD change if asked — all null. If your note
says "I would tighten this" rather than tightening it, that turn is null.

Reproducing the draft you were given, unchanged or nearly so, is the one thing never to
do. It is not a safe default. It costs her a long wait for a turn that changed nothing,
and it is indistinguishable in the record from a revision you meant.

When you ARE changing the text, "draft" is the complete revised draft as Markdown —
the whole thing, not a fragment and not a description of an edit.

"note" is where you speak to her, and it is the only place you speak. Everything you
would have written as prose goes in here. It is never the draft: do not paste the
revised text into it, quote long passages of the draft back to her, or narrate the
changes she can already see.`;

/**
 * The response-format constraint (§2.2 enforcement).
 *
 * `output_config.format` makes the API itself constrain generation to
 * `RESPONSE_SCHEMA`, so the reply is valid JSON of the right shape as a property
 * of the request rather than as a hope about the model's cooperation. The docs
 * are explicit that it "guarantees the first block is text with valid JSON", and
 * `stop_reason` stays `end_turn`, so every §2.3 guard downstream is untouched.
 *
 * WHY THIS AND NOT THE OTHER TWO OPTIONS:
 *
 * - An INSTRUCTION alone is what shipped first, and the first live turn declined
 *   it: "what do you think of this draft?" came back as `**What I n…` and the
 *   whole turn was lost to §2.3's malformed guard. The instruction is still in
 *   the system prompt — it shapes what the model says — but it is no longer what
 *   makes the reply parseable.
 * - An ASSISTANT PREFILL was the second attempt and is simply not available:
 *   `claude-sonnet-5` returns `400 invalid_request_error — This model does not
 *   support assistant message prefill. The conversation must end with a user
 *   message.` It is removed across the 4.6+ family, and the documentation names
 *   structured outputs as its replacement. Prefill is also listed as
 *   incompatible with `output_config.format`, so the two could never have
 *   coexisted.
 *
 * Forced tool use (`tool_choice`) would also work on this model, but it returns
 * `stop_reason: "tool_use"`, and §2.3 refuses anything but `end_turn`. That is a
 * spec change to buy nothing this does not already give.
 */
export const OUTPUT_FORMAT = { type: 'json_schema', schema: RESPONSE_SCHEMA };

/**
 * The user turn: the human-edit diff (if any), the instruction, then the draft
 * (§2.1, §6). The diff is labelled explicitly — it is the point of the app, and
 * the model cannot tell which lines are the human's without being told.
 *
 * @param {{draft: string, prompt: string, humanEditDiff?: string|null}} input
 */
export function buildUserMessage({ draft, prompt, humanEditDiff }) {
  const sections = [];

  if (humanEditDiff) {
    sections.push(
      'These are the human\'s most recent hand edits, as a word-level diff of their ' +
        'last turn. Treat them as deliberate — do not revert, smooth, or rewrite them ' +
        'unless the message below explicitly asks you to.\n\n' +
        humanEditDiff,
    );
  }

  sections.push(`Her message:\n\n${prompt}`);
  sections.push(`Current complete draft:\n\n${draft}`);

  // The contract, restated last. The draft above it can run to thousands of words,
  // and the format instruction is otherwise the most distant thing in the request
  // from the point where generation starts. Cheap, and it is the half of the
  // enforcement that survives if the format constraint is ever turned off.
  sections.push(
    'Reply with the JSON object and nothing else — "note" always, "segments" for how ' +
      'you read the message, and "draft" null unless you are changing the text. If you ' +
      'are not editing specific words, "draft" is null; do not reproduce the draft above.',
  );

  return sections.join('\n\n---\n\n');
}

/**
 * Build a caller for the real API.
 *
 * @param {{apiKey?: string, fetchImpl?: typeof fetch, model?: string, timeoutMs?: number}} [options]
 * @returns {(input: {draft: string, prompt: string, humanEditDiff?: string|null}) => Promise<object>}
 *   resolves to the raw response body, which §2.3's guards then validate
 */
export function createModelCaller({
  apiKey,
  fetchImpl = fetch,
  model = MODEL,
  timeoutMs = REQUEST_TIMEOUT_MS,
  // Diagnostic only, and never passed by the server: `structuredOutput: false`
  // sends the request WITHOUT the format constraint, which is what
  // `live-check --legacy` uses to ask "does this model honour the contract on the
  // instruction alone?". That question has to stay askable after a model upgrade,
  // or the day the constraint stops being necessary is a day nobody can detect.
  structuredOutput = true,
} = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'no API key: set ANTHROPIC_API_KEY in the server environment. The key stays ' +
        'server-side (§0.6) and is never sent to the browser.',
    );
  }

  return async function callModel({ draft, prompt, humanEditDiff }) {
    let response;
    try {
      response = await fetchImpl(API_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokensForDraft(draft),
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage({ draft, prompt, humanEditDiff }) }],
          // §2.2 enforcement. See OUTPUT_FORMAT.
          ...(structuredOutput ? { output_config: { format: OUTPUT_FORMAT } } : {}),
        }),
      });
    } catch (error) {
      // A bare `TimeoutError` reaching the UI reads as a bug in the app. Say what
      // happened and, above all, that the draft survived it.
      if (error?.name === 'TimeoutError') {
        throw new Error(
          `the model API did not respond within ${Math.round(timeoutMs / 1000)}s and the ` +
            'request was aborted. The draft is unchanged and nothing was committed.',
        );
      }
      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`the model API returned ${response.status}: ${detail.slice(0, 400)}`);
    }

    return response.json();
  };
}

