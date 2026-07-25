# Co-Writing Prototype — Spec for Claude Code

## Concept
A local web app where a human and an LLM collaborate on ONE working draft of a text.
There is exactly one ground truth of the text at all times. Both parties edit it.
Every change is recorded with attribution, and the full history is reviewable at the end.

The problem this solves: in a chat interface, the model regenerates from its own last
output, so human hand-edits are either re-pasted every turn or silently lost. That
produces a lot of changing things back. Here, both parties mutate one shared draft, and
the model always sees the human's most recent edits.

## Operating rules

Read this entire file for integration context before doing anything.

Execute ONLY the chunk named in the prompt. When it is complete, STOP and wait. Do not
begin the next chunk until I say proceed.

Write the chunk report to `reports/chunk-N.md`. In the terminal print only that path and
a one-line status. Do not print the report body — long formatted output arrives corrupted
on my side and I lose the middle of it.

Every report contains:
- what you built, file by file
- what you verified and how, with per-test-group pass counts. Never a bare total.
- the fixture contents alongside those counts, walked item by item against the §5 list
- mutation checks: what you broke, what failed, and the exact failure message
- any change to a shared artifact (the §5 fixture above all) as a named finding, stating
  whether the change was spec conformance or convenience
- anything in the spec that was wrong or underspecified
- what you did NOT verify, named as such

Section 0 decisions are locked. If one seems wrong, say so and stop — do not change it,
and do not write code that depends on changing it. Report the collision before the code
exists, not as a finding afterward.

Never run git. Commits are a human ratification step.

Do not install runtime dependencies beyond the npm packages this spec names.

Test-only devDependencies are permitted when a required test would otherwise
have to measure a stub instead of the real thing. Install with `--save-dev`,
keep every import of it under `test/`, and name it in the chunk report with one
line on why the test could not be written without it. Anything imported from
`src/` still needs my approval first.

Approved so far: jsdom (chunk 1, needed because tiptap-markdown's serializer
requires an Editor instance and an Editor builds a ProseMirror view).

## 🔒 Sandbox

Project root: /Users/julia/hybrid_writing_ide

Create, read, and modify files ONLY inside that directory. Everything above it
is off limits, including sibling project folders — do not read them, do not
list them, do not use them as reference.

Installing npm packages is expected and fine; those write to node_modules and
the npm cache outside this tree. That is the only permitted exception.

If a step seems to require touching anything outside the project root, stop and
say so rather than doing it.

---

## 0. Architecture decisions (LOCKED — do not revisit or optimize these)

These are expensive to reverse. They are decided. If any of them seems suboptimal
during the build, note it and keep going; do not change it unilaterally.

### 0.1 One canonical Markdown dialect
All Markdown entering the snapshot store passes through a single `canonicalize(md)`
function, regardless of whether it came from TipTap or from the model.

Rationale: TipTap's serializer and the model will disagree on trivia (`*` vs `_` for
italic, `-` vs `*` for bullets, trailing whitespace, line wrapping). If two dialects
enter the store, the history view fills with phantom diffs that are pure serialization
artifacts. The history view is the entire product; poisoning it defeats the app.

Implementation: `remark` / `remark-stringify` with pinned options. Do NOT implement
this by round-tripping through TipTap — TipTap needs a DOM, and AI responses must be
normalized server-side before they reach the editor.

Pin at minimum: `emphasis: '*'`, `strong: '*'`, `bullet: '-'`, `listItemIndent: 'one'`,
`rule: '-'`. No GFM extensions (no tables, no strikethrough).

`rule: '-'` is pinned defensively only. Thematic breaks are NOT part of the dialect
(§1, §7) — TipTap has no node for one, so a `---` in the store is content that will
disappear the next time the draft passes through the editor. Keep `---` out of the
shared fixture, and see the out-of-dialect check in §2.3 for what happens when the
model emits one.

**Merge adjacent lists.** An mdast transform runs before stringify and merges adjacent
same-type lists into a single list.

