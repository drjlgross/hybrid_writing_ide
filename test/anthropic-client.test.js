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
  createModelCaller,
} from '../src/anthropic-client.js';
import { maxTokensForDraft } from '../src/ai-response.js';

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
  assert.equal(payload.messages.length, 1);
  assert.match(payload.messages[0].content, /tighten it/);
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
