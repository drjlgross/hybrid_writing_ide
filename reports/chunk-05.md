# Chunk 5 — AI endpoint, §2.4 sequence, §2.3 guards

Status: green. **143 tests, 143 pass, 0 fail** (22 new). Smoke session still exits 0.
The whole suite runs with **no API key and no network** — verified by unsetting
`ANTHROPIC_API_KEY` for the run.

## 1. CLAUDE.md

Three edits, verbatim: the human-turns-only clause in §3, the restore-creates-no-turn
clause in §4, and the new §9 step 7 (editor + AI side panel) with History view → 8 and
Everything else → 9.

## 2. What was built

### `src/ai-response.js` — the §2.3 guards
`validateAiResponse(body, {draft, prompt})` runs them in order, hard guards first:

1. **`stop_reason`** — anything but `end_turn` throws. Checked *before* anything reads
   the text, because a truncated response looks well-formed and committing it would
   leave the full draft only in the previous snapshot. `max_tokens` and `refusal` get
   their own sentence in the error.
2. **Fences stripped**, then **empty/whitespace rejected** — one guard, not two (see F24).
3. **Out-of-dialect strip** (below), then canonicalize.
4. **Shrink guard** — under 60% of the input length and the instruction didn't ask for
   cutting → warning on the turn, turn still commits.

`maxTokensForDraft(draft)` computes the budget from draft size — `chars/3 × 1.6 + 2048`,
clamped to 4096…32000. Never a hardcoded small constant; mutation-checked.

### `src/dialect-guard.js` — the out-of-dialect check
Parses the response, rewrites every construct outside {paragraph, text, list, listItem,
strong, emphasis, link}, and returns **structured counts** plus a formatted warning.
Text is kept: a heading becomes a paragraph, a blockquote's prose is hoisted, a code
block becomes a paragraph of its source, an ordered list becomes a bullet list, an image
becomes its alt text, a hard break becomes a space. Only thematic breaks, HTML, and link
definitions are dropped outright — they carry no prose.

Warning format is §2.3's: `stripped: 2 headings, 1 blockquote, 1 table`. Every type is
named with its count, and the same data lands on the turn as
`{heading: 2, blockquote: 1, table: 1}` — structured, per §2.3's explicit requirement
that a formatted string alone is not sufficient.

### `src/diff.js` — word-level diffs (§2.1 item 2)
`diff` (named in §5), `diffWords`. Computed on demand, never stored. This is what makes
"don't undo my edits" followable — see F26 on why it landed in chunk 5.

### `src/anthropic-client.js` — the model call
`createModelCaller()` returns an async function; `SYSTEM_PROMPT` is §6 verbatim;
`buildUserMessage` assembles the §2.1 payload as diff → instruction → draft, with the
diff explicitly labelled as the human's most recent hand edits. Model `claude-sonnet-5`,
`x-api-key` + `anthropic-version: 2023-06-01`. Nothing reads the environment at import
time, so tests never touch it.

### `src/ai-edit.js` — the §2.4 sequence
Loads, runs `submitAiPrompt`, computes the step-3 diff, calls the model, validates,
commits, asserts §0.3, saves. **The human turn is persisted before the model call**, via
a new `onHumanTurn` hook on `submitAiPrompt` — that is what makes §2.4's "a failure
between 4 and 6 leaves the human turn committed" true on disk rather than only in memory.

### `src/server.js` — the endpoint
`POST /ai-edit {slug, prompt, pendingDraft?}` → `{draft, human_turn, ai_turn, history}`.
Plus `POST /documents` and `GET /documents/:slug` so the endpoint is reachable end to end.
A §2.3 failure returns **502 with `draft_unchanged: true`** and the `reason` /
`stop_reason` — the UI has to be able to tell the human their text is still there.
`createServer({callModel})` takes the caller as an argument; `startServer()` is the only
thing that constructs the real one.

### `src/turns.js` — two additions
`commitAiTurn` now carries `stripped`; `submitAiPrompt` gained the `onHumanTurn` hook.

## 3. Verification

