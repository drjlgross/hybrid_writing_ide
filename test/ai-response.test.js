/**
 * CLAUDE.md §2.3 response safety — "this is the one bug that loses work".
 *
 * Every case here is a canned response body. Nothing in this file needs an API
 * key or a network: the guards are pure functions over a response object.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AiResponseError,
  asksForCutting,
  extractText,
  maxTokensForDraft,
  stripCodeFences,
  validateAiResponse,
} from '../src/ai-response.js';
import { formatStrippedWarning, stripOutOfDialect } from '../src/dialect-guard.js';

const DRAFT = [
  'The **opening line** carries some weight, and it runs on for a while so that',
  'a shrink guard has something to measure against.',
  '',
  '- A bullet that mentions [the docs](https://example.com/docs).',
  '- A second bullet, also of some length, to pad the draft out.',
  '',
].join('\n');

/** A well-formed response body, as the Messages API returns it. */
const ok = (text, overrides = {}) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  ...overrides,
});

test('max_tokens is computed from the draft size, never a small constant', () => {
  const small = maxTokensForDraft('a short draft\n');
  const large = maxTokensForDraft('x'.repeat(40_000));

  assert.ok(large > small, 'a larger draft must get a larger budget');
  assert.ok(small >= 4096, `floor is too low: ${small}`);
  assert.ok(large >= Math.ceil(40_000 / 3), 'the budget must cover reproducing the draft');
  assert.ok(large <= 32_000, 'the budget must stay under the practical ceiling');

  // Monotonic across a range — the point of "computed from the draft size".
  const sizes = [100, 1_000, 10_000, 100_000].map((n) => maxTokensForDraft('x'.repeat(n)));
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(sizes[i] >= sizes[i - 1], `budget went down as the draft grew: ${sizes}`);
  }
});

