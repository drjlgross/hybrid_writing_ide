# Chunk 8 — ratification of the `<url>` spelling, and the history view: turn log, diffs, restore

Status: all four numbered items landed. `npm test` **258 pass / 0 fail** (from 221).
`scripts/smoke-session.js` exits 0 after every item and at the end.
`npx vite build` succeeds; `checkClientBuild()` reports `fresh`.
16 mutations applied, 16 caught.

---

## 0. Scope: where this prompt and §9 differ

The prompt's title is "turn log, diffs, restore". **§9 step 8 is "History view: diffs,
read-only turn view, restore"** — it names the read-only turn view, and §4 calls it
"Required, not optional. The text MUST be selectable and copyable." Per the operating
instruction I followed §9 and built the read-only turn view as well. It is the third
item under §3 below, and it is what makes the prompt's own constraint — "the history
view must not let a reader mistake a snapshot for the live draft" — a thing there is
something to test.

Nothing else in the prompt and §9 disagrees.

---

## 1. RATIFICATION (item 0) — the `<url>` spelling

### 1a. `resourceLink: false` pinned

`src/canonicalize.js` — the option was already in `STRINGIFY_OPTIONS` (chunk 7 found it
there, arriving as remark's default). It now carries the pin comment naming it as a §0.1
decision, with the bare-URL distinction spelled out so nobody later reads it as
"autolink everything".

`CLAUDE.md` §0.1 — added to the pinned option list:

> Pin at minimum: `emphasis: '*'`, `strong: '*'`, `bullet: '-'`, `listItemIndent: 'one'`,
> `rule: '-'`, `resourceLink: false`.
>
> `resourceLink: false` means a link whose text equals its destination stores as the
> autolink shorthand `<url>` rather than `[url](url)`; ratified chunk 8, after chunk 7's
> report-only investigation found it arriving as a remark default rather than a decision.
> It is the spelling a paste produces, so it is the most common link in the store, and
> §5's fixture now pins it. A BARE url — one that was never a link — is untouched by this
> and stays plain text, because there are no GFM autolink literals.

### 1b. The self-titled link in the §5 fixture

`CLAUDE.md` §5's required-construct list now names it, with both spellings.

`test/fixtures/draft-fixture.md` — one new top-level paragraph, inserted after the
bare-URL paragraph:

```
A self-titled link is written [https://example.com/](https://example.com/) here, and the
store keeps it as the autolink shorthand. This is what link-on-paste produces, so it is
the commonest link a writer makes; the bare URL above is a different construct and stays
plain text.
```

Placed mid-sentence deliberately: `<https://…>` at the start of a line would collide with
the fixed-point test's `doesNotMatch(out, /^</m)` raw-HTML-block check.

**The choice is now pinned by a test at both ends, which was the point of the item:**

| where | asserts |
| --- | --- |
| `test/fixtures/index.js` `REQUIRED_CONSTRUCTS` | the INPUT form `[https://example.com/](https://example.com/)` is in the fixture |
| `test/canonicalize.test.js` | the CANONICAL form is `<https://example.com/>`, the resource form does **not** survive, and there is **exactly one** `<…>` in canonical output — so the bare URL cannot quietly start autolinking and pass |

The construct now runs as its own case in both §0.1 round-trip tests:
`node 4 (paragraph): A self-titled link is written <https://exa…`. Round-trip identity
holds for it byte-for-byte, and it produces no new escape or blank-line divergence in the
fixed-point test, so no tolerance set changed.

### Changes to shared artifacts, named

1. **§5 fixture: +1 paragraph.** The one authorized change. Spec conformance — the
   fixture was missing a construct §5 now requires.
2. **`CLAUDE.md` §0.1 pinned-option list: +1 option.** Authorized by item 0.
3. **`CLAUDE.md` §5 required-construct list: +1 construct.** Authorized by item 0.
4. **`test/canonicalize.test.js`: one assertion narrowed.** The old blanket
   `assert.doesNotMatch(out, /<https:\/\//, 'bare URL is NOT autolinked')` fails the
   moment a self-titled link exists, because it could not tell the two constructs apart.
   It is now three assertions that can: the bare URL specifically is not in `<…>`, the
   self-titled link specifically is, and the total count of autolinks is exactly one.
   **Spec conformance, and the replacement is strictly stronger** — the old form could
   not have caught the bare URL being autolinked while a self-titled one was also
   present. Mutation-verified (M1, M2).
5. **`test/canonicalize.test.js`: `<` and `>` added to the markup-stripping character
   class in the prose-word comparison.** Convenience, minimally. With
   `resourceLink: false` an autolink's angle brackets are link markup exactly as `[]()`
   are; without this the raw fixture and its canonicalization tokenize differently and
   the "prose words changed" assertion fires on pure markup. The fixture contains no
   angle bracket that is prose.

**No §0 friction beyond item 0.** Nothing in this chunk wanted a §0 artifact changed.

---

## 2. What I built, file by file

### New

| file | what |
| --- | --- |
| `client/src/History.js` (258 lines) | The history view: the turn log, the per-turn diff, the read-only turn view, the restore control. Takes `history` and `onRestore` and nothing else — no api, no session, no way to write. |
| `test/history.test.js` (17 tests) | The component in isolation. |

### Changed

| file | what |
| --- | --- |
| `src/canonicalize.js` | `resourceLink: false` pinned with its rationale (item 0). |
| `src/server.js` | `POST /restore`, inside the `api` router, behind `withNamespace` like every other route. |
| `client/src/api.js` | `restore(slug, turnId, pendingDraft)`. |
| `client/src/draft-session.js` | `restoreTo(turnId)`, the §0.2 lock extended to cover it, and `describeRestore()` — the four honest outcomes. |
| `client/src/App.js` | Mounts `History`; the §4 toggle in the masthead; the lock veil now says which of the two things is happening. |
| `client/src/AiPanel.js` | Replaced the stale "the history view arrives next" line. |
| `client/src/styles.css` | +220 lines: the history section, the turn record, the speech/changes separation, the diff marks, the snapshot. |
| `CLAUDE.md` | §0.1 and §5, per item 0. |
| `test/fixtures/draft-fixture.md`, `test/fixtures/index.js` | The self-titled link. |
| `test/canonicalize.test.js` | The canonical-form pin; the two changes named above. |
| `test/namespace.test.js` | +5 tests for `/restore` over real HTTP. |
| `test/draft-session.test.js` | +6 tests for the client restore path. |
| `test/components.test.js` | +5 end-to-end tests; `restore` added to the stub api. |

### Diff dependency — the choice, named

**`diff@^9` (`diffWords`), via the existing `src/diff.js`. No new dependency.** It was
already a §5-named runtime dependency, added in chunk 5 for the §2.1 human-edit diff that
goes to the model. The history view imports the same `wordDiff` the AI payload uses, so
the diff the human reads and the diff the model is shown are produced by one function —
if they ever disagreed about what changed, that would be a bug this arrangement makes
impossible. `diff` bundles cleanly into `client/dist` (verified: `npx vite build` passes,
675 kB bundle).

**Diffs are computed at display time and never stored.** `useMemo` on the snapshot pair,
in the component. There is no diff field on a turn, no diff in the `/restore` or
`/ai-edit` response, and no diff on disk. Mutation-verified: M6 made the component prefer
a `turn.diff` field if one existed, and a test that plants a poisoned `diff` on a turn
caught it.

### Model speech vs. model edits

Every turn renders four regions, in this order, as siblings:

```
.turn-head       badge · Turn N · timestamp · [Restore to this turn]
.turn-prompt     Instruction — the human's exact prompt (AI turns only)
.turn-speech     "Reported" — the §2.3 warnings + structured stripped counts
.turn-changes    "Changed" — the diff
```

`.turn-speech` is the region a conversation channel joins later; nothing else moves when
it does. The separation is asserted as **DOM disjointness**, not as adjacency: neither
region may `contains()` the other, no `<ins>`/`<del>` may appear inside the speech
region, and neither region's text may leak into the other. Each carries a visible
`.record-label` and an `aria-label`, so the separation survives a reader who cannot see
the border between two boxes.

One judgment call: **the prompt is not "speech".** It is the human's words and §3 stores
it as provenance, so it sits in the record header with the author and timestamp rather
than in the model's report. The chunk brief's own gloss agrees — "today 'commentary' is
the warnings."

### The read-only turn view (§9, §4)

A `<pre>` inside the turn entry, toggled by a per-turn button, holding the full canonical
snapshot byte-for-byte. Not a modal, not an editor: nothing inside it takes a caret (no
`contenteditable`, no `input`, no `textarea`), it carries `aria-readonly="true"`, and it
is labelled *"The whole draft as it stood at turn N. Read-only — select and copy from
here into the live draft above, where it commits as an ordinary human turn."* Exactly one
turn is open at a time. The turn whose snapshot IS the working draft is marked "the live
draft".

---

## 3. FINDING — §4 does not say what happens to uncommitted hand edits on restore

**This is the one place I extended the spec, and it is a deliberate decision, not a
convenience.**

§4 says restore "sets the working draft to that turn's snapshot and appends a new human
turn". It says nothing about hand edits that were typed and never checkpointed. Left
literally, clicking Restore replaces the editor's content and those edits are gone — not
in the ledger, not in any snapshot, no trace that they existed. That is the exact failure
mode §0.2 exists to prevent for AI turns and §0.3 exists to detect for the store, arriving
through a door neither of them watches.

**What I did:** `POST /restore` takes an optional `pendingDraft` and commits it first as
its own human turn, using `commitHumanTurn` — the same mechanism as §2.4 step 2 — and
then restores. §3's no-empty-turn rule means this costs nothing when there is nothing
pending. The client sends the editor's text on every restore.

Consequences, stated plainly:

- A restore with pending edits produces **two** turns, not one. §3's turn-boundary list
  names only two triggers for a human turn (Checkpoint, submitting an AI prompt); this is
  a third. **That is a spec extension and it is yours to accept or reject.**
- The turn ids are honest: the pending edits are turn N, the restore is turn N+1, and
  the notice names both — *"your hand edits committed as turn 3; restored turn 1 as turn 4"*.
- History stays append-only. Nothing else about §0.3 or §4 changes.

**The alternative I rejected:** a confirmation dialog. The brief says "confirm-free", and
a dialog trades silent loss for a modal over the editor, which item 4 also forbids.

**Second, smaller extension, same reasoning:** the editor is **locked** while a restore is
in flight, exactly as for an AI turn. The response replaces the editor's content, so
anything typed during the round trip would be destroyed with no record. §0.2 scopes the
lock to AI turns; the hazard is identical, so the lock is. The veil says *"read-only while
the draft is restored"* rather than *"while the model works"*, because no model is
working — asserted in a test.

---

## 4. What I verified, and how

`npm test` — **258 pass / 0 fail.** Per file:

| file | pass | fail | new this chunk |
| --- | ---: | ---: | ---: |
| `canonicalize.test.js` | 60 | 0 | +2 (fixture case in 2 case-driven tests) |
| `round-trip-identity.test.js` | 18 | 0 | +1 (the self-titled-link node case) |
| `tiptap-fixed-point.test.js` | 20 | 0 | +1 (same case) |
| `history.test.js` | 17 | 0 | **+17 (new file)** |
| `components.test.js` | 25 | 0 | **+5** |
| `draft-session.test.js` | 20 | 0 | **+6** |
| `namespace.test.js` | 21 | 0 | **+5** |
| `turns.test.js` | 12 | 0 | 0 |
| `storage.test.js` | 18 | 0 | 0 |
| `ai-edit.test.js` | 13 | 0 | 0 |
| `ai-response.test.js` | 10 | 0 | 0 |
| `clipboard-paste.test.js` | 10 | 0 | 0 |
| `client-build.test.js` | 8 | 0 | 0 |
| `anthropic-client.test.js` | 6 | 0 | 0 |

`scripts/smoke-session.js` — exit 0, 5 turns, 29 assertions, run after item 0, after the
restore endpoint, after the component, and at the end.

### The §5 fixture, walked item by item

Run programmatically against the shipped fixture (2703 chars, 31 required constructs, 31
present):

```
present — bold                              present — literal backslash in prose
present — italic                            present — backslash before a letter (Windows path)
present — bullet list                       present — entity text (&amp; and &nbsp;)
present — two adjacent bullet lists         present — ampersand before a letter, outside a link dest.
present — inline link                       present — mailto link
present — bare URL                          present — mailto link with a query string
present — self-titled link (input form) ←NEW present — a LOOSE bullet list
present — literal asterisk in prose         present — nested bullet list
present — underscored identifier            present — multi-paragraph list item
present — percent sign                      present — underscore emphasis to normalize
present — Word paste (quotes/dash/…/nbsp)   present — underscore strong to normalize
present — Word paste hyperlink              present — star bullets to normalize
present — Google Docs paste (curly quotes)  present — wide list indent to normalize
present — Google Docs paste hyperlink       present — trailing whitespace to normalize
present — stray underscore                  present — stacked blank lines to normalize
present — link target with parentheses
```

Against §5's own prose list: bold ✓, italic ✓, bullet list ✓, inline link ✓, bare URL ✓,
literal asterisk `a * b` ✓, `snake_case_name` ✓, `100%` ✓, two adjacent bullet lists ✓
(truly adjacent, nothing between them — the merge test still asserts the 5-item merged
block), self-titled link ✓ **(new, the one authorized change)**, Word paste artifacts ✓,
Google Docs paste artifacts ✓, both pasted hyperlinks ✓, deliberately non-canonical in
places ✓. Deliberately excluded and still excluded: headings, ordered lists, thematic
breaks, tables.

### Live check, over real HTTP, against the real server

`createServer` on a real port, real `documents/` root, real `fetch`:

```
checkpoint 1: 200 turn 1
checkpoint 2: 200 turn 2
restore turn_id=1 with pending edits -> 200  human_turn 3  restore turn 4
  draft "Live check, version one.\n"   history: 1:human 2:human 3:human 4:human
restore turn_id=4 (where the draft already is) -> 200  turn null   (no empty turn)
page GET /t/{token}/chunk8-live -> 200, index.html served
```

The check document was removed afterwards.

### Mutation checks — 16 applied, 16 caught

| # | mutation | tests failing | first failure message |
| --- | --- | ---: | --- |
| M1 | `resourceLink: true` (unpin the ratified spelling) | 4 | `a self-titled link must store as the autolink shorthand (resourceLink: false)` — and separately `STRUCTURAL DIVERGENCE in case "whole canonical fixture"` |
| M2 | self-titled link deleted from the fixture | 2 | `fixture is missing: self-titled link (input form)` |
| M3 | `bullet: '-'` → `'*'` | 6 | `STRUCTURAL DIVERGENCE in case "node 6 (list)" … at tiptap[0] / canonical[0]` |
| M4 | `listItemIndent: 'one'` → `'tab'` | 6 | `STRUCTURAL DIVERGENCE in case "whole canonical fixture" … at tiptap[867]` |
| M5 | history rendered oldest-first | 7 | `newest first` |
| M6 | diff read off a `turn.diff` field instead of the snapshots | 1 | `The input was expected to not match /THIS MUST NOT BE RENDERED/` |
| M7 | model speech nested **inside** `.turn-changes` | 1 | `the report must not live inside the diff` (`true !== false`) |
| M8 | read-only snapshot made `contentEditable` | 2 | `the snapshot says nothing of the kind` (`'true' !== null`) |
| M9 | `.history` given `position: fixed; inset: 0` | 1 | `the history must not float over the draft` |
| M10 | `restoreToTurn` truncates instead of appending | 5 | `restore appends a NEW turn` (`1 !== 4`) |
| M11 | client reports a restore that did not happen | 2 | `The input did not match /nothing to restore/` |
| M12 | client stops sending `pendingDraft` | 2 | `the editor text goes with the request, or the server cannot save it` |
| M13 | server ignores `pendingDraft` | 1 | `TypeError: Cannot read properties of null (reading 'turn_id')` — the hand-edit turn was not created |
| M14 | no editor lock during restore | 2 | `locked synchronously, before the first await` (`true !== false`) |
| M15 | restore control hidden on the live turn | 2 | `the live turn offers restore too — the no-op is reported, not blocked` |
| M16 | §2.3 structured `stripped` counts dropped | 1 | `the structured counts are rendered, not only the sentence` |

M3 and M4 exist to satisfy §0.1's standing requirement that the fixed-point test's
mutation-detection be re-verified whenever the fixture grows. **It still catches marker
drift and list-indent drift after the fixture change.** No tolerance set (added escapes,
removed escapes, extra blank lines) needed to change, and the union-equality assertions
still pass — the new construct produces no divergence at all.

M13's failure message is a `TypeError` in the test rather than a named assertion. That is
weaker than it should be: the assertion `body.human_turn.turn_id === 3` throws before it
can report. The failure is unambiguous and lands in the right test, so I left it, but it
is worth knowing the message is not self-explaining.

---

## 5. Spec problems found

1. **§4 is silent on uncommitted hand edits during restore.** Written up in full as the
   finding in §3 above. This is the one that needs a decision from you.

2. **§4's "restoring to where you already are creates no turn" interacts with the
   pending-edit commit in a way §4 does not anticipate.** If the human has typed something
   and restores to the turn the *stored* draft matches, a turn IS created (the hand edits)
   and the restore itself is a no-op. The UI says both facts: *"your hand edits committed
   as turn 3; the draft already matched turn 1, so nothing was restored."* Correct under
   both rules, but it is a fourth outcome §4 does not describe.

3. **§4's "clicking a turn opens the full draft" does not say in what form.** I show the
   canonical Markdown in a `<pre>`. §7 makes rendered rich-text diffs a non-goal and says
   Markdown source is fine for diffs; I read the same licence as covering the snapshot
   view, and it has the side benefit that a `<pre>` of Markdown is unmistakably not the
   live WYSIWYG draft, which item 4 requires. If you wanted it rendered, that is a change.

4. **§5 says "One endpoint: `POST /ai-edit`".** This chunk adds a third (`/restore`,
   after chunk 6's `/checkpoint`), for the same reason: the state lives in the browser, so
   an action can only become a turn by being sent somewhere. Re-reported, not new.

5. **§2.3's `stripped` key names are mdast node types** (`heading`, `blockquote`), and the
   history view renders them verbatim. `inlineCode` and `thematicBreak` will read as
   camelCase to a writer. `dialect-guard.js` already has a `LABELS` map with the
   human-readable singulars; the history view does not use it. Cosmetic, not fixed —
   naming it rather than reaching into a §2.3 artifact unasked.

---

## 6. What I did NOT verify, named as such

- **The history view has never been seen in a browser.** `npm start` refuses to boot
  without `ANTHROPIC_API_KEY`, which is not set in this environment and there is no
  `.env`; I started the real `createServer` with a stubbed model caller instead and
  confirmed it serves `index.html` and the API, but the Chrome extension is not connected
  here, so **no screenshot and no rendered layout check happened.** jsdom applies no
  stylesheet, so ~220 lines of new CSS are pinned only by the assertions on the CSS
  *text* (`position` is not fixed/absolute, `grid-column: 1 / -1`, `line-through` on
  `.diff .del`, a background on `.diff .ins`, `user-select: text` on the snapshot). The
  rules survive the build (verified in `client/dist/assets/*.css`), and nothing is
  syntactically wrong, but **whether it reads well at a real width is unverified.** This
  is the largest gap in the chunk.
- **Long diffs.** Nothing is elided — a 3000-word draft with a one-word change renders
  the whole 3000 words as unchanged text around it, capped only by `max-height: 22rem`
  and a scrollbar. I chose no elision deliberately (a collapsing rule can hide a change,
  which is what this view exists to prevent), but I have not looked at a real long
  session to see whether the scrollbar is enough.
- **Performance with a long history.** Diffs are memoized per turn on the snapshot pair,
  but every turn diffs on first open. Untested past 9 turns.
- **Concurrent restore and AI turn from two tabs.** The client refuses a restore while a
  turn is pending in the same tab (tested). Two browsers against one document is not
  something this app defends against, and this chunk did not change that.
- **The `/restore` endpoint under a `LedgerInvariantError`.** The handler maps it to a
  500 with `ledger_invariant_violated: true`, matching `/checkpoint` and `/ai-edit`. That
  branch is not exercised by a test — I did not find a way to reach it without corrupting
  a file on disk mid-request.
- **`documents/00000000000000000000000000000000/draft.json`** (the 9-turn document from
  earlier chunks) was read but not opened in the history view, for the browser reason
  above.
- **Restoring to a turn in a document whose stored snapshots are non-canonical.** Cannot
  happen through any code path — `saveDocument` canonicalizes everything — so it is not
  tested.

---

# Addendum — four fixes from the live browser session

Status: all four landed. `npm test` **264 pass / 0 fail** (from 258).
`scripts/smoke-session.js` exits 0. `npx vite build` succeeds, `checkClientBuild()`
`fresh`. 11 further mutations applied (M17–M27), 11 caught.

This is the report §6 gap closing: "the history view has never been seen in a browser"
was the largest thing I named as unverified, and the first finding below is exactly what
that gap was hiding. The lesson is recorded rather than glossed — **a CSS-text assertion
pinned the wrong value and passed, because it was written from the same mistaken belief
as the CSS.**

## A1. The history ran under the sticky rail and hid Restore

`.history` was `grid-column: 1 / -1` — the full workspace width, on its own row. The
right rail is `position: sticky`, so on any real page it overhung that row and covered
the right-hand end of every turn entry, which is exactly where `.turn-restore` sits
(`margin-left: auto`). The view was unusable.

**Fixed:** `grid-column: 1` — the editor's column, the same width as the draft it
describes. It still lands on its own row below the draft, and it still is not a modal,
an overlay, or `position: fixed`. The M9 no-floating guard stays and is unchanged.

Also removed, under the same heading: `max-height` + `overflow-y: auto` on `.diff`
(22rem) and `.snapshot-text` (26rem). Those made two nested scroll boxes inside the page
scroll — the other way a control ends up somewhere a reader cannot get to. The history
now uses normal document scroll throughout. The built CSS confirms:
`.history{…grid-column:1…}` and zero `max-height` declarations in the bundle.

**The test that should have caught it, and why it did not.** The M9 guard asserted
`grid-column: 1 / -1` — it pinned the layout, but it pinned the *wrong* layout, because
I wrote the assertion and the CSS from the same wrong idea. A pin is only as good as the
belief behind it, and jsdom applies no stylesheet, so nothing headless could have
adjudicated. The guard is now stronger in the ways that are checkable without a renderer:

- `grid-column: 1;` asserted, **and `grid-column: 1 / -1` asserted absent**, with the
  reason in the message ("spanning the rail puts the sticky panel on top of the restore
  controls") — so the specific regression cannot come back silently;
- `.history`, `.diff`, `.snapshot-text`, `.turn-list` and `.turn` each asserted to have
  no `overflow: auto/scroll` and no `max-height`.

I am not claiming this makes the layout verified. It makes *this* regression caught.

## A2. The library's turn count went stale

The sidebar showed `test · 4 turns` while the panel showed 13. `refreshLibrary()` was
called only from `load()`, so the listing — which carries a per-document turn count — held
whatever was true at page load forever.

**Fixed:** the listing is re-fetched at every turn boundary and only at a turn boundary.

| path | refreshes when |
| --- | --- |
| `checkpointNow` | a turn was created (`result.turn`) |
| `submitPrompt` success | always — an AI turn always commits (§3) |
| `submitPrompt` failure | always — §2.4 step 2's human turn may have committed before the failure |
| `restoreTo` | a turn was created (the restore turn, or the pending-edit turn, or both) |

A commit that created no turn changed no count, so it does not re-fetch;
`refreshLibraryIfCommitted()` is where that decision lives. Awaited rather than fired and
forgotten, so the screen is consistent by the time the call returns, and matching what
`createDocumentHere` already did.

**A test-quality finding, found while mutation-checking this.** My first version asserted
`view.text()` matched `/2 turns/`. That passed under the mutation that removes the
checkpoint refresh — because the **history toggle** renders "History (2 turns)" and the
page-wide regex matched *that*. The assertion was measuring the panel's own count, which
was never the broken thing. Rewritten to read `.library .doc-meta` alone, anchored
(`/^2 turns$/`), with the panel count checked separately as agreement. Only then did
M19–M21 bite on the visible symptom rather than on the request count.

## A3. A single plain click on a link now opens it in a new tab

`LINK_OPTIONS.openOnClick` was `false`, so a plain click did nothing and only
⌘/Ctrl-click worked. Now `true`.

- **Always a new tab, never a navigation.** The extension's default `HTMLAttributes` put
  `target="_blank"` and `rel="noopener noreferrer nofollow"` on every rendered anchor,
  and its click handler calls `window.open(href, link.target)`. Asserted on a real
  mounted editor: the anchor carries `href`, `target="_blank"`, and a `rel` containing
  `noopener`.
- **Nothing overlays the draft** — asserted (`.lock-veil` absent, editor still editable).
- **Editing link text still works.** `enableClickSelection` stays `false` (the
  extension's default) so one gesture does one thing; the caret reaches link text by
  clicking adjacent text or by keyboard.
- **No effect on the store.** `target`/`rel` are render-time attributes;
  tiptap-markdown serializes `[text](href)` regardless. Round-trip identity and the
  fixed-point test are unchanged and still pass.

### FINDING — I documented the wrong safety mechanism, and the test found it

Enabling one-click activation means `window.open` is now handed an href on a single
gesture, so what may become a link became load-bearing. I wrote that
`protocols: ['http', 'https', 'mailto']` was what kept a `javascript:` URL out. **That is
wrong.** TipTap's `isAllowedUri` has a built-in base allowlist and the `protocols` option
can only ADD to it, never narrow it. Measured:

```
plain  javascript:alert(1)        plain  file:///etc/passwd
plain  data:text/html,x           LINK   tel:+15551234      -> tel:+15551234
plain  vbscript:x                 LINK   ftp://example.com/f
LINK   https://example.com/       LINK   sms:+1555
LINK   mailto:a@example.com       LINK   xmpp:a@b
```

So: **the script-bearing schemes are blocked, which is the part that matters** — by
TipTap, not by our config. And our three-entry `protocols` list is a no-op, since all
three are already in TipTap's base list; `tel:`, `ftp:`, `sms:`, `xmpp:`, `callto:` and
`cid:` are admitted too and always were.

**I did not narrow it,** and that is a deliberate call rather than an omission. A custom
`isAllowedUri` restricted to http/https/mailto would make TipTap drop a `tel:` link that
`canonicalize` happily keeps — which breaks round-trip identity for that construct and is
a §0.1 collision, to be reported before code, not worked around. The schemes that remain
are inert for `window.open`. **Flagging it for your decision; nothing is written that
depends on changing it.**

The code comment and the test comment now state the real mechanism. The test asserts the
behaviour (no `<a>` at all for javascript/JaVaScRiPt/data/vbscript, text surviving as
prose) **and** that http/https/mailto still do produce anchors — so the check cannot pass
by making nothing a link.

Mutation-verified separately: with `javascript` added to `protocols` *and* the config
assertion deleted, the suite still passes, which is the evidence that `protocols` is not
the guard. That is why the config assertion is labelled documentation in the test.

## A4. Raw JSON link

A small `raw JSON` link in the panel's meta list, pointing at
`/api/t/{token}/documents/{slug}` — **the endpoint the app already loads from (§5). No
new route, nothing to keep in sync.** `target="_blank"`, `rel="noopener noreferrer"`, an
`<a>` and not a form or a button, so it is read-only by construction and never navigates
the draft away. The href is built in `App.js`, where the token lives; `AiPanel` receives
a finished `rawUrl` and never learns what a token is, which keeps §0.5's "no handler
reads the token" habit intact on the client side too.

## Verification

`npm test` — **264 pass / 0 fail** (+6). `components.test.js` 25 → 31,
`history.test.js` 17 (one rewritten). Smoke exit 0. Client rebuilt, `fresh`.

### Mutation checks — 11 applied, 11 caught

| # | mutation | first failure |
| --- | --- | --- |
| M17 | `.history` back to `grid-column: 1 / -1` | `the editor's column, not the full grid width` |
| M18 | `.diff` given `max-height` + `overflow-y: auto` again | `.diff must not become its own scroll container` |
| M19 | no library refresh after a checkpoint | `a checkpoint moved the sidebar` |
| M20 | no library refresh after an AI turn | `an AI turn moved the sidebar` |
| M21 | no library refresh after a restore | `a restore moved the sidebar` |
| M22 | library refreshed on every commit attempt, turn or not | `no turn, no boundary, no request` (`2 !== 1`) |
| M23 | `openOnClick: false` | `a single plain click must open the link` (`false !== true`) |
| M24 | `HTMLAttributes: { target: null }` | `null !== '_blank'` |
| M25 | `javascript` added to `protocols` | `Expected values to be strictly deep-equal` (config assertion) |
| M25b | M25 **plus** the config assertion deleted | **passes** — the evidence that `protocols` is not the guard |
| M26 | raw JSON link `target="_self"` | `never navigates the draft away` (`'_self' !== '_blank'`) |
| M27 | raw JSON link points at an invented `/raw/` route | `'/api/t//raw/'` ≠ the real endpoint |

## Still not verified

- **The fixed layout has still not been seen in a browser by me.** The Chrome extension
  is not connected in this session and there is no `ANTHROPIC_API_KEY`, so I verified
  A1 by reading the rule out of the built bundle and by the strengthened CSS-text
  assertions — not by looking at it. **A1 was a browser finding and its fix deserves a
  browser confirmation; please check it before ratifying.** Specifically worth a look:
  that the history now sits under the editor at the editor's width, and that Restore is
  reachable on every entry at a narrow window (the `max-width: 60rem` single-column
  case, which I have reasoned about but not seen).
- **The click gesture itself is not driven headlessly.** ProseMirror's `handleClick`
  fires from a mousedown/mouseup pair resolved through `posAtCoords`, which needs layout
  jsdom does not have. What is asserted is the configuration (`openOnClick === true`) and
  the rendered anchor's `href`/`target`/`rel` — which together are what the handler acts
  on, but the gesture is inferred, not exercised. **Worth one manual click in the browser.**
- **`rel="noopener noreferrer nofollow"` is inherited from the extension's defaults, not
  pinned by us.** The test asserts the rendered anchor has it, so a TipTap upgrade that
  changed the default would fail here — but we do not set it ourselves.
- **Whether a long diff reads well now that its scroll box is gone.** Removing
  `max-height` means a large turn renders at full height and the page grows. That is the
  correct trade against hiding a control, but I have not looked at a 3000-word turn.
