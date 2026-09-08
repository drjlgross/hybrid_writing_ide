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

### Report naming

A report is `reports/chunk-NN.md` for work that is a step in the Build order, or
`reports/mini-<name>.md` for deliberate out-of-band work. There is no third form.

`NN` is the step's number in the Build order **as it stands after the work is
ratified**. Inserting a step renumbers the ones below it, and the reports keep the
numbers they were written under — so the shelf and the order agree on what step 15
is, while `reports/chunk-14.md` continues to describe the export viewer whatever
happens above it. The Build order's own note records each renumbering; that note is
how an older report's number is read.

A `mini-` report is for work that was never a step: a rebrand, a one-file fix, a
piece of tooling. It carries no number precisely because it has no place in the
sequence, and giving it one would imply the order moved when it did not.

A chunk is not done until the Build order section's state line names it. Updating that
line is part of the chunk's definition of done, alongside the report — the section whose
whole job is saying where in the process we are is worthless the moment it lags reality,
and it lags by default unless the chunk that moved it says so.

Section 0 decisions are locked. If one seems wrong, say so and stop — do not change it,
and do not write code that depends on changing it. Report the collision before the code
exists, not as a finding afterward.

Git commits and pushes happen only on the human's explicit instruction, never of
the assistant's own accord — ratification is the human's act even when the
assistant types the command. Before any commit: run `node scripts/secret-scan.js`
and proceed only on exit 0. A hit means stop, show the finding, and wait;
committing over a failed scan is never correct.

### Versioning