Reason: `remark-stringify` switches to `bulletOther` (`+`) to keep two adjacent lists
visually distinct, which violates `bullet: '-'`. The distinction it is preserving is
unrepresentable end-to-end anyway — Markdown cannot express two adjacent lists, and
TipTap has no way to hold them apart either. Merging makes the store consistent with
what is actually expressible. This is an authorized content change, decided
deliberately, not a normalization side effect.

**Tight lists.** Every list is stringified tight: `spread = false` on the list, never on
its items. Ratified in chunk 1.

This is diff hygiene, not a round-trip requirement. tiptap-markdown preserves tightness
in both directions, so round-trip identity holds with or without the rule. What the rule
prevents is a model flipping a list from tight to loose while changing no words, which
renders in the word diff as every item deleted and re-inserted. That is exactly the
phantom diff §0.1 exists to prevent, and only a global rule catches it — a rule scoped to
the merge would leave tightness depending on whether another list happened to follow.

Unlike the merge above, this discards a distinction TipTap CAN represent. A loose list
written by the model is silently made tight, and that intent is unrecoverable from the
store. Accepted on the grounds that nothing in v1 lets a human ask for a loose list: §1's
formatting list omits it, the editor has no gesture for it, and typed lists come out
tight. The only source of looseness is Markdown the model wrote.

Scope is narrow and load-bearing. Only the list's own spread, never the list items' — an
item holding two paragraphs must keep the blank line between them, or `- para one\n\npara
two` reparses as a single paragraph, which is content corruption.

Required tests:
- **Idempotence:** `canonicalize(canonicalize(x)) === canonicalize(x)` for every
  fixture. Non-negotiable — a non-idempotent normalizer corrupts drafts slowly.
- **Round-trip identity — the property the store actually depends on:**

      canonicalize(tiptapSerialize(tiptapParse(canonical))) === canonical

  Canonical → TipTap → canonical must be byte-identical, for every fixture. This is
  the guarantee that keeps phantom diffs out of the history view: a human turn that
  changed nothing must produce no diff. It is the FIRST item of chunk 2, before any
  other round-trip work.

  Convergence (non-canonical input reaching a fixed point in one pass) is a weaker
  property and does not substitute for this. A function can converge to a fixed point
  that is not the canonical fixture.