test('a truncated response is NOT committed (stop_reason guard)', () => {
  // The response looks fine. It is a complete-looking draft. It is not complete.
  const truncated = ok('The **opening line** carries some weight, and it runs', {
    stop_reason: 'max_tokens',
  });

  assert.throws(
    () => validateAiResponse(truncated, { draft: DRAFT, prompt: 'tighten it' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'stop_reason' &&
      error.stopReason === 'max_tokens' &&
      /max_tokens/.test(error.message) &&
      /draft is unchanged/.test(error.message),
  );

  // Every non-end_turn stop reason is refused, not just max_tokens.
  for (const stopReason of ['refusal', 'tool_use', 'pause_turn', 'stop_sequence', null, undefined]) {
    assert.throws(
      () => validateAiResponse(ok('some text', { stop_reason: stopReason }), { draft: DRAFT, prompt: 'p' }),
      AiResponseError,
      `stop_reason ${JSON.stringify(stopReason)} should have been refused`,
    );
  }
});

test('an empty or whitespace-only response is rejected', () => {
  for (const text of ['', '   ', '\n\n', '\t\n  \n']) {
    assert.throws(
      () => validateAiResponse(ok(text), { draft: DRAFT, prompt: 'p' }),
      (error) => error instanceof AiResponseError && error.reason === 'empty',
      `expected ${JSON.stringify(text)} to be rejected`,
    );
  }

  // No content blocks at all, and no text blocks among them.
  assert.throws(() => validateAiResponse(ok(undefined, { content: [] }), { draft: DRAFT, prompt: 'p' }), AiResponseError);
  assert.throws(
    () => validateAiResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hm' }] }, { draft: DRAFT, prompt: 'p' }),
    AiResponseError,
  );

  // An empty fence is empty, not a draft consisting of a fence. The two cases
  // share a guard but report differently, so the message says which happened.
  assert.throws(
    () => validateAiResponse(ok('```markdown\n\n```'), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'empty' &&
      /empty code fence/.test(error.message),
  );
  assert.throws(
    () => validateAiResponse(ok('   '), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'empty' &&
      /empty response/.test(error.message),
  );
});

test('surrounding code fences are stripped defensively', () => {
  assert.equal(stripCodeFences('```markdown\nhello\n```'), 'hello');
  assert.equal(stripCodeFences('```\nhello\n```'), 'hello');
  assert.equal(stripCodeFences('~~~\nhello\n~~~'), 'hello');
  assert.equal(stripCodeFences('````md\nhello\n````'), 'hello');
  assert.equal(stripCodeFences('  ```\nhello\n```  '), 'hello');
  assert.equal(stripCodeFences('no fence here'), 'no fence here');

  // A fence in the MIDDLE is a code block, not a wrapper — leave it for the
  // dialect guard to strip, which keeps its text.
  const inner = 'before\n\n```\ncode\n```\n\nafter';
  assert.equal(stripCodeFences(inner), inner);

  const fenced = validateAiResponse(ok('```markdown\nJust **one** line.\n```'), { draft: DRAFT, prompt: 'p' });
  assert.equal(fenced.draft, 'Just **one** line.\n');
  assert.deepEqual(fenced.stripped, {}, 'a wrapper fence must not be counted as a stripped code block');
});

test('the 40% shrink guard warns but still commits', () => {
  const short = ok('Short.\n');
  const result = validateAiResponse(short, { draft: DRAFT, prompt: 'make the tone more formal' });

  assert.equal(result.draft, 'Short.\n', 'the turn is still committed');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /shorter than before this turn/);
  assert.match(result.warnings[0], /\d+% shorter/, 'the warning must name the size of the drop');
  assert.match(result.warnings[0], /did not ask for cutting/);

  // Asked for cutting → no warning.
  for (const prompt of ['cut the second paragraph', 'make it shorter', 'tighten this up', 'condense', 'trim the fat']) {
    const asked = validateAiResponse(short, { draft: DRAFT, prompt });
    assert.deepEqual(asked.warnings, [], `"${prompt}" reads as asking for cutting`);
    assert.equal(asksForCutting(prompt), true);
  }

  // A small shrink is not warned about.
  const slightlyShorter = DRAFT.slice(0, Math.floor(DRAFT.length * 0.8));
  assert.deepEqual(
    validateAiResponse(ok(slightlyShorter), { draft: DRAFT, prompt: 'formalize' }).warnings,
    [],
    'a 20% shrink is under the threshold',
  );
});

test('§2.3 out-of-dialect check: constructs are stripped, text survives, counts are structured', () => {
  const response = ok(
    [
      '# A heading the model added',
      '',
      'A paragraph with `inline code` in it.',
      '',
      '> A blockquote the model added.',
      '',
      '---',
      '',
      '| Column A | Column B |',
      '| --- | --- |',
      '| first | second |',
      '',
      '```js',
      'const x = 1;',
      '```',
      '',
      '## A second heading',
      '',
      '1. An ordered item',
      '2. Another ordered item',
      '',
      'The final **paragraph** with [a link](https://example.com/keep).',
      '',
    ].join('\n'),
  );

  const result = validateAiResponse(response, { draft: DRAFT, prompt: 'restructure it' });

  // Structured counts on the turn — §2.3 is explicit that a formatted string
  // alone is not sufficient.
  assert.deepEqual(result.stripped, {
    heading: 2,
    inlineCode: 1,
    blockquote: 1,
    thematicBreak: 1,
    table: 1,
    code: 1,
    orderedList: 1,
  });

  // The warning names every construct type AND its count.
  assert.equal(result.warnings.length, 1);
  const [warning] = result.warnings;
  assert.match(warning, /^stripped: /);
  assert.match(warning, /2 headings/);
  assert.match(warning, /1 blockquote/);
  assert.match(warning, /1 table/);
  assert.match(warning, /1 code block/);
  assert.match(warning, /1 thematic break/);
  assert.match(warning, /1 ordered list/);
  assert.match(warning, /1 inline code span/);

  // Every construct is gone from the draft...
  assert.doesNotMatch(result.draft, /^#/m, 'a heading survived');
  assert.doesNotMatch(result.draft, /^>/m, 'a blockquote survived');
  assert.doesNotMatch(result.draft, /^```/m, 'a code fence survived');
  assert.doesNotMatch(result.draft, /`/, 'inline code survived');
  assert.doesNotMatch(result.draft, /^\|/m, 'a table row survived');
  assert.doesNotMatch(result.draft, /^\d+\. /m, 'an ordered list survived');
  assert.doesNotMatch(result.draft, /^(-{3,}|\*{3,}|_{3,})$/m, 'a thematic break survived');

  // ...but their text did not go with them.
  assert.match(result.draft, /A heading the model added/);
  assert.match(result.draft, /A second heading/);
  assert.match(result.draft, /inline code/);
  assert.match(result.draft, /A blockquote the model added/);
  assert.match(result.draft, /const x = 1;/);
  assert.match(result.draft, /Column A Column B/, 'table cells must survive as text');
  assert.match(result.draft, /first second/);
  assert.match(result.draft, /- An ordered item/, 'an ordered list becomes a bullet list');
  assert.match(result.draft, /\[a link\]\(https:\/\/example\.com\/keep\)/, 'a link is IN the dialect');
  assert.match(result.draft, /\*\*paragraph\*\*/, 'bold is in the dialect');
});

test('a clean in-dialect response strips nothing and warns about nothing', () => {
  const clean = ok(
    [
      'The **opening line** carries rather more weight now, and it still runs on',
      'for a while so the shrink guard has nothing to complain about.',
      '',
      '- A bullet that mentions [the docs](https://example.com/docs).',
      '- A second bullet, also of some length, to pad the draft out.',
      '',
    ].join('\n'),
  );

  const result = validateAiResponse(clean, { draft: DRAFT, prompt: 'formalize the opening' });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.stripped, {});
  assert.match(result.draft, /^The \*\*opening line\*\*/);
});

test('the stripped warning is formatted per §2.3, and pluralized', () => {
  assert.equal(formatStrippedWarning({}), null);
  assert.equal(formatStrippedWarning({ heading: 1 }), 'stripped: 1 heading');
  assert.equal(
    formatStrippedWarning({ heading: 2, blockquote: 1, table: 1 }),
    'stripped: 2 headings, 1 blockquote, 1 table',
  );
  assert.equal(formatStrippedWarning({ thematicBreak: 3 }), 'stripped: 3 thematic breaks');
});

test('stripOutOfDialect handles the remaining out-of-dialect constructs', () => {
  const image = stripOutOfDialect('Text with ![alt text](https://example.com/i.png) inline.\n');
  assert.deepEqual(image.stripped, { image: 1 });
  assert.match(image.markdown, /alt text/, 'alt text is the image\'s text content');
  assert.doesNotMatch(image.markdown, /!\[/);

  const html = stripOutOfDialect('Before.\n\n<div class="x">raw</div>\n\nAfter.\n');
  assert.equal(html.stripped.html > 0, true);
  assert.doesNotMatch(html.markdown, /<div/);

  const hardBreak = stripOutOfDialect('One line  \nand a hard break.\n');
  assert.deepEqual(hardBreak.stripped, { break: 1 });
  assert.match(hardBreak.markdown, /One line and a hard break\./);

  // Nested: a heading inside a blockquote must be counted and stripped too.
  const nested = stripOutOfDialect('> # Heading inside a quote\n>\n> And prose.\n');
  assert.deepEqual(nested.stripped, { blockquote: 1, heading: 1 });
  assert.match(nested.markdown, /Heading inside a quote/);
  assert.match(nested.markdown, /And prose\./);
});

test('extractText concatenates text blocks and ignores the rest', () => {
  assert.equal(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'ab');
  assert.equal(extractText({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'y' }] }), 'y');
  assert.equal(extractText({ content: 'plain string' }), 'plain string');
  assert.equal(extractText({}), '');
  assert.equal(extractText(null), '');
});
