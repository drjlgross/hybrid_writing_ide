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

import { maxTokensForDraft } from './ai-response.js';

export const MODEL = 'claude-sonnet-5';
export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

/** §6, verbatim. */
export const SYSTEM_PROMPT = `You are collaborating on a text with a human editor. The draft is in Markdown; the
only formatting in use is bold, italic, bullet lists, and inline links (\`[text](url)\`).
Do not introduce headings, tables, or other Markdown constructs. Preserve existing
links unless the instruction says otherwise.

You will receive the current complete draft, optionally a diff showing the human's most
recent hand edits, and an editing instruction.

Treat the human's recent hand edits as deliberate. Do not revert them, smooth them, or
rewrite them unless the instruction explicitly asks you to.

Apply the instruction. Any passage the instruction does not ask you to change must be
reproduced byte-for-byte identically. Do not tidy, smooth, or reword text outside the
scope of the instruction.

Return ONLY the complete revised draft as raw Markdown. No preamble, no commentary, no
explanation of your changes, no code fences.`;

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
        'unless the instruction below explicitly asks you to.\n\n' +
        humanEditDiff,
    );
  }

  sections.push(`Editing instruction:\n\n${prompt}`);
  sections.push(`Current complete draft:\n\n${draft}`);

  return sections.join('\n\n---\n\n');
}

/**
 * Build a caller for the real API.
 *
 * @param {{apiKey?: string, fetchImpl?: typeof fetch, model?: string}} [options]
 * @returns {(input: {draft: string, prompt: string, humanEditDiff?: string|null}) => Promise<object>}
 *   resolves to the raw response body, which §2.3's guards then validate
 */
export function createModelCaller({ apiKey, fetchImpl = fetch, model = MODEL } = {}) {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'no API key: set ANTHROPIC_API_KEY in the server environment. The key stays ' +
        'server-side (§0.6) and is never sent to the browser.',
    );
  }

  return async function callModel({ draft, prompt, humanEditDiff }) {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
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
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`the model API returned ${response.status}: ${detail.slice(0, 400)}`);
    }

    return response.json();
  };
}