- **TipTap is a fixed point, up to escape differences:**
  `canonicalize(tiptapSerialize(doc))` must equal `tiptapSerialize(doc)`
  except for backslash escapes canonicalize *adds*, pinned to exactly
  `_` and `&`, and backslash escapes canonicalize *removes*, pinned to
  exactly `\`.

  The removal case exists because TipTap's serializer escapes a literal
  backslash as `\\` and remark-stringify does not. Round-trip identity
  holds for that construct, so the store is unaffected. The divergence
  is serializer dialect, which is what this test is for.

  These tolerances follow a rule rather than a list. Where TipTap's
  serializer and canonicalize disagree, the difference may be tolerated
  if and only if round-trip identity holds for the same construct,
  proving the store is unaffected, and the difference is pinned to an
  exact named set asserted bidirectionally at the granularity above.
  Anything else fails. Currently pinned: added escapes `{_, &}`,
  removed escapes `{\}`, and the blank line between list items that a
  multi-paragraph item induces.

  Each tolerance describes a normalization canonicalize performs
  deliberately, and each one narrows what this test can catch. The test
  survives only while it still catches marker and list-indent drift.
  That is mutation-verified. If it ever stops, replace it with a direct
  structural assertion on TipTap's output rather than adding another
  tolerance.

  The pin is bidirectional: assert the observed divergence set EQUALS the permitted set,
  not that it is contained by it. A containment check cannot fail when a character is
  added, so the permitted set would silently accumulate dead entries that pre-tolerate a
  future divergence.

  Granularity, for both the added and removed sets: containment per
  case, equality over the union of all cases. Per-case
  equality is impossible, since one canonical block produces only `&` and another only
  `_`. The union form couples this test to the fixture — if the fixture stops exercising
  a permitted character, that is a fixture regression and must fail as one, with a
  message saying which.

  `doc` is derived from canonical input, not raw. The editor is only ever loaded from a
  canonical snapshot (§0.6), and a doc parsed from raw input can hold two adjacent lists,
  which the merge rule above is supposed to collapse.

  Strict byte equality is not achievable here and must not be chased: remark-stringify
  escapes conservatively (`snake\_case\_name`, `?a=1\&b=2`), tiptap-markdown's
  prosemirror-markdown serializer does not, and TipTap exposes no option to change it.
  Do NOT weaken the canonicalizer's escaping to close the gap — narrower hand-rolled
  escaping risks reparsing a literal `_foo_` as emphasis and corrupting a draft. The
  test is kept because it catches marker and list-indent drift from a TipTap upgrade,
  which is what it was reaching for. Round-trip identity above is what makes the
  remaining escape divergence harmless: canonicalize is the last step on the write path.

This test and round-trip identity are not redundant. Round-trip identity stays green
  when the TipTap serializer's dialect drifts, because canonicalize normalizes the drift
  away, and this test catches it. This test stays green when TipTap starts autolinking
  bare URLs at parse time, and round-trip identity catches that. Neither subsumes the
  other; do not delete either as duplicative.

- **No escape accumulation:** run canonicalize ten times over the escaping fixture
  (§5) and assert the output never grows.
- **No `+` bullet ever reaches the store:** the fixture includes two adjacent lists
  (§5); assert canonicalize output contains no `+` list marker.
- **Every list is tight:** assert no list in canonical output is spread. Assert
  separately that a list item holding two paragraphs keeps the blank line between them.

Apply canonicalize at exactly two places: on the write path into the snapshot store,
and on the draft before it is sent to the API (so the model always sees one dialect
and is less inclined to reformat).

### 0.2 The editor is locked while an AI turn is in flight
The request carries draft-at-T. The response lands seconds later and replaces the
working draft. Anything typed in between would be destroyed silently, and the history
would not show it because it was never committed.

v1 behavior: the editor goes read-only with a visible pending indicator from the
moment the AI turn is submitted until it commits or errors. On error, the editor
unlocks and the draft is unchanged.

DO NOT build the race. Do not attempt to merge concurrent human edits into an
in-flight AI response.

### 0.3 History is append-only, with an asserted invariant
Nothing ever mutates or deletes a committed turn. This includes restore: restoring to
turn N appends a NEW human turn whose snapshot is turn N's snapshot.

On every commit, assert:

    history[history.length - 1].snapshot === currentWorkingDraft

Fail loudly (throw, surface in the UI) if it does not hold. This single check catches
most of the bug class where the ledger silently drifts from the text.

### 0.4 Full snapshots, not deltas
Every turn stores the complete draft text. Prose is small; a few hundred snapshots is
a few megabytes. Snapshots are independently valid, while a patch chain fails
catastrophically from one bad link.

This is a decision, not an oversight. Do not "optimize" it into deltas.

### 0.5 Storage shape
- One file per document: `documents/{slug}.json`. Not one global file — the migration
  from one document to many is annoying and costs nothing to avoid now.
- The human supplies the slug when creating a document. Sanitize it (lowercase,
  alphanumeric + hyphens, collapse repeats) and refuse collisions rather than
  silently overwriting. If no slug is given, generate one from a timestamp.
- `schema_version` field present from turn zero.
- Atomic writes: write to `documents/{slug}.json.tmp`, then rename. A crash mid-write
  must not lose the session.

### 0.6 TipTap is a view, Markdown is authoritative
Serialization happens at commit boundaries only, never per keystroke. The API key
stays server-side. No streaming in v1 — whole-draft replacement gains little from it.

---

## 1. Single working draft
- The ground truth of the draft is a canonical MARKDOWN STRING. All snapshots, diffs,
  and AI calls operate on this string.
- The human edits in a WYSIWYG editor (TipTap) that serializes to/from that Markdown
  string. Supported formatting v1: bold, italic, bullet lists, hyperlinks. Nothing
  else.
- Human can type, delete, rearrange, and apply bold/italic/bullets/links directly.

## 2. AI side panel
- A prompt box beside the draft. Human types an instruction (e.g., "tighten the second
  paragraph", "make the tone more formal").
- Model: `claude-sonnet-5`.

### 2.1 What gets sent
1. The canonical current draft.
2. **The word-level diff of the most recent human turn**, if the most recent turn is
   a human turn. Labeled clearly as "the human's most recent hand edits."
3. The instruction.

Item 2 is the point of the whole app. The model receives the current draft on every
call regardless, so it always has current context — that is structural. But it cannot
see *what the human just changed* unless the diff is sent. Without it, "don't undo my
edits" is an instruction the model has no way to follow.

### 2.2 Response contract
The model returns the complete revised draft as raw Markdown and NOTHING ELSE. No
preamble, no commentary, no explanation of what it changed, no code fences. Any
commentary breaks parsing.

### 2.3 Response safety (this is the one bug that loses work)
- Compute `max_tokens` from the current draft size. Do not hardcode a small constant.
- Check `stop_reason`. If it is anything other than `end_turn`, DO NOT commit the turn
  and DO NOT replace the working draft. Surface an error and unlock the editor. A
  truncated response would otherwise be committed as the new draft, with the full text
  surviving only in the previous snapshot.
- Strip surrounding code fences defensively before canonicalizing.
- Reject an empty or whitespace-only response.
- **Soft guard:** if the returned draft is more than 40% shorter than the input and
  the instruction did not ask for cutting, commit it but surface a warning on the turn
  in the history view. `stop_reason` catches hard truncation; a model quietly dropping
  a paragraph still returns `end_turn`.
- **Out-of-dialect construct check.** The model can emit any Markdown it likes —
  headings, tables, blockquotes, code blocks, thematic breaks. All of these are outside
  the v1 dialect (§1, §7). They survive `canonicalize` unharmed and then vanish the
  next time the draft passes through TipTap, which has no node for them. That is
  undetectable content loss: the text is gone from the working draft and nothing in the
  history says so.

  So: parse the AI response and check for constructs outside the dialect (allowed:
  paragraph, bullet list, list item, text, bold, italic, link). Strip the construct
  while keeping its text content — a heading becomes a paragraph, a blockquote's prose
  survives as paragraphs — and record a warning on the turn naming what was stripped.
  Commit the turn; do not reject it. The rule is that loss is *visible*, not that it
  is prevented.

  The warning must name each construct type and its count, e.g. `stripped: 2 headings, 1 blockquote, 1 table`. A generic message is not sufficient. A stripped heading renders in the diff as an ordinary paragraph and a stripped table renders as run-together text, so neither is obvious on a fast read — the warning is the only place that loss is legible. Store the counts as structured data on the turn (e.g. `{"headings": 2, "blockquote": 1}`), not only as a formatted string, so the history view can render them and an export can aggregate them later.

  Also watch here: canonicalize's escapes are visible to the model in the payload
  (`snake\_case\_name`, `?a=1\&b=2`). A model that "tidies" them produces a diff that
  is pure escaping churn. If that shows up in practice, handle it at this layer.

### 2.4 Turn sequence for an AI edit
1. Lock the editor.
2. Commit pending human edits as a human turn (canonicalized). Skip if unchanged.
3. Compute the diff for that human turn, if one was created.
4. Call the API with the payload in 2.1.
5. Validate per 2.3. Strip fences. Canonicalize.
6. Commit the AI turn with the exact prompt string.
7. Assert the 0.3 invariant.
8. Unlock the editor.

Any failure between 4 and 6 leaves the draft at the state after step 2 and unlocks the
editor. The human turn from step 2 stays committed — it represents real work.

## 3. Turn model (edit provenance)

```json
{
  "turn_id": 7,
  "timestamp": "...",
  "author": "human" | "ai",
  "prompt": "exact prompt string (ai turns only)",
  "snapshot": "full canonical text of the draft after this turn",
  "warnings": ["optional, e.g. large-shrink guard fired"]
}
```

Turn boundaries:
- AI turn: one prompt → one revised draft = one turn. Store the exact prompt string.
- Human turn: accumulated direct edits commit as one turn when EITHER
  (a) the human clicks "Checkpoint", OR
  (b) the human submits an AI prompt (see 2.4 step 2).
- If the draft is unchanged since the last turn, don't create an empty turn.

Rule (b) is load-bearing. Verify it explicitly: hand-edit, then prompt, then confirm
the history shows a human turn containing only the hand edits, followed by an AI turn
containing only the model's changes.

## 4. History / review view
- A toggleable timeline listing every turn in order.
- Each entry shows: turn number, author badge (Human / AI), timestamp, the prompt
  string for AI turns, any warnings, and a rendered word-level diff (insertions green,
  deletions red strikethrough) against the previous turn's snapshot.
- **Clicking a turn opens the full draft as of that turn, read-only. Required, not
  optional. The text MUST be selectable and copyable.**

  This is the v1 answer to "scroll up to the version I liked three turns ago and take
  the one sentence that was working." Open the old turn, copy the sentence, paste into
  the current draft, where it commits as an ordinary human turn. No branching, no
  candidate management, no new architecture. The history will not record which turn
  the text came from, but it records that the human did it.

- **"Restore to this turn" on every entry. v1, not a nice-to-have.** Sets the working
  draft to that turn's snapshot and appends a new human turn (never rewrites history).
  Without this, a bad AI turn is destructive.

## 5. Tech constraints
- React frontend. Editor: TipTap with `tiptap-markdown` plus `@tiptap/extension-link`.
  Configure TipTap to allow ONLY bold, italic, bullet-list, and link marks/nodes —
  strip everything else, including on paste. Links serialize as `[text](url)`.

  **Autolink is OFF in v1. Link-on-paste stays on.** Autolink converts a bare URL to
  `[url](url)` when the human types beside it, which lands in a human turn as an edit
  the human did not make. The store holds bare URLs as plain text (no GFM, §0.1), so
  this is a §5 decision resolving against §0.1 rather than a bug to be tested around.
  Do not build a headless input-event test to characterize it.

- Shared test fixture (used by both the canonicalize tests and the round-trip test)
  must include: bold, italic, a bullet list, an inline link, a bare URL, a literal
  asterisk in prose (`a * b`), an underscored identifier (`snake_case_name`), a
  percent sign (`100%`), **two adjacent bullet lists** (the merge rule in §0.1 — truly
  adjacent, nothing between them; a separating paragraph makes the fixture
  non-conformant), and the typographic artifacts of text pasted from Word and from
  Google Docs including pasted hyperlinks.

  Escaping is the failure mode that matters. Backslash escapes accumulating across
  repeated round-trips will corrupt a draft slowly over a long session.

  The fixture should be deliberately non-canonical in places (`_em_`, `__strong__`,
  `*` bullets, wide list indents, trailing whitespace, stacked blank lines) so
  idempotence has real work to normalize instead of passing on already-clean input.

  Deliberately excluded, and not to be added: headings, ordered lists, thematic breaks,
  tables. TipTap has no node for any of them, so their presence would guarantee a
  round-trip failure. They belong to the §2.3 stripper instead.

- **A second fixture, separate from the Markdown one, for HTML clipboard payloads.**
  A `.md` fixture can only carry the *artifacts* of a paste — smart quotes, em dash,
  ellipsis, non-breaking space, curly apostrophes, pasted hyperlinks. It cannot
  exercise TipTap's paste filtering at all, because that operates on the HTML
  clipboard payload. So: a separate fixture holding real HTML copied from Word and
  from Google Docs (including hyperlinks and the span/style noise both produce), fed
  through TipTap's `clipboardTextParser`, asserting everything outside the dialect is
  stripped and the prose plus links survive. Added in chunk 2. Do not treat the
  Markdown artifacts as covering paste behavior.
- Thin Node/Express backend. Persistence per 0.5.
- Diffing: `diff-match-patch` (or the `diff` npm package) with word-level cleanup.
  Diffs are computed on demand from snapshots, never stored.
- One endpoint: `POST /ai-edit {slug, prompt}` → server runs the 2.4 sequence and
  returns the new draft + turn metadata.
- No database, no auth, no multi-user, no CRDT/OT. Single local user.

## 6. AI prompt template (server-side)

System:
"You are collaborating on a text with a human editor. The draft is in Markdown; the
only formatting in use is bold, italic, bullet lists, and inline links (`[text](url)`).
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
explanation of your changes, no code fences."

User: the human-edit diff (if any) + the instruction + the current draft.

Note: the byte-identical rule will only partly hold. That is expected, and it is why
the per-turn diff matters — out-of-scope rewording becomes visible instead of
accumulating silently across passes.

## 7. Explicit non-goals for v1
- Concurrent real-time editing
- Formatting beyond bold/italic/bullet lists/links
- Branching/forking history (the read-only turn view + copy/paste covers recombination)
- Drag-and-drop segment reordering (cut/paste for now)
- Rendered rich-text diffs (Markdown-source diffs are fine; `**` may appear)
- Streaming

## 8. Nice-to-haves if v1 lands quickly
- Per-turn verdict field: `accept` / `reject` / `partial`, plus an optional one-line
  note. Rejection currently leaves no trace — the history shows text changing and
  changing back, not the human judging. The verdict is the scarce signal, since a
  model will call every draft good.
- Session metric: restore-and-redo cycles per thousand words, so "does a shared draft
  reduce churn versus chat" can be answered from data rather than impression.
- Drag-to-reorder paragraph blocks
- Rendered diffs in the history view
- Export history as JSON/markdown report

## 9. Build order
1. `canonicalize()` + its tests per §0.1 (idempotence, fixed point up to escape
   differences, no escape growth, no `+` bullets, every list tight)
2. Round-trip identity FIRST — `canonicalize(tiptapSerialize(tiptapParse(canonical)))
   === canonical` against the shared fixture — then the rest of the round-trip work

   Nested bullet lists, multi-paragraph list items, and mailto links are all
   representable in TipTap and all absent from the shared fixture. Test them before
   extending anything; if one fails in a way that wants a canonicalize-side fix, that
   is a §0.1 collision — report before writing code.
3. Storage layer per 0.5, with the 0.3 invariant assertion
4. Turn model + Checkpoint, **plus `scripts/smoke-session.js`**

   A headless script that drives the store directly (no HTTP, no browser, AI turns
   stubbed with a canned response) through this exact sequence:

   a. create a document with slug `smoke`
   b. commit a human turn (some text with bold, a bullet, and a link)
   c. commit a stubbed AI turn with a known prompt string
   d. commit another human turn (hand edit on top of the AI output)
   e. restore to turn 2
   f. commit another stubbed AI turn

   Then print the full turn list: turn_id, author, prompt string, and the first
   80 characters of each snapshot. Assert the 0.3 invariant after every step, and
   assert that step (e) appended a new turn rather than truncating history.

   This exercises the entire provenance model before any UI exists. Run it after
   every subsequent chunk as a regression check.

5. AI endpoint with the full 2.4 sequence and 2.3 guards, including the out-of-dialect
   construct check
6. HTML clipboard fixture per §5

   Deferred by priority, not dependency — the test is headless and could run now, but
   storage and the turn model are what stand between here and a runnable smoke session.
7. History view: diffs, read-only turn view, restore
8. Everything else

Do not proceed past step 1 until the canonicalize tests pass. Everything downstream
depends on one dialect being real.

A note on the tests: a passing test proves nothing if its fixture is empty. An
idempotence test over a fixture with no formatting, no escapes, and no links will pass
and demonstrate nothing. Every test in chunks 1 and 2 must run against the shared
fixture in §5, and the fixture must be visible in the repo as its own file rather than
inlined per test. The reporting requirements that follow from this live in Operating
rules above.