22 new tests. The canned responses §2.3 asks for, each with its own case: a truncated
`stop_reason`, a fenced response, an empty one, an empty *fence*, a 40%-shorter one, and
one carrying headings, a table, a blockquote, a thematic break, inline code, a code
block, and an ordered list at once. Plus nested constructs (a heading inside a
blockquote), images, HTML, hard breaks, and the endpoint over real HTTP on an ephemeral
port.

| Mutation | Result |
|---|---|
| `stop_reason` guard removed | 3 fail |
| empty-response guard removed | **first attempt: 0 fail** → dead code found (F24); after the fix, 1 fail |
| fence stripping removed | 1 fail |
| shrink guard removed | 2 fail |
| `max_tokens` → hardcoded 1024 | 1 fail |
| out-of-dialect check removed | 2 fail |
| `stripped` counts not stored on the turn | 1 fail |
| human turn not persisted before the model call | 1 fail |
| diff not sent to the model | 1 fail |

## 4. Findings

**F24. The first empty-response check was dead code.** Removing it broke nothing: an
empty body and an empty fence both arrive at the post-fence check as an empty string, so
the pre-fence check was unreachable. Collapsed to one guard that reports which case
happened, and re-mutated — it now fails. Found only by the mutation check.

**F25. A rewritten node was never re-classified.** The dialect walk pushed a rewrite's
output straight into the tree, so a heading hoisted out of a blockquote landed unexamined
and uncounted. Now the walk re-queues rewrite output until every node is in the dialect;
`> # Heading` reports `{blockquote: 1, heading: 1}` instead of `{blockquote: 1}`. Caught
by a test I wrote for nesting, not by review.

**F26. The diff (§2.1 item 2) had to be built here, not in chunk 6.** §2.4 step 3 is part
of the sequence this chunk implements, and without it the payload is missing the thing
§2.1 calls "the point of the whole app". Used `diff`, which §5 names. The history view
will reuse `src/diff.js` rather than get its own.

**F27. Table detection is a heuristic, because §0.1 forbids GFM.** Without GFM, remark
parses a Markdown table as a paragraph of pipe-separated text — there is no table node to
find. So tables are detected on the source text by their delimiter row, counted, and
their cells flattened to prose. A paragraph of pipe-separated text sitting above a dashed
line would false-positive. Every other §2.3-named construct is detected structurally.

**F28. The Anthropic SDK is not a §5-named package, so the client is hand-written
`fetch`.** `@anthropic-ai/sdk` would handle retries, timeouts, and error typing for free.
This is the one place I would ask to add a dependency.

**F29. §0.6 says no streaming, and §2.3 says size `max_tokens` from the draft.** Those
pull against each other: a large draft needs a large budget, and a large non-streaming
request risks an HTTP timeout. I capped the budget at 32000 as a compromise. A long draft
plus a slow turn will eventually hit this; streaming is the real fix, and §0.6 rules it
out for v1.

**F30. `stop_reason: "refusal"` is a live case on this model, not a theoretical one.**
§2.3's rule already covers it (anything but `end_turn` → don't commit), and the error
names it specifically. Worth knowing that a benign editing instruction can occasionally
trip a classifier, in which case the human sees an error and their draft is untouched.

## 5. What was NOT verified

- **A real API call.** Nothing in the suite talks to Anthropic. The request shape,
  headers, and model ID are unexercised against the live API — the first real call is the
  first test of them.
- **Timeouts, retries, rate limits.** `fetch` has no timeout here; a hung request hangs
  the endpoint. No retry on 429/5xx.
- **Concurrent edits to one slug.** §0.2 locks the editor client-side, but the server
  will happily run two overlapping `/ai-edit` calls for the same document; the second
  load-modify-save would clobber the first. Single local user, but the server does not
  enforce it.
- **The editor lock itself** (§0.2) — client-side, and there is no client yet (§9 step 7).
- **Prompt-injection via draft content.** A draft containing text that reads as an
  instruction is passed to the model as-is.
- **The shrink guard's keyword heuristic** — `asksForCutting` is a word list; "make this
  less baggy" reads as not asking for cutting and would warn.
- Everything else from chunk-04 §5 stands.