The APP version lives in `package.json`. It stays `0.0.0` until first deploy and becomes
`0.1.0` at deploy (the Build order section's step 13).

After that, **every ratified commit — chunk or fix — bumps the patch version as part of
that commit**. The bump is inside the ratification, never a commit of its own and never
an edit made outside one: the version is what the human ratified, so it moves when she
ratifies and at no other time. Minor bumps are reserved for milestone-grade changes she
names explicitly as such; the assistant does not decide a change has earned one.

Each ratified commit also appends one line to `CHANGELOG.md`: the version, a
one-sentence description, and a `(behavior change)` tag when a user will notice the tool
acting differently. Behavior changes on a deployed tool are the reason this exists — see
step 14, which is the first step after deploy and therefore the first whose changes
land on people already holding links.

The app version is distinct from `schema_version` in stored documents and exports (§0.5,
§4), which moves only when the data shape changes. Neither implies the other, and a patch
bump must never be read as a data migration.

The deployed UI surfaces the current version somewhere a bug reporter can find it. A
report that cannot name the version it came from costs a round trip to establish what
was running.

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

### Live API spend (standing budget)

The dev key in `.env` is available for development without asking. Trying things
against the real model at low cost is the point of it, and requesting permission
per call defeats that — the first live turn of chunk 11 broke the §2.2 contract in
a way no fixture had caught, and the fix took two attempts because checking was
expensive in round trips rather than in money.

**The ceiling is $1.00 per budget window. Under it, spend without asking. At it,
stop.**

**A window opens at a commit and closes at the next one.** Ratifying a chunk
starts a fresh $1 automatically — the ledger is anchored to the commit it was
spent under, and a moved HEAD opens a new window at zero. So this is a RUNAWAY
DETECTOR, not a lifetime cap: it catches a process spending in a loop and
interrupts it near the source, and it does not ration the project's development
budget. Reaching the ceiling inside one window is itself the signal, and the
report says so, because "the project is out of budget" would send the reader
looking for the wrong problem.

Stopping means: abort **before** the call that would cross, and report

- what has been spent so far in this window, against the ceiling,
- what the refused call would have cost,
- what the rest of that turn's live work would cost if continued.

Then wait. Continuing *without* committing means raising `BUDGET_USD` in
`scripts/spend-guard.js` or clearing the ledger with `rm .spend.json` — both the
human's calls, not the assistant's. Do not do either unilaterally, and do not
route around the guard by writing a script that calls the API directly.

The window is read from `.git/HEAD` and the ref it names, on the filesystem.
Nothing here shells out to `git`, per the operating rule above; a budget guard is
the last place to start making exceptions to it. When HEAD cannot be read the
window never auto-closes, which is the safe direction — spend keeps accumulating
rather than silently resetting.

`scripts/spend-guard.js` enforces this. Every script that spends the dev key
routes through it; `npm run budget` reports where things stand — spend this
window, the commit it is anchored to, and what the previous window cost — without
spending anything. It is a guardrail and not a vault — it counts what goes through it, and
the ledger is a file that can be deleted — so this rule is the control and the
code is what makes the rule hard to forget.

Nothing in `src/` may import it. The app's model caller runs in the deployed
server, where a development budget would be nonsense: the server must not stop
working because a dev ledger says $1. That separation is asserted in
`test/spend-guard.test.js`.

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

Standing rules (§10) live inside the document's own JSON, inside the same
namespace, and are subject to every rule above.

**Context file CONTENT is stored as sibling files** under
`documents/{token}/files/{id}`, resolved through the same single
namespace-resolution function. Amended 2026-09-03, ratified — the earlier rule put
context inside the document JSON, which for images meant base64 in the file that is
read on every load and every listing, so a couple of screenshots put megabytes in
the read path.

The document JSON holds context **metadata only** — id, filename, description,
type, extraction status — and remains the source of truth for what exists. A file
on disk with no metadata entry is not context; deleting context deletes the file.
No endpoint lists or reads across namespaces, unchanged.

Export transcript carries context metadata, never file bytes (§4).

**The fixed default token is refused off localhost.** Resolves F37, ratified
2026-09-04. The default token is guessable by construction: that is exactly what
makes it useful locally, and exactly what makes `documents/000…0` a world-writable
namespace the moment this is hosted. So the two facts are bound together in code —
**when the server is not listening on a loopback address, any request carrying the
default token is refused with 403 and one line saying why.** Deployed namespaces
exist only via generated tokens.

Keyed on the BINDING, not on an environment variable. `NODE_ENV=production` is a
label someone can forget to set; a socket reachable from outside the machine is the
hazard itself, and it cannot be misdeclared. Local development is unchanged — bound
to localhost, the default token works as it always has.

Refused, never sanitized and never redirected to a generated namespace, by the same
rule as an invalid token above: a request that quietly became a different namespace
is worse than one that failed.

**Two people editing one document at once is accepted, not solved.** Resolves
chunk-06's F43, ratified 2026-09-04, for v1. A capability token is *shared by
construction*, so §5's "single local user" stopped being true the moment namespaces
shipped. Two tabs on one document both load, both edit, and the later commit wins:
**last Checkpoint wins.**

**The ledger keeps both.** Every commit appends and nothing is ever rewritten
(§0.3), so both parties' turns are in the history and either draft can be restored
from it (§4). What is lost is bounded to the uncommitted hand edits sitting in the
losing tab — real, but recoverable-adjacent, and the alternative is locking or a
CRDT, both ruled out by §7.

Accepted knowingly rather than left undiscovered: §12's capability disclosure
carries one sentence about it, because someone handed a link needs to know this
before they find out by losing a paragraph.

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

**`draft` is REQUIRED and NULLABLE.** Amended 2026-09-03, resolving F66.

`"draft": null` means speech-only: no edit is proposed, and the ledger records an
unchanged snapshot exactly as it does today (§0.9). A string means a revision, and it
is the complete draft.

Required-but-nullable rather than optional, deliberately, and the distinction is the
whole point. **The model must DECLARE no-edit; it cannot arrive at one by omitting a
key.** An absent field is a decision it can make by forgetting; `null` is one it has to
make. That property is what the request-side schema is for, and it must survive the
swap to `candidates` — an empty `candidates` array is the same declaration.

What the amendment ends is full-draft regeneration on speech-only turns. With `draft`
merely optional the model filled it with the draft it had just been given, so a turn
that changed nothing cost a whole draft of output tokens and the human waited for it.
The instruction that carries this is not a footnote in the prompt: null is the common
case and the prompt has to say so, or the model treats reproducing the draft as the
safe default. The cost is measurable and is measured — `scripts/live-check.js` prints
output tokens per turn precisely so this claim stays a number.

### 2.3 Response safety (this is the one bug that loses work)

*(All existing guards stand: `max_tokens` computed from draft size; `stop_reason`
checked and anything but `end_turn` refused; defensive fence stripping; empty response
rejected; the 40% shrink soft guard; the out-of-dialect construct check with structured
per-construct counts.)*

**The output budget and the request timeout, stated here 2026-09-08.** They lived
only in the code until a live `max_tokens` failure on memo-length work showed that
nobody could check the constants against anything ratified. The formula:

    max_tokens = min(max(ceil(chars / 3) × 2.0 + ceil(NOTE_MAX_CHARS / 3) + 6144,
                         16000),
                     32000)

The headroom factor was 1.6, the flat term 2048 and the floor 4096; they were raised
because **thinking shares this budget** and an analysis-heavy turn on a ~10K-character
draft exhausted it. The flat term is thinking and segments; the note is budgeted
explicitly rather than left to headroom, because a long note on a short draft is
exactly the case that hits the cap, and a response cut off mid-JSON does not parse at
all.

**The ceiling stays 32000, deliberately.** With no streaming (§0.6) and a finite
timeout, an unbounded single generation trades a truncation the `stop_reason` guard
catches for a hang it cannot. The known limit: a draft past roughly 36,000 characters
is clamped, so its budget stops covering twice the draft plus the flat terms. That is
a limit, not a bug to be fixed by removing the ceiling.

**The request timeout is 480s**, raised from 120s with the budget. The two are one
setting: a generation allowed 32000 tokens takes longer than one allowed 20000, and a
timeout left behind converts `max_tokens` failures into abort failures with the same
cause and a less useful message. The timeout aborts before any response exists, so it
lands in the §2.4 window where the draft is unchanged and the human turn stays
committed.

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
- A toggleable timeline listing every turn in order. **It renders OPEN by
  default** (chunk 14): the record is the product, and a ledger you have to
  decide to open is one that catches an unasked-for rewording only when you were
  already suspicious. The Show/hide control is unchanged and is now primarily a
  hide toggle. Per-session UI state only — no persistence, no per-document
  setting — because a stored preference is a second place the UI can be wrong.
- Each entry shows: turn number, author badge (Human / AI / Mixed), timestamp, the
  prompt string for AI turns, any warnings, and a rendered word-level diff (insertions
  green, deletions red strikethrough) against the previous turn's snapshot.

  **Wholesale replacement renders as blocks, not as interleaved marks.** When the
  changed fraction of a contiguous region exceeds a threshold, that region renders as
  a deletion block followed by an addition block rather than word-level marks stitched
  through the new prose. Added 2026-09-03, resolving F64.

  A region ends at a run of unchanged text long enough to be a real shared passage;
  punctuation and articles between two rewritten sentences are coincidence, not
  common ground, and must not hold a region open. Blocking additionally requires that
  the region contain *both* an insertion and a deletion — a pure insertion has no
  interleaving to fix — and that enough text actually changed, so a two-word swap
  inside an untouched sentence stays inline, which is the case word-level marks handle
  best. The thresholds are implementation, named in the chunk report; the rule is that
  all three conditions exist.

  **This is a rendering rule and never a data rule.** A blocked region's two sides
  carry every word of the before-text and the after-text; nothing is elided,
  summarized, or collapsed. §4 exists so the view cannot hide a change, and a
  replacement block shows *more* of the change than the confetti it replaces, not
  less.
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
        "context": [ ... context METADATA per §0.5, never file bytes ... ],
        "rules": [ ... the standing rules per §10, with their scopes ... ],
        "turns": [ ... the ledger verbatim, per §3 ... ]
      }

  `schema_version` is the SAME constant §0.5 requires on every stored document, not
  a second one — an exported file outlives the app version that wrote it by more,
  not less, than the stored one does, so it wants the same protection. Its presence
  is asserted on the exported FILE, not only in the code that writes it: the only
  thing a later reader ever sees is those bytes. `slug` because a file named
  `draft-transcript.json` in a folder of them is not self-identifying once it is
  out of the app; `exported_at` because §11's K4 turns on reconstructing when
  something was looked at.

  `context` and `rules` were ADDED 2026-09-05, correcting this block rather than
  the code. They were absent because the shape was pinned in chunk 11 and context
  and standing rules arrived in chunk 12 — so the export had been carrying them,
  correctly, against a spec that did not mention them. §0.5 already required it
  ("Export transcript carries context metadata, never file bytes"), and a
  transcript whose turns carry `context_ref` and `rules_ref` but no table to
  resolve those ids against is a dangling reference the moment it leaves the app.
  Metadata only, on §0.5's terms: the id, filename, description, type and
  extraction status, never the bytes. A 73KB context file must not become 73KB of
  every export.

  This is the same class F49 was raised for — a shape drifting from the spec that
  pins it — caught the other way round, in the export rather than in the code.
  Both halves are now asserted against the FILE.

  `turns` is the ledger verbatim — full snapshots per §0.4,
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

