/**
 * The model call's shape and its timeout (CLAUDE.md §2, §6, §0.6).
 *
 * `fetch` is injected, so none of this touches the network or needs a key. What is
 * NOT covered here is whether the real API accepts this request — that is what
 * `scripts/live-check.js` is for, and it is the one thing that cannot be faked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  API_URL,
  API_VERSION,
  MODEL,
  REQUEST_TIMEOUT_MS,
  OUTPUT_FORMAT,
  SYSTEM_PROMPT,
  buildUserMessage,
  createModelCaller,
} from '../src/anthropic-client.js';
import { RESPONSE_SCHEMA, SEGMENT_KINDS, maxTokensForDraft } from '../src/ai-response.js';

const body = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'revised\n' }] };

/** A fetch stub that records the request and returns a canned response. */
function recordingFetch(response = body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => response };
  };
  return { calls, fetchImpl };
}

test('the request carries the model, version header, and a draft-sized max_tokens', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const callModel = createModelCaller({ apiKey: 'test-key', fetchImpl });

  // Long enough to push the budget past its floor, so the assertion below is
  // measuring the computation rather than the clamp.
  const draft = 'A draft of some length, long enough to matter to the budget.\n'.repeat(200);
  await callModel({ draft, prompt: 'tighten it', humanEditDiff: null });

  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, API_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['anthropic-version'], API_VERSION);
  assert.equal(init.headers['x-api-key'], 'test-key');

  const payload = JSON.parse(init.body);
  assert.equal(payload.model, MODEL);
  assert.equal(payload.max_tokens, maxTokensForDraft(draft));
  assert.ok(payload.max_tokens > 4096, 'a long draft must get a budget bigger than the floor');
  assert.equal(payload.messages[0].role, 'user');
  assert.match(payload.messages[0].content, /tighten it/);
});

// ── §2.2 enforcement: the structured-output constraint ─────────────────────────

test('§2.2 every request constrains the response format to the envelope schema', async () => {
  // The first live turn answered "what do you think of this draft?" with
  // `**What I n…` — Markdown prose — and the whole turn was lost to the §2.3
  // malformed guard. An instruction is a request the model may decline;
  // `output_config.format` is a constraint the API applies to generation.
  const { calls, fetchImpl } = recordingFetch();
  const callModel = createModelCaller({ apiKey: 'k', fetchImpl });

  await callModel({ draft: 'a draft\n', prompt: 'what do you think of this draft?' });

  const payload = JSON.parse(calls[0].init.body);
  assert.deepEqual(payload.output_config, { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } });

  // And NOT the prefill this replaced: `claude-sonnet-5` returns 400
  // "This model does not support assistant message prefill. The conversation must
  // end with a user message." Structured outputs is documented as incompatible
  // with prefilling, so the two can never both be present.
  assert.equal(payload.messages.length, 1);
  assert.equal(payload.messages.at(-1).role, 'user', 'the conversation must end with a user message');
  assert.equal(
    payload.messages.some((m) => m.role === 'assistant'),
    false,
    'no assistant turn, ever — this model rejects the request outright',
  );
});

test('§2.2 the request-side schema IS the parser-side contract, and cannot drift', () => {
  // The schema is declared in ai-response.js beside `validateAiResponse`, and the
  // client imports it. If it were restated here, the shape the model is
  // constrained to emit could drift from the shape the parser accepts — and the
  // symptom would be a turn that validates upstream and fails downstream.
  assert.equal(OUTPUT_FORMAT.schema, RESPONSE_SCHEMA, 'the same object, not a copy');
  assert.equal(OUTPUT_FORMAT.type, 'json_schema');

  // `kind` is generated FROM SEGMENT_KINDS, so adding a kind to the parser adds it
  // to the request in the same edit.
  assert.deepEqual(RESPONSE_SCHEMA.properties.segments.items.properties.kind.enum, [...SEGMENT_KINDS]);

  // §0.7: a note on every turn. §2.2: `draft` is the interim field.
  assert.deepEqual(RESPONSE_SCHEMA.required, ['note', 'segments', 'draft']);
  assert.ok(!('candidates' in RESPONSE_SCHEMA.properties), 'candidates are step 13');

  // `draft` is required but nullable — "emit null" is a decision the model makes
  // explicitly, where "omit the key" is one it can make by forgetting. The parser
  // accepts both (see ai-response.test.js), so this only removes an accident.
  assert.deepEqual(RESPONSE_SCHEMA.properties.draft, { anyOf: [{ type: 'string' }, { type: 'null' }] });

  // Required by the structured-output implementation on every object, and it is
  // also what stops the model adding fields to a turn record.
  assert.equal(RESPONSE_SCHEMA.additionalProperties, false);
  assert.equal(RESPONSE_SCHEMA.properties.segments.items.additionalProperties, false);

  // The schema dialect supports none of these; sending one is a 400.
  const asText = JSON.stringify(RESPONSE_SCHEMA);
  for (const unsupported of ['minLength', 'maxLength', 'minimum', 'maximum', 'multipleOf', 'pattern']) {
    assert.doesNotMatch(asText, new RegExp(unsupported), `${unsupported} is not supported by the schema dialect`);
  }
});

