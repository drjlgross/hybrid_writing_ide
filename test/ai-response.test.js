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
  NOTE_MAX_CHARS,
  asksForCutting,
  extractText,
  maxTokensForDraft,
  parseResponseEnvelope,
  stripCodeFences,
  validateAiResponse,
  validateNote,
  validateReplacementMarkdown,
  validateSegments,
} from '../src/ai-response.js';
import { formatStrippedWarning, stripOutOfDialect } from '../src/dialect-guard.js';
import { modelResponse, rawResponse, speechOnlyResponse } from './helpers/model-response.js';

const DRAFT = [
  'The **opening line** carries some weight, and it runs on for a while so that',
  'a shrink guard has something to measure against.',
  '',
  '- A bullet that mentions [the docs](https://example.com/docs).',
  '- A second bullet, also of some length, to pad the draft out.',
  '',
].join('\n');

/**
 * A well-formed response body carrying the §2.2 envelope with `text` as the
 * revised draft. `ok` is what these tests meant before the contract existed, and
 * it still means it: a response the guards should be happy with.
 */
const ok = (text, overrides = {}) => modelResponse(text, overrides);

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
  // The OUTER layer: nothing came back at all. Checked before the envelope is
  // parsed, because "" is not malformed JSON so much as no response.
  for (const text of ['', '   ', '\n\n', '\t\n  \n']) {
    assert.throws(
      () => validateAiResponse(rawResponse(text), { draft: DRAFT, prompt: 'p' }),
      (error) => error instanceof AiResponseError && error.reason === 'empty',
      `expected ${JSON.stringify(text)} to be rejected`,
    );
  }

  // No content blocks at all, and no text blocks among them.
  assert.throws(
    () => validateAiResponse(rawResponse('', { content: [] }), { draft: DRAFT, prompt: 'p' }),
    AiResponseError,
  );
  assert.throws(
    () => validateAiResponse({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hm' }] }, { draft: DRAFT, prompt: 'p' }),
    AiResponseError,
  );

  // An empty fence is empty, not a response consisting of a fence. The two cases
  // share a guard but report differently, so the message says which happened.
  assert.throws(
    () => validateAiResponse(rawResponse('```json\n\n```'), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'empty' &&
      /empty code fence/.test(error.message),
  );
  assert.throws(
    () => validateAiResponse(rawResponse('   '), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'empty' &&
      /empty response/.test(error.message),
  );

  // The INNER layer: a well-formed envelope whose `draft` is empty. Committing it
  // would replace the whole draft with nothing, so it is refused, and the message
  // says which of the two emptinesses happened.
  for (const text of ['', '   ', '\n\n']) {
    assert.throws(
      () => validateAiResponse(ok(text), { draft: DRAFT, prompt: 'p' }),
      (error) =>
        error instanceof AiResponseError &&
        error.reason === 'empty' &&
        /revised draft held no text/.test(error.message),
      `expected a draft of ${JSON.stringify(text)} to be rejected`,
    );
  }

  // Neither speech nor a revision is not a turn at all.
  assert.throws(
    () => validateAiResponse(speechOnlyResponse('   '), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'empty' &&
      /neither speech nor a revision/.test(error.message),
  );
});

// ── §2.2: the response envelope ─────────────────────────────────────────────────

test('§2.3 malformed JSON is a failed turn, with no partial recovery', () => {
  // The old contract: raw Markdown. It is not JSON, so it is refused rather than
  // guessed at — §2.3 says "do not attempt partial recovery".
  const rawMarkdown = 'The **opening line** carries some weight, and it runs on for a while.\n';
  assert.throws(
    () => validateAiResponse(rawResponse(rawMarkdown), { draft: DRAFT, prompt: 'p' }),
    (error) =>
      error instanceof AiResponseError &&
      error.reason === 'malformed' &&
      /draft is unchanged/.test(error.message),
    'raw Markdown must not be silently accepted as a draft',
  );

  for (const text of ['{"note": "unterminated', '{note: "unquoted key"}', '{"note": "x",}']) {
    assert.throws(
      () => validateAiResponse(rawResponse(text), { draft: DRAFT, prompt: 'p' }),
      (error) => error instanceof AiResponseError && error.reason === 'malformed',
      `expected ${JSON.stringify(text)} to be refused`,
    );
  }

  // Valid JSON that is not the object §2.2 describes.
  for (const text of ['[]', '"a string"', '42', 'null', 'true']) {
    assert.throws(
      () => parseResponseEnvelope(text),
      (error) => error instanceof AiResponseError && error.reason === 'malformed',
      `expected ${text} to be refused`,
    );
  }

  assert.deepEqual(parseResponseEnvelope('{"note": "hello"}'), { note: 'hello' });
});

test('§2.2 the envelope survives the code fence the contract told the model not to add', () => {
  const fenced = rawResponse('```json\n{"note": "Tightened the opening.", "draft": "Just **one** line.\\n"}\n```');
  const result = validateAiResponse(fenced, { draft: DRAFT, prompt: 'p' });

  assert.equal(result.note, 'Tightened the opening.');
  assert.equal(result.draft, 'Just **one** line.\n');
});

// ── §0.7: the model's speech ────────────────────────────────────────────────────

test('§0.7 the note is carried through, and a response with no note is a failed turn', () => {
  const spoken = validateAiResponse(
    modelResponse('Just **one** line that is long enough not to trip the shrink guard here.\n', {
      note: 'I answered the question first; the edit below rests on that answer.',
    }),
    { draft: DRAFT, prompt: 'p' },
  );
  assert.equal(spoken.note, 'I answered the question first; the edit below rests on that answer.');

  // §0.7 is locked: every AI turn returns a note. A response without one has not
  // met the contract, and there is nothing to recover.
  for (const envelope of ['{"draft": "text"}', '{"note": null, "draft": "text"}', '{"note": 12}']) {
    assert.throws(
      () => validateAiResponse(rawResponse(envelope), { draft: DRAFT, prompt: 'p' }),
      (error) => error instanceof AiResponseError && error.reason === 'contract',
      `expected ${envelope} to be refused`,
    );
  }
});

test('§2.3 the note is checked for length and for fences, and canonicalized into nothing', () => {
  // Fences: the note is prose, and a model that wrapped it gets unwrapped.
  assert.equal(validateNote('```\nHello there.\n```').note, 'Hello there.');
  assert.equal(validateNote('  Hello there.  ').note, 'Hello there.');

  // NOT canonicalized and NOT dialect-stripped. §2.3: the note "is not
  // canonicalized into the draft and never reaches TipTap". A heading in prose
  // addressed to a human is the model's words; stripping it would edit them.
  const withHeading = validateNote('# A heading\n\nAnd _underscored_ emphasis.');
  assert.match(withHeading.note, /^# A heading/, 'a construct outside the draft dialect survives');
  assert.match(withHeading.note, /_underscored_/, 'and so does non-canonical emphasis');
  assert.deepEqual(withHeading.warnings, []);

  // Length is a SOFT guard: the ledger holds the speech (§9 S13) and truncating it
  // would destroy the record, so an over-long note is kept in full and named.
  const long = validateNote('x'.repeat(NOTE_MAX_CHARS + 1));
  assert.equal(long.note.length, NOTE_MAX_CHARS + 1, 'kept in full, not truncated');
  assert.equal(long.warnings.length, 1);
  assert.match(long.warnings[0], /over the 6000/);
  assert.match(long.warnings[0], /the draft pasted back/, 'and says what the length is a symptom of');

  assert.deepEqual(validateNote('x'.repeat(NOTE_MAX_CHARS)).warnings, [], 'exactly at the cap is fine');
});

test('§0.9 a speech-only turn is a first-class outcome: note, no revision, no change', () => {
  const result = validateAiResponse(
    speechOnlyResponse('The change you just made moves the claim from the fourth line to the first. Keep it.'),
    { draft: DRAFT, prompt: 'weigh in on the change I just made' },
  );

  assert.match(result.note, /^The change you just made/);
  assert.equal(result.changed, false, 'the model touched nothing');
  assert.equal(result.draft, DRAFT, 'and the draft it hands back is the one it was given');
  assert.deepEqual(result.warnings, [], 'a turn that proposed nothing has nothing to warn about');
  assert.deepEqual(result.stripped, {});

  // An explicit null is the same statement as an absent field.
  const explicitNull = validateAiResponse(rawResponse('{"note": "Nothing to change.", "draft": null}'), {
    draft: DRAFT,
    prompt: 'p',
  });
  assert.equal(explicitNull.changed, false);
  assert.equal(explicitNull.draft, DRAFT);

  // A model that echoed the draft back verbatim rather than omitting the field
  // reaches the same place. The unchanged snapshot is the assertion, either way.
  const echoed = validateAiResponse(modelResponse(DRAFT, { note: 'Nothing to change.' }), {
    draft: DRAFT,
    prompt: 'p',
  });
  assert.equal(echoed.changed, false);
  assert.equal(echoed.draft, DRAFT);

  // A `draft` of the wrong type is not a speech-only turn — it is a contract
  // violation, and guessing which one it meant is exactly what §2.3 forbids.
  assert.throws(
    () => validateAiResponse(rawResponse('{"note": "x", "draft": 42}'), { draft: DRAFT, prompt: 'p' }),
    (error) => error instanceof AiResponseError && error.reason === 'contract',
  );
});

// ── §2.2: segments ──────────────────────────────────────────────────────────────

test('§2.2 segments are carried when well-formed and dropped, with a warning, when not', () => {
  const good = [
    { id: 's1', took: 'a copy edit to the second paragraph', kind: 'edit' },
    { id: 's2', took: 'a question about what the draft is arguing', kind: 'question' },
  ];
  assert.deepEqual(validateSegments(good), { segments: good, warnings: [] });

  // Absent is not an error: `segments` is metadata, and §2.2's `candidates` may be
  // empty for the same reason.
  assert.deepEqual(validateSegments(undefined), { segments: [], warnings: [] });
  assert.deepEqual(validateSegments(null), { segments: [], warnings: [] });

  // A bad entry is DROPPED, not fatal. Losing a good revision over a misspelled
  // `kind` would be the §2.3 failure class running backwards.
  const mixed = validateSegments([
    { id: 's1', took: 'an edit', kind: 'edit' },
    { id: 's2', took: 'a thing', kind: 'wat' },
    { id: 's3', kind: 'question' },
    'not an object',
    null,
  ]);
  assert.deepEqual(mixed.segments, [{ id: 's1', took: 'an edit', kind: 'edit' }]);
  assert.equal(mixed.warnings.length, 1);
  assert.match(mixed.warnings[0], /4 of 5 segments/);
  assert.match(mixed.warnings[0], /edit\/question\/context\/reframe/, 'and names what was expected');

  const notAList = validateSegments('s1');
  assert.deepEqual(notAList.segments, []);
  assert.match(notAList.warnings[0], /rather than a list/);

  // Only the three contract fields survive: a segment is not a place for the model
  // to smuggle anything else onto the turn record.
  const extra = validateSegments([{ id: 's1', took: 't', kind: 'edit', snapshot: 'a whole draft' }]);
  assert.deepEqual(extra.segments, [{ id: 's1', took: 't', kind: 'edit' }]);

  // And the warning lands on the turn, not only in the unit.
  const onTurn = validateAiResponse(
    modelResponse(DRAFT.replace('some weight', 'rather more weight'), {
      segments: [{ id: 's1', took: 'an edit', kind: 'nonsense' }],
    }),
    { draft: DRAFT, prompt: 'p' },
  );
  assert.deepEqual(onTurn.segments, []);
  assert.equal(onTurn.warnings.length, 1);
  assert.match(onTurn.warnings[0], /1 of 1 segment/);
});

// ── §2.3 extended: the guards run over one piece of proposed text ───────────────

test('§2.3 validateReplacementMarkdown is the per-payload guard step 13 reuses', () => {
  // The whole point of the seam: it takes ONE piece of proposed Markdown and
  // knows nothing about whether it is a draft or a candidate's `replacement`.
  const result = validateReplacementMarkdown('# A heading\n\nSome **prose**.\n');
  assert.deepEqual(result.stripped, { heading: 1 });
  assert.match(result.markdown, /A heading/, 'the text survives');
  assert.doesNotMatch(result.markdown, /^#/m, 'the construct does not');
  assert.equal(result.warnings.length, 1);

  // It canonicalizes, so a candidate cannot put a second dialect in the store.
  assert.equal(validateReplacementMarkdown('_italic_ and __bold__\n').markdown, '*italic* and **bold**\n');

  // What it deliberately does NOT do: refuse empty text. An empty candidate
  // replacement is a deletion, which is legitimate — the whole-draft caller is
  // what knows an empty draft is not.
  assert.deepEqual(validateReplacementMarkdown('').markdown, '');
  assert.deepEqual(validateReplacementMarkdown('').warnings, []);
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

  // Asked for cutting → the warning is SOFTENED, never suppressed (chunk 7
  // item 6). "Tighten the second paragraph" is both the instruction this
  // heuristic matches and the instruction under which a model quietly drops a
  // paragraph, so suppressing on a match turned the guard off in the exact case
  // §2.3 wrote it for.
  for (const prompt of ['cut the second paragraph', 'make it shorter', 'tighten this up', 'condense', 'trim the fat']) {
    const asked = validateAiResponse(short, { draft: DRAFT, prompt });
    assert.equal(asksForCutting(prompt), true, `"${prompt}" reads as asking for cutting`);

    assert.equal(asked.warnings.length, 1, `"${prompt}" must still warn`);
    assert.match(asked.warnings[0], /\d+% shorter/, 'and still name the size of the drop');
    assert.match(asked.warnings[0], /did ask for cutting/, 'but say the instruction asked for it');
    assert.doesNotMatch(
      asked.warnings[0],
      /did not ask for cutting/,
      'the softened wording must not read as the unrequested-shrink one',
    );
    assert.match(
      asked.warnings[0],
      /nothing you meant to keep/,
      'softened still means "check it", not "never mind"',
    );
  }

  // An instruction with no compression word in it keeps the blunt wording.
  const blunt = validateAiResponse(short, { draft: DRAFT, prompt: 'make the tone more formal' });
  assert.match(blunt.warnings[0], /did not ask for cutting/);

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