**Model-proposed rules (step 18, provisional).** The third route in: on the second
occurrence of the same kind of correction the model proposes a rule *and* makes the
correction; on the third and after it keeps making it as a one-off until the rule is
accepted or dismissed (S11). Paired with silence-decay on model-volunteered
observations the human ignores (S10). Blocked on F87.

Build the store so the source of a rule — `human` or `proposed` — is a field on the
rule, not a separate collection. Step 16 then adds a writer and a proposal state, not a
second store.

Human-written rules are also the first point at which a stated rule can be *measured*:
set "no em-dashes," run turns, watch whether the output changes. Whether standing
instructions work at all is an open empirical question, and the answer should exist
before staging designs candidates against rules nobody has tested.

## 11. Session continuity

- **K1** A rolling conversational window of recent exchanges, bounded (F85).
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

**Top row**, lilac controls, in this order:
**document name** (opens a switcher) · **+ New Document** · **Export Transcript** ·
**View WordWright Doc**.

**Button labels are Title Case**, everywhere: the top row, the panel, the history's
per-turn controls, and the landing and success pages. The document name is not a
label and is exempt — it is a slug the human typed, which §0.5 lowercases.

**Two controls left this row in chunk 15's layout pass**, each to sit beside what
it acts on rather than in a row of everything:

- **Show/Hide History moved to the History section's own heading**, immediately to
  the right of the word History. It carries the turn count again — `Hide History
  (12)` — which resolves F50. Two things follow, both load-bearing: the history's
  HEADING always renders and only the log collapses, because a toggle inside the
  thing it toggles would vanish with it; and the count lives on the control,
  because the "N turns, newest first" line is part of what collapses, so hidden,
  the button is the only thing left saying how much record there is.
- **Checkpoint moved to the editor's bottom-right**, parallel to the Prompt box's
  Submit and the rules box's Add: each surface's commit action at its own
  bottom-right, in the same green. It sits under the editor box and above the rule
  that opens the history, and it does **not** float — see Button semantics below.
  **The uncommitted-edits signal travels with it and is visible whenever the button
  is**: §12 removed the status row that used to carry it, so if the button did not
  say it, nothing would. On green the marker is white, because it has to be legible
  against whatever it sits on.