test('the format constraint can be turned off for diagnostics', async () => {
  // `live-check --legacy` is the only caller. The question "does this model honour
  // the contract on the instruction alone?" has to stay askable after a model
  // upgrade, or the day the constraint stops being necessary is a day nobody
  // detects. It is also how the original bug reproduces.
  const { calls, fetchImpl } = recordingFetch();
  const callModel = createModelCaller({ apiKey: 'k', fetchImpl, structuredOutput: false });

  await callModel({ draft: 'a draft\n', prompt: 'p' });
  assert.equal(JSON.parse(calls[0].init.body).output_config, undefined);
});

test('§2.2 the contract is stated in the system prompt AND last in the user turn', async () => {
  // Two halves, deliberately. `output_config.format` is what makes the reply
  // parseable; these words shape what the model puts in the fields, and are what
  // would still be standing if the constraint were ever turned off. The user-turn
  // reminder is last because the draft above it can run to thousands of words.
  assert.match(SYSTEM_PROMPT, /YOUR ENTIRE REPLY IS ONE JSON OBJECT/);
  assert.match(SYSTEM_PROMPT, /read by a program, never by a\nperson/);
  assert.match(
    SYSTEM_PROMPT,
    /What do you think of this draft\?"\ngets a JSON object/,
    'the exact prompt that broke the first live turn is named in the instruction',
  );

  const message = buildUserMessage({ draft: 'the draft\n', prompt: 'what do you think?' });
  assert.match(message, /Reply with the JSON object and nothing else/);
  assert.ok(
    message.lastIndexOf('JSON object and nothing else') > message.indexOf('the draft'),
    'the reminder comes after the draft, not before it',
  );
});

test('every request carries an abort signal with a timeout', async () => {
  const { calls, fetchImpl } = recordingFetch();
  const callModel = createModelCaller({ apiKey: 'k', fetchImpl });

  await callModel({ draft: 'short\n', prompt: 'p' });

  const { signal } = calls[0].init;
  assert.ok(signal, 'a request with no timeout can hang the editor lock forever (§0.2)');
  assert.equal(typeof signal.aborted, 'boolean');
  assert.equal(signal.aborted, false);
  assert.ok(REQUEST_TIMEOUT_MS > 0);
});

test('the timeout actually fires, and says the draft is unchanged', async () => {
  // A fetch that never resolves on its own: only the signal can end it. This is
  // the case the timeout exists for — a hung connection holding the editor
  // read-only with no error and no way back except a reload.
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });

  const callModel = createModelCaller({ apiKey: 'k', fetchImpl, timeoutMs: 30 });

  await assert.rejects(
    () => callModel({ draft: 'a draft\n', prompt: 'p' }),
    (error) => {
      assert.match(error.message, /did not respond within/);
      assert.match(error.message, /draft is unchanged/, 'the human has to be told their text is safe');
      assert.doesNotMatch(error.message, /TimeoutError/, 'a raw DOMException reads as a bug in the app');
      return true;
    },
  );
});

test('an error that is not a timeout is passed through untouched', async () => {
  const failure = new TypeError('fetch failed');
  const callModel = createModelCaller({
    apiKey: 'k',
    fetchImpl: async () => {
      throw failure;
    },
  });

  await assert.rejects(() => callModel({ draft: 'x\n', prompt: 'p' }), (error) => {
    assert.equal(error, failure, 'a network error must not be relabelled as a timeout');
    return true;
  });
});

test('a non-2xx response is reported with its status and body', async () => {
  const callModel = createModelCaller({
    apiKey: 'k',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      text: async () => '{"error":{"type":"rate_limit_error"}}',
    }),
  });

  await assert.rejects(() => callModel({ draft: 'x\n', prompt: 'p' }), /429.*rate_limit_error/s);
});

test('constructing a caller with no key anywhere fails loudly', () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.throws(() => createModelCaller(), /no API key/);
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});
