# Chunk 10 — UI cleanup (§12)

Build order step 10. The §12 layout, and nothing beyond it. Model Response and
Standing Rules are empty boxes; their behaviour is steps 11 and 12.

**Status: complete.** 274 tests pass (was 264; +10 net, +14 new less 4 replaced),
`node scripts/smoke-session.js` green at 29 assertions, `npx vite build` clean.

---

## 1. What I built, file by file

### New

**`client/src/TopBar.js`** (215 lines) — the top row. Renders exactly the five §12
controls in the spec's order: Show/hide history · document name · + New document ·
Export transcript · Checkpoint. All five wear one class, `.top-button` (lilac).

Two decisions inside it that are not cosmetic:

- *Checkpoint carries the dirty signal itself.* §12 removed the status row that
  used to say `Uncommitted edits: yes`, so if the button did not say it, nothing on
  screen would. It is said twice — a `.dirty-dot` marker and an `aria-label` that
  changes to `Checkpoint — you have uncommitted hand edits` — because a coloured
  dot is not a fact a screen reader can pass on.
- *The switcher and the new-document field are drawers, not popovers.* They push
  the page down rather than floating over it, and they live in the `<header>`, not
  in the workspace. §12 wants nothing overlaying the draft; an absolutely
  positioned menu is the cheapest way to end up with something that does. Only one
  is open at a time.

The switcher also carries §0.5's capability disclosure, which had to land
somewhere when the old masthead paragraph went: it is now beside the list of
everything the link actually reaches, which is a better place for it than under
the page title.

**`client/src/PromptBox.js`** (150 lines) — box 1. Textarea, `+` bottom-left,
Submit bottom-right in forest green, ⌘/Ctrl+Enter. It also carries the turn's
outcome: the §0.2 pending indicator, errors, notices, and the §2.3 warnings. All of
that is the old `AiPanel` content, moved and re-labelled, not rewritten.

**`client/src/ModelResponse.js`** (35 lines) — box 2. Empty, and says so.

**`client/src/StandingRules.js`** (30 lines) — box 3. Empty, and says so.

Both empty boxes carry a sentence rather than being blank. §4 requires that a
speech-only turn "must not look like a rendering failure"; a box that has never
been filled at all is the same hazard, and an empty grey rectangle in a column of
three reads as something that failed to load.

**`client/src/transcript.js`** (72 lines) — `buildTranscript`,
`transcriptFilename`, `saveJson`. §4's Export transcript. Built from
`state.history`, which the client already holds, so there is no new endpoint and
nothing that can disagree with what the history view shows — it is the same array.
Everything `saveJson` touches (`document`, `URL`, `Blob`) is injectable, because
jsdom implements neither an object URL nor a download and a test that stubbed the
whole function would only prove the stub works.

### Rewritten

**`client/src/App.js`** — the §12 surface. `<header>` holds the h1 and the top row;
`<main class="workspace">` holds the editor left, the three-box rail right, and the
history below the editor in the editor's own column (unchanged from chunk 8). Gains
one injected prop, `saveFile`, for the same reason `navigate` was injected.

**`client/src/styles.css`** (665 → 735 lines) — added the lilac tokens and the
`.top-row` / `.top-drawer` / `.box` rules; removed `.panel*`, `.library*`, `.meta`,
`.raw-json`, `.panel-actions`, `.capability` (rebuilt), `.history-toggle`. Every
editor, history, diff and snapshot rule is carried over byte-for-byte.

### Deleted

**`client/src/AiPanel.js`**, **`client/src/Library.js`** — §12 removes the
Documents panel and the status row below the separator. Their surviving content is
in `PromptBox` and `TopBar`.

### Tests

**`test/components.test.js`** — 30 → 41 tests. Fourteen new, four replaced (the two
raw-JSON tests, and the two turn-count assertions that read a row §12 deleted).

---

## 2. What I verified, and how

Per file, `node --test` on each in isolation. Never a bare total.