**View WordWright Doc** was added in chunk 15 and opens §12a's viewer in a NEW TAB.
The new tab is the requirement, not a preference: hand edits are uncommitted until
Checkpoint (§3), so navigating away in the same tab would silently discard whatever
is typed and not yet ratified — the loss the dirty marker on Checkpoint exists to
warn about. It is an anchor rather than a button, because it goes somewhere and
middle-click and cmd-click should work; it wears the same lilac treatment, since
§12's split is about what a control DOES and this is navigation. It is shown even
when the address names no document, being global. Its label is set in the interface
face, not Allison: §12b's wordmark rule covers the landing and success pages, and a
script face inside a small control costs legibility for consistency nobody asked
for.

Checkpoint carries the uncommitted-edits signal in the button itself — marked when hand
edits are unratified, quiet when clean. That is why the separate status row can go
without losing anything load-bearing.

**Left:** the editor.

**The editor is sized so the history is on screen at first paint.** The heading, its
count, and the top of the newest turn are visible without scrolling. This is not
cosmetic: the record is the feature nobody arrives knowing about, and a layout that
puts it below the fold makes discovering it something you have to already want.

The mechanism is a CAP, not just a floor — `max-height` with `overflow-y: auto`, so
the editor scrolls inside itself. A minimum height alone does nothing on a draft
with text in it, because the box is as tall as its content; on any document anyone
has actually written the history would go straight back under the fold. The cost is
a second scroll region on the page, accepted deliberately. Both bounds are
`calc(100vh - <length>)` under a `max()` floor: what sits above and below the editor
is fixed furniture that does not scale with the viewport, so it comes off as a
length, and the floor keeps a usable writing surface on a short screen rather than
spending it all on the record.

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

**Prompt and Model Response remain reachable at any scroll depth.** The history view
is the only scrollback (§4), so reading it is a normal thing to do at length — and the
whole point of reading it is to then act. A panel that scrolls out of reach makes every
turn cost a round trip back up the page. Mechanism is not specified; reachability is.
Added 2026-09-03, resolving F65. Note the constraint this sits under: the rail must
stay a column beside the draft, never an overlay, and the history stays in the editor's
column, so nothing here may put one over the other.

**§0.5's capability disclosure stays on the surface**, in the header, visible without
a click — not inside the switcher drawer, and not inside any other drawer or menu.
Resolves F51, 2026-09-03. §0.5 requires that a namespace "be described that way to
anyone given a link", and a disclosure someone has to go looking for cannot do the one
job it has: stopping a person from treating a capability URL as private. Step 13 is
deploy, and real people will be holding real links.

**The same disclosure carries one sentence on concurrency** (§0.5, F43 accepted):
two people editing one document at the same time is last-Checkpoint-wins. It sits
here rather than in a warning somewhere because the person who needs it is the
person being handed the link, at the moment they are handed it.

**Removed:** the Documents panel (creation and switching move to the top row) and
everything below the horizontal separator — document name, turn count, uncommitted-edits
row, stored-file link.

**The left column is one element**, `.editor-column`, holding the draft, the
Checkpoint row, and the history below them. The wrapper is what stays pinned to grid
column 1 — the chunk-08 guarantee that nothing on this side spreads under the sticky
rail is unchanged, it just attaches one level up.

**Button semantics:** lilac = global and navigation controls; forest green = **the
commit action of a surface**, at that surface's bottom-right. New controls inherit
from that split rather than accumulating a third treatment. Check lilac for contrast
against the cream ground before shipping it.

