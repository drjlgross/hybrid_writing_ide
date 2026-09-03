/**
 * A canned Anthropic Messages API body carrying the §2.2 response envelope.
 *
 * One helper rather than a JSON literal per test, because every test that stubs
 * the model has to speak the contract, and a contract written out fifteen times
 * is fifteen places to forget to change in step 13. When `draft` becomes
 * `candidates`, this file changes and the tests that only care about the sequence
 * do not.
 *
 * `note` has a default because §0.7 requires one on every turn and most tests are
 * not about the speech; the ones that are pass their own.
 */

/**
 * A well-formed response proposing a revision.
 *
 * @param {string} draft the complete revised Markdown
 * @param {{note?: string, segments?: object[], stop_reason?: string}} [options]
 */
export function modelResponse(draft, { note = 'Here is the revision.', segments, ...overrides } = {}) {
  const envelope = { note };
  if (segments !== undefined) envelope.segments = segments;
  if (draft !== undefined) envelope.draft = draft;
  return rawResponse(JSON.stringify(envelope), overrides);
}

/**
 * §0.9's degenerate case: speech and no revision. The `draft` field is absent,
 * which is how the model says it touched nothing.
 *
 * @param {string} note
 */
export function speechOnlyResponse(note, options = {}) {
  return modelResponse(undefined, { note, ...options });
}

/**
 * An API body wrapping arbitrary text — for the tests that are about what happens
 * when the model does NOT honour the contract.
 */
export function rawResponse(text, overrides = {}) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    ...overrides,
  };
}