| file | pass | fail |
|---|---|---|
| ai-edit.test.js | 13 | 0 |
| ai-response.test.js | 10 | 0 |
| anthropic-client.test.js | 6 | 0 |
| canonicalize.test.js | 60 | 0 |
| client-build.test.js | 8 | 0 |
| clipboard-paste.test.js | 10 | 0 |
| **components.test.js** | **41** | **0** |
| draft-session.test.js | 20 | 0 |
| history.test.js | 17 | 0 |
| namespace.test.js | 21 | 0 |
| round-trip-identity.test.js | 18 | 0 |
| storage.test.js | 18 | 0 |
| tiptap-fixed-point.test.js | 20 | 0 |
| turns.test.js | 12 | 0 |
| **total** | **274** | **0** |

`node scripts/smoke-session.js` — 5 turns, 29 assertions, exit 0. Unchanged by this
chunk; it drives the store directly and never touches the UI, which is why it is
worth having as the thing that says the provenance model still holds after a
layout rewrite.

### The 14 new tests, grouped

**Top row (4).**
- the five named controls, in the spec's order, all lilac — asserts the exact
  label sequence, that every one of them carries `.top-button`, and that no
  `.submit` (forest green) appears in the top row. That last one is the other half
  of §12's button split: green is the primary action *inside a box*, and a top-row
  control wearing it has left the rule.
- the document name opens the switcher and closes it again — including that §0.5's
  capability sentence survived the move.
- only one drawer is open at a time, and neither one overlays the draft — asserts
  the drawer is inside `.masthead` and *not* inside `.workspace`, and that the
  editor is still mounted and still editable with a drawer open.
- Checkpoint carries the uncommitted-edits signal — drives a real hand edit through
  the real TipTap editor, then checks class, dot, and `aria-label` in all three
  states (clean → dirty → committed).

**Export transcript (4).**
- saves the whole ledger as JSON — filename, `slug`, `exported_at`, and
  `deepEqual` against the fixture ledger turn for turn, including the exact prompt
  string (§3) and a full snapshot on every turn (§0.4). Asserts no `diff` field,
  since §5 says diffs are computed and never stored, and asserts the payload
  survives a JSON round-trip because that is the file it becomes.
- a document with no turns has no transcript — the control is disabled, says why,
  and a click writes no empty file.
- the raw-JSON link is gone — `.raw-json`, `.meta`, `.library`, `.panel`, and the
  strings "raw JSON" and "Uncommitted edits" are all absent. A removal is a claim
  and it should fail if someone puts one back.
- `saveJson` hands the browser a named, downloadable file, then lets it go — the
  wiring the App test stubs out, with the four things it touches injected: one
  click, right filename, anchor attached *before* the click, blob revoked after.

**Right column (3).**
- three boxes, top to bottom, in the spec's order — by heading text, and nothing
  else in the column.
- the two empty boxes say what they are for — and are genuinely empty: no button,
  no input, no list item in either.
- `+` bottom-left and Submit bottom-right, in forest green — DOM order, the
  `.submit` class, the `+` disabled and saying why, no chips, plus the
  `justify-content: space-between` rule pinned against the stylesheet text.

**Lilac contrast (1).** §12 says to check lilac for contrast against the cream
ground before shipping it. That is a checkable claim, so it is a test rather than
a thing I eyeballed. It parses the custom properties out of the stylesheet and
computes WCAG ratios:

| pair | ratio | threshold |
|---|---|---|
| `--ink` on `--lilac` (every button label) | 12.30:1 | 4.5:1 (AA text) |
| `--lilac-edge` on `--paper` (the control boundary) | 3.39:1 | 3:1 (1.4.11 non-text) |
| `--lilac-deep` on `--lilac` (the dirty marker) | 4.05:1 | 3:1 |
| white on `--accent` (Submit) | 7.49:1 | 4.5:1 |

The fill alone is **1.37:1** against the paper — nowhere near enough to read as a
control on its own. That is why `--lilac-edge` exists, and the test asserts the
fill is *below* 3:1 so that if someone ever darkens it enough to stand on its own,
the test tells them the border stopped being load-bearing rather than silently
agreeing.