**There are exactly three commit actions and they are one visual group** (widened
from "the primary action inside a box (Submit)" in chunk 15's layout pass):

| surface | control | what it commits |
| --- | --- | --- |
| Prompt box | **Submit** | the prompt |
| Standing Rules | **Add** | a standing rule |
| the editor | **Checkpoint** | the draft |

Each sits at the bottom-right of the box it acts on, and all three wear the same
green. That is the whole of what makes them read as one act repeated rather than
three buttons that happen to be last in their box — so the treatment is **declared
once, in one grouped selector**, and three greens cannot drift apart one edit at a
time. Anything added later that commits its surface joins that selector; anything
that does not commit anything stays lilac.

**Checkpoint is not sticky.** The first attempt at moving it pinned it to the bottom
of the viewport, which bought reachability from anywhere at the cost of a band of
the screen for the whole session — for a control met once per checkpoint, held over
a record it has nothing to do with. It sits directly under the editor box,
right-aligned, and above the rule that opens the history: inside the draft's own
territory, which is also what says what it commits.

**Candidates render in the draft, not in the panel**, anchored to their spans, with
accept / reject / edit-in-place controls sitting with each candidate — visible without
hunting, never a dialog that can be dismissed into auto-allow. The panel says what the
model thought; the editor shows what it proposes to do. A candidate is never described
in prose in the panel as a substitute for showing it, and **the panel never restates the
draft** — pasting revised text into the response box would reintroduce exactly the
whole-draft paste the success metric exists to eliminate.

Pending state: an indicator in the panel, the editor locked, the draft fully visible.
No modal, no overlay, no full-screen graphic.

## 12a. The export viewer, at `/view`

A read-only page that renders an exported transcript (§4). Added in chunk 14. It
exists because a transcript is the thing you SEND: the person reading one is often
not the person who wrote it, and handing them a capability link so they can read a
record would give them write access to a namespace in order to show them a file.

**Entirely client-side. The file never leaves the visitor's browser.** There is no
upload endpoint and no request that carries the file. The bytes come from a file
the visitor chooses or drops, read in the page. Nothing is stored — no
localStorage, no sessionStorage, no IndexedDB, no cookie — so closing the tab is
the whole of deleting it. The page's only network call is `/health`, for the
version in the footer, and it carries nothing.

**No namespace access.** `/view` reads no token and reaches no document. It cannot,
which is the point: it is outside `/t/{token}/{slug}` entirely, and someone holding
no link at all can use it.

**`schema_version` is asserted on the file's bytes at load**, per §4's "the only
thing a later reader ever sees is those bytes". A file that is not JSON, or is JSON
without `schema_version: 1`, produces a calm inline error naming what was expected
and what arrived — never a blank page, never a console-only failure. A file
claiming a different version is refused whole rather than read in part: a record
shown with pieces missing is worse than a record not shown.

**Read-only, by absence rather than by disabling.** No editor, no AI panel, no
Checkpoint, no Restore. The history components are reused as they are; the Restore
control simply is not given a callback, so it does not exist on the page.

**The Current Draft comes first.** Above the timeline, a card headed *Current
Draft* renders the LAST turn's snapshot — which §0.3 makes the draft as it stood at
export — as text rather than as a record. The bottom line, up front: a transcript is
a record of how a text got made, and the thing a reader most often wants from one is
the text, which reconstructing by scrolling to the oldest entry and reading forward
is work nobody should have to do. Nothing is recomputed; full snapshots (§0.4) exist
so a reader never replays a chain to find out what the text is.

It is rendered with the app's own TipTap extension list, `editable: false`, so the
§1 dialect renders as marks rather than as Markdown source and the draft reads
exactly as it reads in the editor. A second Markdown renderer written for this page
would be free to disagree with the editor about what a draft looks like, which is
§0.1's failure one layer up. A session with no turns gets no card; a session that
ended with an empty draft gets the card, saying so.

Then the turn log in order — author, timestamp, the prompt for AI turns, the
notes as speech distinct from text changes (§0.7, §9 S12), the §2.3 warnings, the
`segments`, and which context files and standing rules each turn referenced,
resolved against the export's own `context` and `rules` tables. Metadata only:
§0.5 keeps file bytes out of an export, so there is nothing here to open. Diffs are
computed in the browser from the snapshots the file carries (§0.4) — a transcript
stores no diffs and this page invents none.

Surfacing `segments` here is not step 17. That step is about the LIVE surface
(§2.2, §9 S2, and S2 is provisional pending re-justification); an archived
transcript is the one place the decomposition is otherwise unrecoverable.

`/view` must not collide with `/t/{token}/{slug}` or with the API routes. It cannot
by construction — a document address always begins `/t/`, and §0.5's token is 32
hex characters — and both the server and the client entry read the same predicate
in `src/addressing.js` rather than each carrying half of the guarantee.

## 12b. The public front door: claim, landing page, registry

Added in chunk 15. A stranger at the bare domain can read what the tool is, sign
up with a name and an email, and receive a namespace — with no operator in the
loop. Until this, every namespace was minted by hand at a terminal.

### The claim endpoint

`POST /api/public/claim`, taking `{name, email}`. **The one endpoint that needs no
token**, because its whole job is handing one out; it lives under `/api/public/`
rather than `/api/t/…` so that is visible in the address.

Both fields are required. The name must be non-empty; the email must match a basic
pattern and nothing more. **There is no verification email and no deliverability
check**, so the pattern cannot establish that an address is real — it catches a
typo obvious enough to be worth catching, and a stricter one would reject valid
addresses while still proving nothing.

**A claimed namespace is identical to a hand-minted one.** `generateToken` and
`resolveNamespace` are called, never reimplemented; §0.5's machinery is unchanged
and the only novelty is who triggered the mint.

**Rate limit: five claims per hour per address, in memory.** Named constants in
`src/claims.js`; the thresholds are reported in `reports/chunk-15.md`. Three
properties, each of them deliberate:

- It counts CLAIMS, not requests. A refused or invalid submission mints nothing, so
  it does not spend one of the five — a visitor who mistypes their email twice has
  not used up half their budget.
- A refused attempt is not recorded, so retrying cannot extend a lockout.
- The address is the RIGHTMOST `X-Forwarded-For` hop. Each proxy appends the address
  it received from, so with one trusted proxy in front the last entry is what our
  proxy saw; taking the leftmost would let anyone reset their own limit with a
  header.

**This is abuse friction, not enforcement.** It is per-process and a restart
forgets it. The enforcement layer for spend is the Console workspace limit, which
is the rule written down in the header of `src/usage-ledger.js` — nothing in `src/`
may grow the ability to refuse a model call.

### The claim registry

One JSONL row per successful claim, appended to `claims.jsonl` on the documents
volume beside `usage.jsonl`: `{at, name, email, token}`.

**It holds the WHOLE token, and that is the deliberate mirror of §0.5's rule.** The
usage ledger writes an eight-character prefix because a token in a log is a
credential in a log. This file inverts that on purpose: it is the operator's user
table and the ONLY record connecting a person to a namespace, and with no login and
no recovery, a registry without the full token means a visitor who loses their link
has lost their documents and nobody can help them. A prefix cannot open a
namespace, which is exactly what makes it useless for this file's one job.

**The rule that makes it safe is not a code rule, because it cannot be: the
registry never leaves the server.** It is served by no route, read on no request
path, included in no export, and pasted nowhere. `scripts/users-report.js` is its
only reader and prints the prefix in its human table. Treat the file as the
credential store it is.

Registry writes follow the ledger's failure discipline: the write happens after the
namespace exists and never throws, and a swallowed failure is reported in the
server log rather than to the visitor, whose namespace is real either way.

### The seed document

A claimed namespace's first document is created at claim time and carries
**exactly one turn**, whose snapshot is the `SEED_DOCUMENT` constant in
`src/seed-document.js`. No synthetic history: the text arrives as an ordinary
committed edit, so §0.3 holds from turn one and every §4 control behaves on it —
the visitor can restore to it, diff against it, or replace it like any other turn.

**Its slug is `welcome-doc`, not §0.5's `DEFAULT_SLUG`.** It is a welcome page and
not the visitor's first draft: naming it `draft` invites someone to start writing
over instructions they have not finished reading, and its own name is what makes it
findable in the switcher later, which is what the seed text promises when it says
the welcome page stays in your namespace. The consequence is stated rather than
discovered — a claimed namespace has no document at the default slug, so trimming
the URL to `/t/{token}` reaches §0.5's ordinary missing-document screen, which
offers to create it and lists what is there. Nothing routes a new visitor there:
the success link, the Start writing button and the switcher all name the welcome
page.

**The seed turn is authored `human`.** §3 has three authors and none of them is
"system"; inventing one would change the turn schema for a rendering nicety. It is
defensible on its own terms — a person placed this text — and it is recorded here
so nobody later reads `human` as a bug.

The seed text is Markdown in the §1 dialect — paragraphs and **bold section
labels**, which is what a scannable label looks like in a dialect with no heading
node — and it **carries no font styling**.
It is stored editor content, not page chrome: a wordmark span in it would be markup
outside the dialect and would round-trip to nothing. `wordwright.ink/view` in it is
a bare URL and stays plain text (§0.1 has no GFM autolink literals).

### The landing page and the success view

`/` is the landing page. `/t/{token}/{slug}`, `/view` and `/api/…` are untouched;
`/` is a client path like the other two, and all three tests come from
`src/addressing.js` so there is one definition rather than several that agree
today. **`/` no longer redirects into the development namespace on a loopback
binding** — it behaves identically on every binding, which is what makes the front
door testable in the place it is developed. `startServer` still prints the
development link at every start. It hands out no token on any binding: §0.5 says
nothing enumerates namespaces, and the page a stranger is most likely to reach is
the last place to make an exception.

It carries the lockup, `LANDING_COPY`, the name/email form, and `DISCLAIMERS`. On a
successful claim the visitor lands on a success view **whose entire job is the
link**: the full URL displayed large, a copy button, `KEY_DISCLOSURE` beside it,
and a prominent Start writing link into the new document. That disclosure is §0.5's
requirement that a namespace "be described that way to anyone given a link",
discharged at the exact moment someone is given one.

**Every rendered mention of the product name in page chrome and copy is set in
Allison**, the self-hosted masthead face, including mid-sentence; body text stays
in the existing faces. The mechanism splits the string and changes no character, so
the ratified copy stays ratified. This does NOT apply inside the seed document, per
the section above. Spelling is American throughout — *judgment*, matching the
masthead.

Failure states render calmly inline — rate-limited, invalid input, server error, a
network that never answers — never a blank page and never console-only.

The copy in all three constants is human-ratified verbatim, punctuation included.
It lives in `client/src/landing-copy.js` and `src/seed-document.js` and is not to be
reworded — only the human who ratified it changes it, and when she does, the reason
is recorded beside the line. One such change so far: `LANDING_COPY` opened with
"Welcome to WordWright." and that sentence was cut on 2026-09-08, because the lockup
sits directly above it and the greeting was the reader's third look at the same name
before the page had said anything. **The seed document still opens with it**, which
is not an inconsistency: there it is the first thing said inside the tool rather
than beneath its own sign.

### The operator report

`npm run users-report` reads `claims.jsonl` and `usage.jsonl` from the same root
and prints one row per claim — date, name, email, token prefix, full link — joined
on the prefix to calls, cost and last call. Namespaces present in usage and absent
from claims are listed separately as hand-minted or unknown: that is the smoke
detector with names attached, and it must never be folded into the named rows,
because "a namespace nobody can account for is spending money" is a different fact
from "a person is". `--csv` prints the same rows as CSV. An empty or missing
registry exits 0 with a calm message, in the manner of the spend report.

It refuses nothing and cannot, exactly as `scripts/spend-report.js` cannot. Nothing
in `src/` imports it.

## 13. Open items

Existing: **F28** (SDK not adopted; the fetch carries an `AbortSignal.timeout`
instead — open by choice).

**F37 — the fixed default token is guessable, and hosting it exposes one namespace.**
RESOLVED 2026-09-04, written into §0.5: refused with 403 off localhost. It was the
deploy step's stated precondition and is no longer open. (F37's own text in
`reports/chunk-06.md` cites "§9 step 9" for the deploy step; that was the numbering
of the day, and deploy is now step 13.)

