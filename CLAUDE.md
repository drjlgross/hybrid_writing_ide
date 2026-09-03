# Co-Writing Prototype — Spec for Claude Code

## Concept
A local web app where a human and an LLM collaborate on ONE working draft of a text.
There is exactly one ground truth of the text at all times. Both parties edit it.
Every change is recorded with attribution, and the full history is reviewable at the end.

The problem this solves: in a chat interface, the model regenerates from its own last
output, so human hand-edits are either re-pasted every turn or silently lost. That
produces a lot of changing things back. Here, both parties mutate one shared draft, and
the model always sees the human's most recent edits.

**Success metric (added 2026-09-02):** zero turns spent typing copy edits the human
could make herself, and zero whole-draft pastes. Both are taxes paid in a chat box to
keep the pen; the shared draft plus turn-level snapshots is what removes them. A hand
edit that enters as a hand edit is a turn that never had to happen.

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
requires an Editor instance and an Editor builds a ProseMirror view); playwright
(2026-09-03, needed because jsdom has no layout engine, so every geometric claim
about the §12 surface is otherwise measured against a stub — scope is fixed by
the Headless browser subsection of the Sandbox rules below).

## 🔒 Sandbox

Project root: /Users/julia/hybrid_writing_ide

Create, read, and modify files ONLY inside that directory. Everything above it
is off limits, including sibling project folders — do not read them, do not
list them, do not use them as reference.

Installing npm packages is expected and fine; those write to node_modules and
the npm cache outside this tree. That is the only permitted exception.

If a step seems to require touching anything outside the project root, stop and
say so rather than doing it.

### Headless browser (test-only)

Playwright is an approved test-only devDependency. It exists for one thing:
seeing the app as it actually renders. jsdom has no layout at all, so every
geometric fact the §12 surface depends on is otherwise unverified — the chunk-08
bug, where history spanned `1 / -1` and slid under the sticky rail covering every
Restore control, is exactly the class jsdom cannot see and a browser assertion
pins permanently.

**This is a standing capability, not a per-request permission.** Use it whenever
rendered reality would inform the work: verifying a layout claim before reporting
it, checking that a UI change looks right, reproducing a visual bug. Do not ask
first — the scope bullets below are the entire constraint.

Ad-hoc verification is throwaway and lives in scratch or `.tmp-test/`. Committed
artifacts — test files, the `test:browser` script — arrive only in chunks that
name them, per the one-chunk-at-a-time rule above.

Scope, and nothing beyond it:

- Browsers install **inside the project**, at
  `node_modules/playwright-core/.local-browsers`. `PLAYWRIGHT_BROWSERS_PATH=0` is
  what puts them there and must stay set wherever they are installed or launched.
  No machine-wide cache is read or written. Deleting `node_modules` deletes the
  browsers.
- The one-time download from `cdn.playwright.dev` is the only outbound network
  this grants.
- Whenever it runs, the browser talks to `127.0.0.1` and nothing else, on an
  ephemeral port served by this repo's own server. Navigating to a public URL is
  out of scope; if it ever seems necessary, stop and say so.
- Scratch — browser profile, screenshots, ad-hoc verification scripts — goes to
  `.tmp-test/` or the session scratchpad, both disposable and both gitignored.
  Nothing is written outside the project root.
- Every **committed** import of `playwright` stays under `test/`. Throwaway
  scripts are fine anywhere disposable; what this bans is a deploy dependency.
- The browser never sees `ANTHROPIC_API_KEY` or a real capability token. It runs
  against a scratch document root with a dummy key, never the real `documents/`.
- Browser tests run from their own `npm run test:browser`, not from `npm test`.
  `npm test` stays hermetic: a fresh clone with no browser binary must still pass
  it. The script arrives with the chunk that writes the first layout assertion.

This is a development capability and must not become a deploy dependency: nothing
in `src/` or `scripts/` may import it.

---

## 0. Architecture decisions (LOCKED — do not revisit or optimize these)

These are expensive to reverse. They are decided. If any of them seems suboptimal
during the build, note it and keep going; do not change it unilaterally.

Decisions 0.7–0.11 were ratified on 2026-09-02, derived from four records of real
human-AI writing work. The evidence behind them lives outside the repo; what survives
here is the decision. They are as locked as 0.1–0.6. Where they amend an earlier
decision, the amendment is marked inline rather than by silent replacement.

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
`rule: '-'`, `resourceLink: false`. No GFM extensions (no tables, no strikethrough).

`resourceLink: false` means a link whose text equals its destination stores as the
autolink shorthand `<url>` rather than `[url](url)`; ratified chunk 8, after chunk 7's
report-only investigation found it arriving as a remark default rather than a decision.
It is the spelling a paste produces, so it is the most common link in the store, and
§5's fixture now pins it. A BARE url — one that was never a link — is untouched by this
and stays plain text, because there are no GFM autolink literals.

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

**AMENDED 2026-09-02: three states, not two.**

The request carries draft-at-T. The response lands seconds later. Anything typed in
between would be destroyed silently, and the history would not show it because it was
never committed.