### Two tests that changed shape rather than intent

**"the document list refreshes on every turn boundary."** This is the chunk-08 bug
where the sidebar said 4 turns and the panel said 13. Both of the surfaces it
compared moved in this chunk: the listing is now in the switcher drawer, and the
client's own count is now on Export transcript's title. The staleness it guards
against did not move — the listing is still fetched, still carries a per-document
count, still goes stale without a re-fetch — so the test still compares the
server's number against the client's, from their new locations, and still asserts
exactly four `list` calls with no polling.

**"Checkpoint that made a turn names it, and the turn count moves."** The
`Turns: 2` row it read is deleted. It now reads Export transcript's title, which is
the control that acts on the count.

I checked every changed assertion still fails when the behaviour breaks rather
than just when the selector moves — see §3.

---

## 3. Mutation checks

Ten mutations, applied to `client/src/`, one at a time, each reverted from a
byte-compared backup afterwards. All ten failed the intended test and only that
test.

| # | mutation | test that caught it | exact message |
|---|---|---|---|
| 1 | swap the first two top-row controls | top row is the five named controls | `AssertionError: Show/hide history · document name · + New document · Export transcript · Checkpoint` — `actual: [ 'draft', 'Show history', … ] expected: [ 'Show history', 'draft', … ]` |
| 2 | drop the dot and the `checkpoint-marked` class when dirty | Checkpoint carries the uncommitted-edits signal | `AssertionError: the sighted half of the signal` — `actual: 0, expected: 1` |
| 3 | `turns: history.slice(0, -1)` in `buildTranscript` | Export transcript saves the whole ledger | `AssertionError: the ledger as it stands, turn for turn` — actual holds turn 1, expected holds turns 1 and 2 |
| 4 | `--lilac: #6f5c9a` (dark enough to fail as a text ground) | lilac is checked for contrast | `AssertionError: ink on lilac is 3.04:1, below the 4.5:1 AA text minimum` |
| 5 | remove `justify-content: space-between` from `.box-actions` | `+` bottom-left and Submit bottom-right | `AssertionError: the two-ends layout is a real rule, not just DOM order` — actual `.box-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem; }` |
| 6 | empty the Model Response sentence | the two empty boxes say what they are for | `AssertionError: The input did not match /nothing to say yet/. actual: 'Model Response'` |
| 7 | delete `urls.revokeObjectURL(href)` | saveJson hands the browser a file | `AssertionError: and the blob is released, not left alive for the tab` — `actual: [], expected: [ 'blob:fake' ]` |
| 8 | move the top row from `<header>` into `.workspace` | only one drawer is open at a time | `AssertionError: the drawer is in the header` — `actual: null, expected: true` |
| 9 | put a `.raw-json` link back in the prompt box | the raw-JSON link is gone | `actual: 1, expected: 0` |
| 10 | render the switcher unconditionally | the documents in this namespace are listed | `AssertionError: the switcher is closed until asked for` — `actual: 1, expected: 0` |

**Mutation 5 exposed a real defect in my own test and I fixed it.** The
`space-between` assertion originally matched against the whole stylesheet, so its
failure diff printed all 735 lines of CSS — the same class of unusable failure
output the chunk-07 report recorded for `assert.equal(view.find(sel), null)`. It
now extracts the `.box-actions` rule first and matches inside it, which is the
shape the existing empty-state check already used. Re-run after the fix: the
message above is the narrowed one.

---

## 4. Fixtures

**No fixture changed in this chunk.** Nothing here reads them; §12 is layout.
Recorded so the absence is a checked fact rather than an omission:

`test/fixtures/draft-fixture.md` — md5 `c66d08049d76aade4fd2de84c495290d`, 47
lines. `word.html` — md5 `d396906e784c2f2d7b6c9f2e4f4ee478`.
`google-docs.html` — md5 `19c70fdbd0afc0e85e23ae4bb78c56b0`.

Walked item by item against §5's list, all 31 Markdown constructs present:

bold ✓ · italic ✓ · bullet list ✓ · two adjacent bullet lists ✓ (§0.1 merge) ·
inline link ✓ · bare URL ✓ · self-titled link, input form ✓ (§0.1
`resourceLink: false`) · literal asterisk ✓ · underscored identifier ✓ · percent
sign ✓ · Word paste: smart quotes / em dash / ellipsis / nbsp ✓ · Word paste
hyperlink ✓ · Google Docs paste: curly apostrophe / single quotes ✓ · Google Docs
paste hyperlink ✓ · underscore emphasis to normalize ✓ · underscore strong to
normalize ✓ · star bullets to normalize ✓ · wide list indent to normalize ✓ ·
trailing whitespace to normalize ✓ · stacked blank lines to normalize ✓ · stray
underscore ✓ · link target with parentheses ✓ · literal backslash ✓ · backslash
before a letter, Windows path ✓ · entity text `&amp;` / `&nbsp;` ✓ · ampersand
before a letter ✓ · mailto link ✓ · mailto link with a query string ✓ · a loose
bullet list ✓ (§0.1 tightening) · nested bullet list ✓ · multi-paragraph list
item ✓ (the blank line that must survive).

Clipboard fixture, both payloads complete — Word: mso- style noise ✓ · `<o:p>`
runs ✓ · `class=MsoNormal` ✓ · heading ✓ · table ✓ · mso-list fake bullets ✓ ·
hyperlink ✓ · hyperlink inside a bullet ✓ · bold ✓ · italic ✓ · smart quotes and
em dash ✓. Google Docs: `docs-internal-guid` wrapper ✓ · `<b>` wrapper with
`font-weight:normal` ✓ · per-run span styling ✓ · heading ✓ · table ✓ · real
`<ul>` ✓ · `google.com/url` redirector ✓ · bold as `font-weight:700` ✓ · italic as
`font-style:italic` ✓ · curly apostrophes and single quotes ✓.

Also unchanged, and worth saying because a layout chunk is exactly where it could
be broken without noticing: the §5 third fixture (context bundle) does not exist
yet and is not needed until step 12.

---

## 5. Named findings

**F48 — the `+` is in the layout but attaches nothing.** §12 puts an add-a-file
control bottom-left of the Prompt box, but context files are §8 and land in step
12. I built the control into its §12 position, `disabled`, with a title naming §8,
rather than leaving the slot empty. Reasoning: step 10's job in the Build order is
"the frame the rest builds into", and a frame missing one of its named parts is
rearranged by the next chunk rather than filled by it. The cost is a visible
control that does nothing this chunk. The alternative — omit it, add it in step 12
— was the other reasonable call and I did not take it; say so if you would rather
have it out. **This is a convenience decision, not spec conformance.**

**F49 — Export transcript wraps the ledger in two fields.** §4 says "the full
ledger as JSON" and does not give a shape. I export
`{ slug, exported_at, turns: [...] }` rather than a bare array. `slug` because
`draft-transcript.json` in a folder of them is not self-identifying once it is out
of the app; `exported_at` because §11's K4 turns on reconstructing when things were
looked at. `turns` is the ledger verbatim. **Spec conformance on the content,
invention on the wrapper** — the two extra fields are mine.

**F50 — the history toggle lost its turn count.** It said `History (2 turns)`; it
now says `Show history` / `Hide history`, which is §12's own wording. §12 removed
the turn-count row, and I did not want to delete a count from one place and keep it
in another. The count is still visible in two places: the History view's own head
("2 turns, newest first") and Export transcript's title. **Spec conformance.**

**F51 — §0.5's capability disclosure moved into the switcher drawer.** It was a
permanent paragraph under the page title; §12's top row has no room for it and the
old masthead is gone. It now sits in the document switcher, beside the list of
every document the link reaches — which is where the sentence is actually about
something. It is no longer visible without a click. §0.5 requires the namespace
"be described that way to anyone given a link" and does not say where; I read a
click as satisfying that, but this is the one §12 change that makes a §0.5
obligation less prominent, so it is flagged rather than buried. **Say if you want
it back on the surface.**