**F43 — two tabs on one document clobber each other.** RESOLVED AS ACCEPTED
2026-09-04, written into §0.5: last Checkpoint wins, the ledger keeps both, and
§12's disclosure says so. Not fixed — decided.

Both F-numbers above are `reports/chunk-06.md`'s. See the renumbering note below.

Added 2026-09-02, **renumbered to F81–F88 on 2026-09-04** under this section's own
rule. As written they were F40–F47, and the first seven collided head-on with
`reports/chunk-06.md`, which had already used F31 through F46 — so this file's
"modified-accept" finding and chunk-06's "two tabs clobber each other" were
different findings wearing the number 43, and the same for 44. The reports hold the
numbers they were given; this section moved. The eighth did not collide and moved
anyway, to keep the block readable as one set. **The next free number is F95**:
F1–F80 are used across `reports/`, F81–F88 are used here, and F89–F94 were raised
by the deploy-readiness chunk further down this section.

- **F81** Whether derived context — the pattern of building an audited intermediate
  artifact and working from it rather than from sources — is a CoWrite concern at all,
  or stays external and arrives as an uploaded file.
- **F82** Whether the model's decomposition (§2.2 `segments`) is always shown or only
  above some segment count.
- **F83** Whether the human can mark a span "idea layer open" explicitly, or whether it
  must always be inferred from how she writes the prompt. Marking is more reliable and
  is also bookkeeping.