The editor moves through exactly three states:

1. **`locked`** — from the moment an AI turn is submitted until the response validates
   or errors. Read-only, visible pending indicator. On error, the editor unlocks and
   the draft is unchanged.
2. **`disposition`** — the response arrived carrying candidate edits (§0.8). The editor
   is scoped to those candidates: each one may be accepted, rejected, or hand-modified,
   and nothing else in the document is editable. Abandoning this state leaves the draft
   unchanged and logs every candidate rejected.
3. **`unlocked`** — normal hand editing, everywhere in the document.

A response with zero candidates goes `locked` → `unlocked` directly; the
`disposition` state opens and closes in the same instant and is not shown.

DO NOT build the race. Do not attempt to merge concurrent human edits into an
in-flight AI response. Do not attempt to rebase a staged candidate onto a draft that
changed underneath it — the `disposition` state exists precisely so that cannot
happen.

### 0.3 History is append-only, with an asserted invariant

**AMENDED 2026-09-02: entries append automatically for speech and proposal turns.**

Nothing ever mutates or deletes a committed turn. This includes restore: restoring to
turn N appends a NEW human turn whose snapshot is turn N's snapshot.

On every commit, assert:

    history[history.length - 1].snapshot === currentWorkingDraft

Fail loudly (throw, surface in the UI) if it does not hold. This single check catches
most of the bug class where the ledger silently drifts from the text.

The amendment: a turn now appends without a Checkpoint in two further cases — a
speech-only turn (zero candidates; the snapshot carries the prior text unchanged) and
a proposal turn (see §0.9 for the two snapshots it writes). Checkpoint remains the
human's ratification of the *draft*. It was never a ratification of the *record*, and
the record now grows on its own.

Consequence, stated so nobody optimizes it away: **the ledger is not a lineage of
endorsed drafts.** It contains text the human never endorsed, deliberately. "Number of
turns" is not "number of drafts" and no feature should treat it as one.

### 0.4 Full snapshots, not deltas
Every turn stores the complete draft text. Prose is small; a few hundred snapshots is
a few megabytes. Snapshots are independently valid, while a patch chain fails
catastrophically from one bad link.

This is a decision, not an oversight. Do not "optimize" it into deltas.

### 0.5 Storage shape
- One file per document: `documents/{slug}.json`. Not one global file — the migration
  from one document to many is annoying and costs nothing to avoid now.
- Documents are namespaced by a capability token:
  `documents/{token}/{slug}.json`. A token is an unguessable string
  handed to one person as part of their URL. There is no login and no
  account; the token IS the identity, and anyone holding the link has
  full access to that namespace. This is a filing system for a small
  group of known people, not access control, and it must be described
  that way to anyone given a link. Slugs collide only within a
  namespace. Local single-user development uses a fixed default token.
- Tokens are crypto-random, 32 hex characters, generated with
  `node:crypto`. Reject any token that is not exactly 32 hex characters
  rather than sanitizing it — a sanitized `../../etc` is a path
  traversal. No endpoint lists namespaces or reads across them.
- The server resolves the namespace in exactly one function. No handler
  reads the token directly. Replacing capability tokens with real
  accounts must be a change to that function and nothing else.
- A document is addressed as `/t/{token}/{slug}`. A missing slug
  resolves to a default document in that namespace.
- The human supplies the slug when creating a document. Sanitize it (lowercase,
  alphanumeric + hyphens, collapse repeats) and refuse collisions rather than
  silently overwriting. If no slug is given, generate one from a timestamp.
- `schema_version` field present from turn zero.
- Atomic writes: write to `documents/{slug}.json.tmp`, then rename. A crash mid-write
  must not lose the session.

Context files (§8) and standing rules (§10) live inside the document's own JSON,
inside the same namespace, and are subject to every rule above.

### 0.6 TipTap is a view, Markdown is authoritative
Serialization happens at commit boundaries only, never per keystroke. The API key
stays server-side. No streaming in v1 — whole-draft replacement gains little from it.

---

### 0.7 The model may speak, and its speech is recorded

**Amends §2.2, which forbade commentary.**

§2.2's old contract — revised draft and nothing else — was a parsing decision that
hardened into a behavioral one. The evidence says speech is the majority of useful
output: comprehension questions that never touch the draft, synthesis, reasoned
disagreement, audit verdicts, naming what the writer is circling. A tool where every
AI turn must return a revision cannot host most of what works.

So: **every AI turn returns a note. A revision is optional.**

Speech is recorded in the ledger alongside the turn's snapshots (§0.9), not in a
side-channel. It is never blended with applied text changes in the UI — speech renders
in the panel, text renders in the draft (§12). That separation is a rendering rule and
storing them in one record does not violate it.

What speech is for, so the prompt template can be scoped: synthesis, reasoned
disagreement, explanation, audit verdicts, process diagnosis, and naming a pattern the
writer has not named. Not flourish, and not narration of what the candidates already
show.

### 0.8 Proposed edits are staged, never applied on arrival