**F52 — §2.3 warnings are in the Prompt box, not Model Response.** Warnings are
the model reporting on a turn, which is arguably speech. They stayed with the
prompt because you scoped Model Response to empty this chunk, and putting a
validation warning in it would make an empty box look populated. Step 11 should
probably move them; I have left `.status.warning` intact so that is a move, not a
rewrite.

**F53 — a top-row control is disabled while anything is in flight.** Checkpoint and
+ New document take `busy`; Export transcript and Show history do not, because
reading the ledger you already hold is safe mid-turn and refusing it would be
arbitrary. Not specified either way in §12.

---

## 6. What the spec was underspecified about

**§12 does not say where the turn's error, notice and pending status go.** It names
three boxes and says the pending indicator is "in the panel". I put all four
statuses in the Prompt box. See F52.

**§12 does not say whether the masthead survives.** It lists what is *removed* (the
Documents panel, everything below the separator) and the h1 is neither. I kept
`One draft, two hands` above the top row. It is now slightly redundant with the
document name sitting two lines below it — small, and easy to drop if you want the
top row to be the whole header.

**§12's "document name (opens a switcher)" does not say what the switcher contains
beyond documents.** I put §0.5's disclosure there too (F51).

**§4's "Export transcript" does not say button-or-link, or what shape.** See F49.
I read "from a button in the top row" as meaning a real download rather than a tab
of JSON, since the raw-JSON *link* it replaces was already the tab-of-JSON version
and replacing a link with a link would not be a replacement.

**No §0 collision.** Nothing in this chunk needed a locked decision to be different.
§0.2's three states are untouched — this chunk still knows only `locked` and
`unlocked`, and `disposition` arrives with step 13 as planned.

---

## 7. What I did NOT verify

**I did not look at this in a browser.** This is the important one. The chunk-08
addendum records a layout bug — the history spanning `1 / -1` and sliding under the
sticky rail, covering every Restore control — that no headless test could have
caught, because jsdom applies no stylesheet. This chunk is *entirely* layout, so it
is the chunk most exposed to that class of bug, and I could not do the check: the
Chrome extension reported `Browser extension is not connected`.

What I did instead, which is weaker and does not substitute:
- served the app at `localhost:3117` and confirmed it returns 200 and the built CSS
  contains the new rules with correct values — `.top-row{…display:flex}`,
  `.box-actions{justify-content:space-between…}`, `.rail{…position:sticky}`,
  `.history{…grid-column:1}`, and all four lilac tokens;
- confirmed `.history{grid-column:1}` is carried over unchanged, so the chunk-08
  bug specifically has not regressed;
- pinned in tests the two rules whose *effect* is invisible headlessly
  (`space-between`, and the lilac ratios).

**Please open it before ratifying.** Specifically worth a look: whether the top row
wraps badly at narrow widths, whether the drawer pushing the page down is
tolerable or annoying in practice, whether the three boxes stacked in a 22rem rail
leave the Prompt box enough room, and whether the lilac actually looks right on the
cream rather than merely measuring right.

**I did not verify the download itself.** `saveJson`'s wiring is tested with
injected `document`/`URL`/`Blob`; that a real Chrome writes a real file to
Downloads is unverified.

**I did not verify drag-and-drop onto the prompt box.** §12 asks for it "if it can
be had cheaply". It cannot, before there is anything to drop — it is part of §8's
attachment path and belongs to step 12.

**I did not verify keyboard navigation or focus management on the drawers.** Escape
closes the new-document field (carried over from the old Library form); the
switcher has no Escape handler and neither drawer traps or restores focus. Not
specified, not tested, named here.

**I did not verify how any of this behaves at the `max-width: 60rem` breakpoint**
where the rail drops below the editor. The rule is carried over untouched from
chunk 8 but the rail's contents are entirely different now.

---

## 8. Stopping here

Step 10 is done. Step 11 (model speech, §0.7 and the interim §2.2 contract) is the
next one and I have not started it. The seams it needs are in place: `.box-response`
is an empty component whose only job is to be filled, and `.status.warning` is
intact and separable when speech arrives to take its place.