- **F84** Whether a modified-accept records the human's replacement inside the turn or
  as a separate ledger event.
- **F85** The rolling window's bound: turns, tokens, or checkpoints.
- **F86** Whether a session can be closed with a marker — "unreviewed under fatigue" —
  pointing the next session at what needs fresh eyes. The evidence supports the need;
  the no-bookkeeping rule argues against anything requiring effort. An automatic signal
  derived from timestamps and disposition patterns is a third option and is
  speculative.
- **F87** What "the same kind of correction" means operationally for S11. This is the
  difference between a useful proposal and a nag, and it is the one genuinely unsolved
  problem in the extension. **Blocks step 18 and nothing earlier.**
Raised by the deploy-readiness chunk, 2026-09-04 (`reports/deploy-readiness.md`):

- **F89** `/` answered Express's default "Cannot GET /" whenever `client/dist` was
  absent — a fresh clone, or a deploy whose build step failed. FIXED in that chunk
  (the route is unconditional now). Left here because the second half is open: the
  test passed in a working tree and failed only in a clone, so `npm test` is not
  self-evidently hermetic against build state and only the rehearsal checks that.
- **F90** `npm run build` needs devDependencies, so a host running
  `npm ci --omit=dev` cannot build. Latent — most Node buildpacks install
  everything — and the fix is a step-13 decision: install-then-prune, or promote
  vite to a dependency.
- **F91** `startServer` now binds `127.0.0.1` rather than every interface. The F37
  mechanism working as intended, but a silent change to a default: a dev server is
  no longer reachable from another device without setting `HOST`.
- **F92** The usage ledger is never rotated and `readUsage` reads the whole file.
  Irrelevant at this scale, real beyond it. Rotation is a decision nobody needs to
  make yet.
- **F93** `/health` is unauthenticated and reports the version, so the version is
  public on a deployed instance. Deliberate — a probe has no token.
- **F94** The F43 concurrency sentence lengthens the header paragraph. Watch on a
  narrow viewport; neither half of it is the half to drop.

- **F88** Whether Checkpoint's adjacency to Submit is missed once it moves to the top
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
step 12), **F53** (which top-row controls are disabled mid-turn).

**F50 — the history toggle lost its turn count.** RESOLVED 2026-09-08 in chunk 15's
layout pass. The toggle moved out of the top row to the History section's own
heading and carries the count again — `Hide History (12)`. It has to be on the
control rather than in the heading's hint, because the hint is part of what
collapses: hidden, the button is the only thing left saying how much record there
is. See §12 and `reports/mini-ui-updates.md`.

Raised by live use after chunk 11 (commit 0adf03d), resolved in chunk 11a:

- **F64 — the word-level diff renders wholesale replacement as confetti.** When a
  human turn deletes a passage and writes new text sharing incidental words, the
  word diff stitches strikethrough fragments through the new prose. Live turn
  10 → 11 produced ten alternating delete/add pairs joined by `". "`, `" a "` and
  `"-"`. The data is correct; the rendering is wrong for replacement-heavy changes.
  **RESOLVED: §4's replacement-block rule, below.**
- **F65 — the rail is unreachable at scroll depth.** Reading a long history meant
  scrolling away from Prompt and Model Response, then scrolling back to act.
  **RESOLVED: §12 now requires them reachable at any scroll depth.**