An AI turn does not replace the working draft. It returns **candidates**: proposed
edits anchored to spans of the current draft, each with the reasoning that produced
it. The human accepts, rejects, or hand-modifies each one (a modification records as a
rejection plus the human's replacement), and only then does anything land in the draft.

**A turn is review-only if and only if no candidate was accepted.** That is a
classification made after reading, not a mode chosen before prompting — the writer
does not reliably know in advance which kind of turn she is in, and a mode toggle
makes her guess.

Reject-all is a single action and restores the draft as it stood before the turn.
Walking candidate-by-candidate through a proposal already dismissed is the
buried-permission-dialog failure this whole design exists to avoid.

Hand-modifying the text a candidate is anchored to invalidates that candidate, logged
rejected — accurate, since the human preferred her own. Free hand editing everywhere
resumes the instant the disposition phase closes, in the same working session, before
the next prompt.

### 0.9 A proposal turn writes two snapshots, both automatic

1. **`proposal`** — every candidate applied, before disposition. Text the human never
   endorsed, retained deliberately: rejected model prose is sometimes wanted back, and
   reject-all becomes a recorded event rather than a non-event.
2. **`disposed`** — accepted candidates in, rejected candidates out, written when the
   disposition phase closes.

Neither requires a Checkpoint. Both are full snapshots per §0.4.

A speech-only turn is the degenerate case: zero candidates, both snapshots equal to
the prior text. **The unchanged snapshot is a positive assertion that the model touched
nothing**, which is stronger than the absence of a record.

**A turn is no longer attributable to a single party.** A modified-accept is the human
taking the part of an edit that landed and correcting the rest — that is one move, not
two, and it has no single author. The ledger records *dispositions*, not authorship.
The `author` field survives for human turns and speech-only turns; for proposal turns
it is `mixed` and the dispositions carry the real information.

### 0.10 Context is human-curated and discardable

Context attaches to the *document*, not to a turn, and **adding or describing context
never triggers an AI turn.** Supplying context and asking for an edit are different
acts; conflating them produces an unrequested rewrite, which is the single failure the
evidence shows most reliably destroying trust in a co-writing tool.

Context never accumulates automatically. Discarding it — one file, or all of it, or
the rolling conversation window — is a first-class operation, not a session restart.
Two of the three long records analyzed destroy context *on purpose* to get their best
output: an audit that must not reuse its own earlier conclusions, and a cold read that
works by clearing history. A design that only accrues optimizes against the
highest-value move in the corpus.

### 0.11 Standing rules are per-document, resolved in one function

A standing rule is a correction promoted to a durable instruction. Three routes in,
all landing in the same store: the human states it, the human accepts a model
proposal, or the model raises a candidate on the **second** occurrence of the same kind
of correction.

Rules are per-document in v1. **The store is resolved in exactly one function**, in the
same spirit as §0.5's namespace resolution and for the same reason: a later per-user
default layer — one writer's standing "no em-dashes" applying to every new document —
must be a change to that function and nothing else. No nesting, no precedence logic,
no inheritance in the MVP. This is a seam, not a feature.

Every rule carries a **scope**, defaulting to the artifact class the correction was
about. A correction about caption wording becomes a rule about captions, not a rule
about the model's behavior in general. Over-generalized rules suppress the case where
the model refusing the human's frame is the right answer.

---

## 1. Single working draft
- The ground truth of the draft is a canonical MARKDOWN STRING. All snapshots, diffs,
  and AI calls operate on this string.
- The human edits in a WYSIWYG editor (TipTap) that serializes to/from that Markdown
  string. Supported formatting v1: bold, italic, bullet lists, hyperlinks. Nothing
  else.
- Human can type, delete, rearrange, and apply bold/italic/bullets/links directly.

## 2. AI side panel

- A prompt box beside the draft. The human types an instruction, a question, or both.
- Model: `claude-sonnet-5`.

### 2.1 What gets sent

1. The canonical current draft.
2. **The word-level diff of the most recent human turn**, if the most recent turn is
   a human turn. Labeled clearly as "the human's most recent hand edits."
3. The instruction.
4. **Document context** (§8): each attached file, with the human's description of
   what it is and why it is here. Images are sent for the model to read.
5. **Standing rules** (§10), with their scopes.
6. **The rolling conversation window** (§11): the last N exchanges of speech, so a
   question can build on the answer before it.

Item 2 is the point of the whole app. The model receives the current draft on every
call regardless — that is structural. But it cannot see *what the human just changed*
unless the diff is sent. Without it, "don't undo my edits" is an instruction the model
has no way to follow.

Items 4–6 are what make the first turn good. They are setup, not a per-turn tax:
attached once, described once, and carried automatically thereafter.

### 2.2 Response contract

**REPLACES the old contract (revised draft and nothing else), per §0.7.**

The response is a JSON object and nothing else — no preamble, no code fences:

```json
{
  "note": "prose addressed to the human. Markdown, dialect-conformant.",
  "segments": [
    {"id": "s1", "took": "what the model read this part of the prompt to be asking",
     "kind": "edit" | "question" | "context" | "reframe"}
  ],
  "candidates": [
    {"id": "c1", "segment_id": "s1",
     "anchor": "exact existing draft text this replaces",
     "replacement": "proposed text",
     "why": "one line",
     "contingent_on": "s2 | null"}
  ]
}
```

`candidates` may be empty. That is a speech-only turn and it is a first-class outcome,
not a failure.

**`segments` is the model's decomposition of the prompt, stated before acting.** Real
prompts are multi-part — a copy edit, a factual question, a reframe, and a piece of
context can arrive in one message — and the model already performs this segmentation
internally and then discards it. Surfacing it costs a few lines the human reads
anyway, and it catches the failure that hurts: a question read as an edit rewrites the
draft.

Questions are answered in `note` **before** any candidate that depends on them.
`contingent_on` names that dependency so a candidate resting on an unchecked answer is
visibly contingent rather than silently resolved.

**Interim contract for chunks 10–11, before staging exists.** Until §0.8 is built, the
response carries `note` and `segments` plus a `draft` field holding the complete
revised Markdown, which commits as an AI turn exactly as today. `candidates` arrives
with chunk 12 and `draft` is removed in the same chunk. Build the interim shape so it
is a field swap, not a rewrite.

### 2.3 Response safety (this is the one bug that loses work)

*(All existing guards stand: `max_tokens` computed from draft size; `stop_reason`
checked and anything but `end_turn` refused; defensive fence stripping; empty response
rejected; the 40% shrink soft guard; the out-of-dialect construct check with structured
per-construct counts.)*

**Extended 2026-09-02:**

- The guards apply to **each candidate's `replacement`**, not only to a whole draft.
  A candidate carrying an out-of-dialect construct is stripped and warned per the
  existing rule; a candidate failing validation is dropped with a warning on the turn
  and the rest of the proposal still stands.
- `note` is prose for a human, not draft text. It is not canonicalized into the draft
  and never reaches TipTap. It must still be checked for length and for the fence
  artifacts the parser cares about.
- **Anchor resolution.** A candidate's `anchor` must match the current draft exactly
  and exactly once. Zero matches or more than one is a dropped candidate with a named
  warning — never a guess, never a fuzzy match. Ambiguity here would silently edit the
  wrong sentence, which is the §2.3 failure class.
- Malformed JSON is a failed turn: surface the error, unlock the editor, draft
  unchanged. Do not attempt partial recovery.

### 2.4 Turn sequence for an AI turn

1. Lock the editor (`locked`).
2. Commit pending human edits as a human turn (canonicalized). Skip if unchanged.
3. Compute the diff for that human turn, if one was created.
4. Call the API with the payload in 2.1.
5. Validate per 2.3. Parse. Resolve every anchor.
6. Write the `proposal` snapshot (§0.9) and append the turn record with `note`,
   `segments`, and all candidates marked undisposed.
7. Enter `disposition`. The human accepts, rejects, or hand-modifies each candidate.
8. On close: apply accepted candidates, write the `disposed` snapshot, record every
   disposition on the turn.
9. Assert the 0.3 invariant.
10. Unlock the editor.

Any failure between 4 and 6 leaves the draft at the state after step 2 and unlocks the
editor. The human turn from step 2 stays committed — it represents real work.

Abandoning step 7 (reject-all, or navigating away) closes the phase with every
candidate rejected; the `disposed` snapshot then equals the state after step 2.

## 3. Turn model (edit provenance)

```json
{
  "turn_id": 7,
  "timestamp": "...",
  "author": "human" | "ai" | "mixed",
  "prompt": "exact prompt string (ai turns only)",
  "note": "the model's speech (ai turns only)",
  "segments": [ ... ],
  "candidates": [
    {"id": "c1", "segment_id": "s1", "anchor": "...", "replacement": "...",
     "why": "...", "contingent_on": null,
     "disposition": "accepted" | "rejected" | "modified",
     "human_replacement": "text the human wrote instead (modified only)"}
  ],
  "snapshot_proposal": "full canonical text with every candidate applied",
  "snapshot": "full canonical text after disposition — the draft as it now stands",
  "context_ref": ["file ids in scope for this turn"],
  "rules_ref": ["rule ids in scope for this turn"],
  "warnings": ["optional, e.g. large-shrink guard fired, candidate c3 anchor ambiguous"]
}
```

`snapshot` keeps its existing name and meaning — the draft after this turn — so the
§0.3 invariant assertion is unchanged. Human turns carry `snapshot` only.

Turn boundaries:
- **AI turn:** one prompt → one note, zero or more candidates, one disposition phase =
  one turn. Store the exact prompt string.
- **Human turn:** accumulated direct edits commit as one turn when EITHER the human
  clicks Checkpoint, OR the human submits a prompt (2.4 step 2).
- If the draft is unchanged since the last turn, don't create an empty human turn.
  An AI turn always commits, even when it changed nothing. **A speech-only turn is
  not an empty turn** — the prompt and the note are provenance, and a question that
  changed no text is a real fact about the session.

Rule (b) is load-bearing. Verify it explicitly: hand-edit, then prompt, then confirm
the history shows a human turn containing only the hand edits, followed by an AI turn
containing only the model's changes.

**Also verify explicitly (added 2026-09-02):** hand-edit, Checkpoint, then prompt the
model to comment on the change just made. The history must show a human turn carrying
the edit, then an AI turn with a note, zero candidates, and an unchanged snapshot.
This is the workflow's terminal move and it is the cheapest end-to-end test of §0.7
and §0.9 together.

## 4. History / review view
- A toggleable timeline listing every turn in order.
- Each entry shows: turn number, author badge (Human / AI / Mixed), timestamp, the
  prompt string for AI turns, any warnings, and a rendered word-level diff (insertions
  green, deletions red strikethrough) against the previous turn's snapshot.
- Clicking a turn opens the full draft as of that turn, read-only, selectable and
  copyable.

  This is the v1 answer to "scroll up to the version I liked three turns ago and take
  the one sentence that was working." Open the old turn, copy the sentence, paste into
  the current draft, where it commits as an ordinary human turn. No branching, no
  candidate management, no new architecture. The history will not record which turn
  the text came from, but it records that the human did it.

- "Restore to this turn" on every entry: sets the working draft to that turn's snapshot
  and appends a new human turn, never rewriting history. Without this, a bad AI turn is
  destructive. Restoring to a turn the draft already matches creates no turn, per the
  no-empty-turn rule, and the UI must not report a restore that did not happen.

**Extended 2026-09-02:**

- An AI turn renders its `note` as speech, visually distinct from any text change.
  Never blended.
- A proposal turn renders three things: what the model proposed
  (`snapshot_proposal`), what the human kept (`snapshot`), and the per-candidate
  dispositions. The diff between the two snapshots is the record of what was rejected.
- A speech-only turn renders as a note with an explicit "no change to the draft"
  marker. It must not look like a rendering failure.
- **The history view is the only scrollback.** The panel shows the current turn only
  (§12), so reaching a note or a rejected candidate from earlier in the session
  happens here.
- **Export transcript**: the full ledger as JSON, from a button in the top row (§12).
  This replaces the raw-JSON link.

  The wrapper is pinned here rather than left to the implementation, resolving F49
  (chunk 10 invented a shape because §4 gave none):

      {
        "schema_version": 1,
        "slug": "...",
        "exported_at": "ISO 8601",
        "turns": [ ... the ledger verbatim, per §3 ... ]
      }

  `schema_version` is the SAME constant §0.5 requires on every stored document, not
  a second one — an exported file outlives the app version that wrote it by more,
  not less, than the stored one does, so it wants the same protection. Its presence
  is asserted on the exported FILE, not only in the code that writes it: the only
  thing a later reader ever sees is those bytes. `slug` because a file named
  `draft-transcript.json` in a folder of them is not self-identifying once it is
  out of the app; `exported_at` because §11's K4 turns on reconstructing when
  something was looked at. `turns` is the ledger verbatim — full snapshots per §0.4,
  no diffs, since diffs are computed from snapshots and never stored (§5). The
  model's speech goes with it, because the note is a field on the turn (§0.7),
  which is what §9's S13 means by the conversation having the ledger's durability.

## 5. Tech constraints
- React frontend. Editor: TipTap with `tiptap-markdown` plus `@tiptap/extension-link`.
  Configure TipTap to allow ONLY bold, italic, bullet-list, and link marks/nodes —
  strip everything else, including on paste. Links serialize as `[text](url)`.

  **Autolink is OFF in v1. Link-on-paste stays on.** Autolink converts a bare URL to
  `[url](url)` when the human types beside it, which lands in a human turn as an edit
  the human did not make. The store holds bare URLs as plain text (no GFM, §0.1), so
  this is a §5 decision resolving against §0.1 rather than a bug to be tested around.
  Do not build a headless input-event test to characterize it.

- **Shared Markdown fixture**, used by both the canonicalize tests and the round-trip
  test. It is a file in the repo; read it rather than reconstructing its contents from
  here. Every item in it is load-bearing — bold, italic, lists, links, bare URLs,
  escape-triggering characters, adjacent lists for the §0.1 merge rule, a self-titled
  link for the `resourceLink: false` pin, and paste artifacts from Word and Google
  Docs — and it is deliberately non-canonical in places so idempotence has real work to
  do. Do not remove an item without saying so as a named finding.

  Escaping is the failure mode that matters. Backslash escapes accumulating across
  repeated round-trips will corrupt a draft slowly over a long session.

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
  stripped and the prose plus links survive. Do not treat the Markdown artifacts as
  covering paste behavior.
- Thin Node/Express backend. Persistence per §0.5.
- Diffing: `diff-match-patch` (or the `diff` npm package) with word-level cleanup.
  Diffs are computed on demand from snapshots, never stored.
- No database, no auth, no multi-user, no CRDT/OT. Single local user.

**Extended 2026-09-02:**

- Endpoints. The existing `POST /ai-edit` becomes the turn-initiating call and returns
  the parsed response plus the turn record. Disposition is a second call that closes
  the phase and writes `snapshot`. Context and rules are their own CRUD endpoints and
  **must not initiate a turn** (§0.10). All of them namespaced per §0.5.
- **Image context.** Attached images are sent to the model to read. This is the near-
  default case, not the exception: formatted material — a post, an email chain, a Slack
  thread, a slide — reaches a model fastest as a screen capture. Extraction failure is
  surfaced on the chip, never a silent degradation to an unread attachment.
- A third fixture: a small context bundle (one text file, one screenshot) used to test
  that context is assembled into the payload, survives a turn, and is not consumed by
  it.

## 6. AI prompt template (server-side)

**REWRITTEN 2026-09-02 for §0.7 and §0.8.**

System:

"You are collaborating on a text with a human editor. The draft is in Markdown; the
only formatting in use is bold, italic, bullet lists, and inline links (`[text](url)`).
Do not introduce headings, tables, or other Markdown constructs. Preserve existing
links unless the instruction says otherwise.

You will receive the current complete draft, optionally a diff showing the human's most
recent hand edits, any context files the human has attached with her descriptions of
them, any standing rules she has set, the recent conversation, and her message.

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

Return ONLY the JSON object described in the contract. No preamble, no code fences."

User: the context files and their descriptions + the standing rules + the recent
conversation + the human-edit diff (if any) + her message + the current draft.

Note: the leave-it-alone rule will only partly hold. That is expected, and it is why
the per-turn diff and the per-candidate anchors matter — out-of-scope rewording becomes
visible instead of accumulating silently across passes.

## 7. Explicit non-goals for v1
- Concurrent real-time editing
- Formatting beyond bold/italic/bullet lists/links
- Branching/forking history (the read-only turn view + copy/paste covers recombination)
- Drag-and-drop segment reordering (cut/paste for now)
- Rendered rich-text diffs (Markdown-source diffs are fine; `**` may appear)
- Streaming
- **Rebasing a staged candidate onto a changed draft** (§0.2 — the disposition state
  exists so this case cannot arise)
- **Multi-level standing rules** — per-user or per-namespace defaults, precedence,
  inheritance (§0.11 leaves the seam and nothing else)
- **Screenshot-as-feedback**: pointing at a location in a rendered artifact. Selection
  plus the §4 diff covers this for text. Screenshot-*as-source* is in scope and
  required (§8).
- Multimodal artifact output

Backlog: `docs/backlog.md`. Not needed to build a chunk.

## 8. Context and file upload

Locked behavior is in §0.10.

- **C1** Files attach to a **document**, not to a turn. Text and images both.
- **C2** Each file carries a freeform human-written description: what it is, why it is
  here. Not a taxonomy, not a dropdown. The same document can be a tone reference,
  source material, or a scaffold, and which one it is cannot be inferred from the file.
- **C2a** The description is **pre-populated from the prompt** where the human stated
  it inline, because that is how it actually arrives ("look to these for length and
  tone, not content"; "for color, here is what they said"). She edits or clears it.
  A blank description field per file is a tax that will not be paid.
- **C3** Images are first-class context input and **the model reads them to extract
  content**. Near-default case, not the exception. Extraction failure surfaces on the
  chip.
- **C4** Adding or describing context does not trigger a turn (§0.10).
- **C5** Context is discardable individually and wholesale, as a first-class operation.
- **C6** Some context is irreducibly per-turn and that is fine: the writer's own domain
  knowledge, corrections, and the reasons attached to instructions. Do not build
  anything that tries to front-load these.

## 9. Conversation channel

Locked behavior is in §0.7 and §0.8.

- **S1** Every turn returns a note. A revision is optional.
- **S2** The model states its decomposition before acting; questions answered first;
  contingent candidates named (§2.2).

  **Provisional.** S2 was derived from prompts written in a chat box with no editor,
  where a single message had to carry copy edits the writer could not make herself. Once
  hand editing is real those prompts may stop being multi-part, and the decomposition
  may have little left to decompose. Re-justify against actual use before building it.
- **S3–S6** Candidates staged and span-anchored; disposition phase; reject-all as one
  action; free hand editing resumes at phase close. (§0.8)
- **S7** A speech-only turn is the degenerate case, not a special case. (§0.9)
- **S8** A prompt can reference a checkpoint or the diff between two snapshots —
  "weigh in on the change I just made."
- **S9** Every candidate is logged with its disposition. A rejected candidate is the
  cheapest available standing correction and it is produced by an action the human
  takes anyway.
- **S10 Silence-decay.** A model-volunteered observation repeated across turns with no
  human reaction is dropped.
- **S11 Pattern watch.** A *correction* repeated across turns escalates: on the second
  occurrence the model proposes a standing rule **and** makes the correction; on the
  third and after it keeps making it as a one-off until the rule is accepted or
  dismissed. Proposing is never a reason to withhold the fix.
- **S12** Speech and edits are visually distinct records. The UI never blends them.
- **S13** The conversation log has the same durability guarantee as the ledger,
  because it is in the ledger.

The asymmetry between S10 and S11 is deliberate: model-volunteered observations earn
decay, human corrections earn escalation.

**Anti-requirements.** No mode toggle — the human does not know in advance whether a
turn is review-only. Supplying context never triggers a rewrite. No modal or overlay
hides the editor during a turn. A marked hole in the human's own prose ("I'm struggling
with the word here") is not necessarily a slot to fill; refusing her frame is
legitimate where she has not staked a position, and this is exactly where generation
earns its keep.

## 10. Standing rules

Locked behavior is in §0.11. The two halves ship in different chunks.

**Human-written rules (step 12).** A bullet list the human edits directly in the
Standing Rules box, persisted in the document JSON alongside context files, injected
into the §2.1 payload with its scope. Editing the list never triggers a turn (§0.10).
Rules are individually revocable and visible in one place. This is the whole feature
for a human who knows what her rules are — "no em-dashes," "open on the biology, not
the pipeline" — and it needs no detection logic of any kind.

**Model-proposed rules (step 16, provisional).** The third route in: on the second
occurrence of the same kind of correction the model proposes a rule *and* makes the
correction; on the third and after it keeps making it as a one-off until the rule is
accepted or dismissed (S11). Paired with silence-decay on model-volunteered
observations the human ignores (S10). Blocked on F46.

Build the store so the source of a rule — `human` or `proposed` — is a field on the
rule, not a separate collection. Step 16 then adds a writer and a proposal state, not a
second store.

Human-written rules are also the first point at which a stated rule can be *measured*:
set "no em-dashes," run turns, watch whether the output changes. Whether standing
instructions work at all is an open empirical question, and the answer should exist
before staging designs candidates against rules nobody has tested.

## 11. Session continuity

- **K1** A rolling conversational window of recent exchanges, bounded (F44).
- **K2** The window is discardable on command. **The cold read is a first-class
  operation**, not a session restart: clearing history and asking one open question is
  the highest-hit-rate move in the analyzed corpus.
- **K3** The durable context store (§8) and the standing rules (§0.11) are separate
  from the window and survive discarding it. Rules persist; conversation decays.
- **K4** Ledger timestamps support reconstruction after the fact: "accepted at turn 72,
  after six hours, from a model-generated batch, minimally revised" is a different fact
  from "accepted at turn 72," and the ledger already holds what is needed.
- **Anti-requirement:** no session-boundary ritual. Anything the human must do to close
  a session well is bookkeeping and will not happen at 9pm.

## 12. Panel and editor surface

The division is load-bearing: **speech lives in the panel, edits live in the draft.**

**Top row**, lilac buttons, in this order:
Show/hide history · **document name** (opens a switcher) · **+ New document** ·
**Export transcript** · **Checkpoint**.

Checkpoint carries the uncommitted-edits signal in the button itself — marked when hand
edits are unratified, quiet when clean. That is why the separate status row can go
without losing anything load-bearing.

**Left:** the editor.

**Right column**, three boxes, same paper treatment, top to bottom.

**Every box renders a white content surface at all times**, whether or not it has
content — the Prompt's textarea, and the same surface in the other two. Matching
anatomy: same white, same border, same radius, same padding, declared once so the
three cannot drift apart. Empty-state text renders **inside** the surface, in the
muted colour, the way a textarea's placeholder sits inside the textarea; it never
stands in place of the surface. The rail therefore reads as three parallel boxes at
first paint, before anything has happened. Added 2026-09-03, replacing the narrower
rule that only the Model Response note wore a surface.

1. **Prompt** — textarea; attached-file chips persisting across submits, each carrying
   its editable description; **`+` bottom-left** for add-a-file, **Submit** bottom-right
   in forest green. Drag-and-drop onto the box if it can be had cheaply. Chips remain
   visible between turns so it is evident context is still attached and was not consumed
   by the last submit.
2. **Model Response** — empty by default, populates as the model responds. **A new
   prompt overwrites it.** Prior responses live in the ledger and are reached through
   history.

   The note renders on the box's content surface, per the rule above. It holds
   SPEECH and only speech (§0.7): the §2.3 validation warnings are the system
   reporting on a turn, not the model talking, and they stay in the Prompt box
   beside the control that caused them. Blending the two would be exactly the
   failure §9's S12 forbids.
3. **Standing Rules** — bullet list, blank by default, human-editable in place, model
   proposals appearing here per S11.

**§0.5's capability disclosure stays on the surface**, in the header, visible without
a click — not inside the switcher drawer, and not inside any other drawer or menu.
Resolves F51, 2026-09-03. §0.5 requires that a namespace "be described that way to
anyone given a link", and a disclosure someone has to go looking for cannot do the one
job it has: stopping a person from treating a capability URL as private. Step 14 is
deploy, and real people will be holding real links.

**Removed:** the Documents panel (creation and switching move to the top row) and
everything below the horizontal separator — document name, turn count, uncommitted-edits
row, stored-file link.

**Button semantics:** lilac = global and navigation controls (top row); forest green =
the primary action inside a box (Submit). New controls inherit from that split rather
than accumulating a third treatment. Check lilac for contrast against the cream ground
before shipping it.

**Candidates render in the draft, not in the panel**, anchored to their spans, with
accept / reject / edit-in-place controls sitting with each candidate — visible without
hunting, never a dialog that can be dismissed into auto-allow. The panel says what the
model thought; the editor shows what it proposes to do. A candidate is never described
in prose in the panel as a substitute for showing it, and **the panel never restates the
draft** — pasting revised text into the response box would reintroduce exactly the
whole-draft paste the success metric exists to eliminate.

Pending state: an indicator in the panel, the editor locked, the draft fully visible.
No modal, no overlay, no full-screen graphic.

## 13. Open items

Existing: **F28** (SDK not adopted; the fetch carries an `AbortSignal.timeout`
instead — open by choice). **F37** (token decision — flagged before deploy, now step
14).

Added 2026-09-02. Renumber upward if any collide with an F-number already used in
`reports/`.

- **F40** Whether derived context — the pattern of building an audited intermediate
  artifact and working from it rather than from sources — is a CoWrite concern at all,
  or stays external and arrives as an uploaded file.
- **F41** Whether the model's decomposition (§2.2 `segments`) is always shown or only
  above some segment count.
- **F42** Whether the human can mark a span "idea layer open" explicitly, or whether it
  must always be inferred from how she writes the prompt. Marking is more reliable and
  is also bookkeeping.
- **F43** Whether a modified-accept records the human's replacement inside the turn or
  as a separate ledger event.
- **F44** The rolling window's bound: turns, tokens, or checkpoints.
- **F45** Whether a session can be closed with a marker — "unreviewed under fatigue" —
  pointing the next session at what needs fresh eyes. The evidence supports the need;
  the no-bookkeeping rule argues against anything requiring effort. An automatic signal
  derived from timestamps and disposition patterns is a third option and is
  speculative.
- **F46** What "the same kind of correction" means operationally for S11. This is the
  difference between a useful proposal and a nag, and it is the one genuinely unsolved
  problem in the extension. **Blocks step 16 and nothing earlier.**
- **F47** Whether Checkpoint's adjacency to Submit is missed once it moves to the top
  row. Checkpoint-then-send is a common sequence and the two controls are now far
  apart. Watch in use rather than pre-solving.

Raised by chunk 10, resolved 2026-09-03 in chunk 11 and recorded here so the numbers
are not reused:

- **F49 — the Export transcript wrapper.** RESOLVED: the shape is written into §4.
- **F51 — §0.5's disclosure behind a click.** RESOLVED: it is back on the surface,
  written into §12.
- **F52 — where §2.3 warnings live.** RESOLVED AS-IS: they stay in the Prompt box.
  A validation warning is the system reporting, not the model talking, and Model
  Response holds speech only (§12).

Still open from chunk 10: **F48** (the `+` is in the layout but attaches nothing until
step 12), **F50** (the history toggle lost its turn count), **F53** (which top-row
controls are disabled mid-turn).

---

## Build order

**This section is always last and is never numbered.** It has a different job from
everything above it: the numbered sections say what the thing is, and this one says
where in the process we are. Extensions append new numbered sections in order, then
rewrite this section to place the new work. Referenced as "the Build order section,"
not by number, so the reference survives every extension.

Entries are pointers. Anything a chunk needs to know lives in the section it names;
what belongs here is *where in the sequence* and *why there*.

Steps 1–10 are built, tested, and committed: canonicalize, round-trip, storage, turn
model and Checkpoint, AI endpoint, editor and panel, clipboard fixture, history view,
the spec extension, and the §12 UI cleanup. The detail is in git and in `reports/`.

9. **Spec extension.** This file. No code.

10. **UI cleanup.** The §12 layout. No new concepts, and it is the frame the rest
    builds into.

11. **Model speech.** §0.7 and the interim §2.2 contract. Lands the ledger schema
    change before anything depends on it.

12. **Context files and human-written standing rules.** §8, plus §10's human-written
    half. Independent of staging.

13. **Staging and disposition.** §0.8, §0.9, the full §2.2 contract, §12. Do not merge
    this with anything.

14. **Deploy.** Railway with a persistent volume, per §0.5 and §0.6. Resolve F37 first.
    Downstream of step 13 by decision: a version worth using exists before a version is
    hosted.

15. **Segmentation.** §2.2's `segments` surfaced, contingent candidates marked,
    panel↔editor links. Provisional per §9.

16. **Standing rule proposals.** §10's model-proposed half. Provisional per §10;
    blocked on F46.

17. Everything else.

Run `node scripts/smoke-session.js` after every chunk. A passing test proves nothing if
its fixture is empty; every test runs against the shared fixtures in §5, visible in the
repo as their own files rather than inlined per test.