- **F66 — speech-only turns pay full draft regeneration.** `draft` was optional and
  the model filled it with the draft it had just been given, so a turn that changed
  nothing cost a whole draft of output tokens and the wait that comes with it.
  **RESOLVED: §2.2's amendment, `draft` required-but-nullable.**

---

## Build order

**This section is always last and is never numbered.** It has a different job from
everything above it: the numbered sections say what the thing is, and this one says
where in the process we are. Extensions append new numbered sections in order, then
rewrite this section to place the new work. Referenced as "the Build order section,"
not by number, so the reference survives every extension.

Entries are pointers. Anything a chunk needs to know lives in the section it names;
what belongs here is *where in the sequence* and *why there*.

Steps 1–15 are built, tested and committed: canonicalize, round-trip, storage, turn
model and Checkpoint, AI endpoint, editor and panel, clipboard fixture, history
view, the spec extension, the §12 UI cleanup, model speech, context files plus
human-written standing rules, deploy, the export viewer with
history-on-by-default, and the public front door. Step 15 is `reports/chunk-15.md`,
ratified 2026-09-08 at version `0.1.3`, with its interface decisions told as one
story in `reports/mini-ui-updates.md`. Steps 1–14 are additionally live-verified;
step 15's first real sign-up is the check it is waiting on. The detail is in git and
in `reports/`.

**The app is deployed and in real use.** Step 13 is done, and the version was
`0.1.0` from the chunk-13 commit; the WordWright rebrand took it to `0.1.1` per the
Versioning rule. `reports/chunk-13.md` walks an 11-turn session worked on the hosted
instance — three speech-only turns, context attached once and carried across two
turns, and the dialect constraint holding against a direct request for a heading.
Everything from step 14 on therefore ships to people already holding links, which is
the cost the deploy/staging swap priced in.

This state line is maintained by the chunk it describes, per the Operating rules.

9. **Spec extension.** This file. No code.

10. **UI cleanup.** The §12 layout. No new concepts, and it is the frame the rest
    builds into.

11. **Model speech.** §0.7 and the interim §2.2 contract. Lands the ledger schema
    change before anything depends on it.

12. **Context files and human-written standing rules.** §8, plus §10's human-written
    half. Independent of staging.

**Deploy and staging swapped 2026-09-04, ratified.** Deploy was step 14 and staging
step 13; the swap made them 13 and 14. **Chunk 14 then took the number 14** (the
export viewer, 2026-09-08), pushing staging to 15. **Chunk 15 then took 15** (the
public front door, 2026-09-08), pushing staging to 16 and everything after it down
one again. The numbers below are the current order; the older ones survive in the
reports that were written under them, which is what this note is for — see the
Report naming rule in the Operating rules.

13. **Deploy.** Railway with a persistent volume, per §0.5 and §0.6. F37 is resolved
    (§0.5: the default token is refused off localhost), as is F43 (accepted:
    last Checkpoint wins).
    Its precondition — a version worth using exists before a version is hosted — is now
    satisfied evidence rather than a forecast: the interim §2.2 contract is field-proven
    in `reports/chunk-12.md`, which reports all three required live turns passing plus a
    real task worked the same night. A shareable link now generates more learning than
    further solo feature work does, and that is what moved it.

    Accepted knowingly: staging therefore lands as a behavior change on deployed
    infrastructure rather than before anyone is holding a link. That is the cost of the
    reorder, priced in, not an oversight to be discovered later. It is also why the
    Versioning rule exists in the Operating rules above.

14. **Export viewer and history-on-by-default.** §12a, and §4's amended first
    bullet. Placed here rather than after staging because both halves are about the
    RECORD, which is what already exists — neither one waits on §0.8, and neither
    one touches the turn model, the export format, or the AI path. A transcript
    became worth sending the moment the tool was deployed and shared, and reading
    one required either the app or a text editor until this step.

15. **Public claim, landing page, signup registry.** §12b. Placed here, ahead of
    staging, because it is the step that changes who can use the thing at all: every
    namespace until now was minted by hand at a terminal, which made the operator a
    bottleneck on every single user. It touches no part of the turn model, the AI
    path, or the export format — the endpoint calls §0.5's machinery and modifies
    none of it.

16. **Staging and disposition.** §0.8, §0.9, the full §2.2 contract, §12. Do not merge
    this with anything. Downstream of deploy, so it ships to people already using
    the tool: it is a `(behavior change)` line in `CHANGELOG.md` by definition. Now
    also downstream of the front door, so "people already using the tool" may be
    people the operator never handed a link to.

17. **Segmentation.** §2.2's `segments` surfaced in the LIVE surface, contingent
    candidates marked, panel↔editor links. Provisional per §9. Note that §12a's
    viewer already renders `segments` in an archived transcript; this step is about
    the working surface, which is a different question and the one S2 is provisional
    about.

18. **Standing rule proposals.** §10's model-proposed half. Provisional per §10;
    blocked on F87.

19. Everything else.

Run `node scripts/smoke-session.js` after every chunk. A passing test proves nothing if
its fixture is empty; every test runs against the shared fixtures in §5, visible in the
repo as their own files rather than inlined per test.
