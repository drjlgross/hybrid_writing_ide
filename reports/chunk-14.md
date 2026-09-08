# Chunk 14: export viewer + history-on-by-default

**Status: complete.** `npx vite build`, `npm test` (442 pass, 0 fail, 0 skipped) and
`node scripts/smoke-session.js` (6 turns, 38 assertions) all pass. Nothing committed
or pushed.

Two user-facing changes and no server-side state, as the brief required, plus two
revisions the human asked for after seeing it running (§2, Part A revisions).

---

## 1. What was built, file by file

### New

**`client/src/export-schema.js`** — reading the §4 wrapper back.

`readExport(text, filename)` takes the file's BYTES and returns
`{ok: true, transcript}` or `{ok: false, error}`. It never throws: a viewer whose
failure mode is an exception has a blank page as its failure mode, and a blank page
is indistinguishable from a page that did not load.

Validation, in order: non-empty → parses as JSON → is a plain object → has
`schema_version` → it equals `SCHEMA_VERSION` → `turns` is an array. The constant is
IMPORTED from `src/schema.js`, never re-declared, so the reader cannot drift from
the writer.

`indexById(table)` builds a `Map` for resolving `context_ref` / `rules_ref`. A Map
rather than an object literal because the ids come from a file this code did not
write, and `{}` would answer `constructor` and `__proto__` with something that is
not a record.

**`client/src/Viewer.js`** — the page. File-open control plus page-wide
drag-and-drop, the empty state, the inline error, and the loaded transcript: the
Current Draft card, then the history. Renders `History` with no `onRestore`.

**`client/src/DraftCard.js`** — the Current Draft card. The last turn's snapshot,
rendered by a real TipTap editor built from the app's own `buildExtensions()` with
`editable: false`. See the Part A revisions below for why a real editor.

**`client/src/Chrome.js`** — `Wordmark` and `Colophon`, the two pieces of furniture
both pages wear. Extracted because there are now two pages, and a wordmark that
exists twice is one that will eventually say two different things.

**`test/viewer.test.js`** — 16 tests in three groups (§3 below).

### Changed

**`client/src/History.js`** — two new props, no behavioural change for the app:

- **`onRestore` absent → no Restore control.** Read-only is the ABSENCE of the
  callback, not a boolean beside it. A `readOnly` flag could be `false` while
  `onRestore` was missing, and the button would render and then throw on click.
- **`tables` present → the turn also shows its `segments` and resolves its
  `context_ref` / `rules_ref`** against the export's own tables. The live app passes
  none, so the live history is byte-identical to before.
- **`emptyMessage`**, because "no turns yet" means two different things (§2 Part B).
- **The newest-turn marker now depends on `tables`**: "the live draft" in the app,
  "where the draft stood at export" in a transcript. Found in the browser — see §4,
  mutation 7.

**`client/src/App.js`** — `showHistory` defaults to `true`; uses `Wordmark` and
`Colophon` instead of its own copies.

**`client/src/main.js`** — routes `/view` to `Viewer` before the `/t/…` branch.

**`src/addressing.js`** — `VIEWER_ADDRESS`, `isViewerAddress()`, `isClientPath()`.

**`src/server.js`** — the SPA middleware now asks `isClientPath(req.path)` instead
of testing its own inline regex. Six lines, all of them routing. No turn, storage or
AI logic was touched.

**`client/src/styles.css`** — the viewer page and the provenance block. The history
stylesheet is reused whole.

**`test/components.test.js`, `test/history.test.js`** — updated for Part B (§2).

---

## 2. The two changes

### Part A — how `/view` is routed

**One bundle, two pages.** Vite has one entry; the client reads
`window.location.pathname` and renders `Viewer` or `App`. A second Vite entry would
have shipped the history components twice and given the two copies room to disagree.

**The predicate lives in `src/addressing.js`, and both ends import it.** The server
asks "does this path get the bundle?" and the client asks "which page is this?".
Those are two halves of one guarantee — that `/view` and `/t/{token}/{slug}` never
overlap — and two files each carrying half is how an overlap gets introduced. So:

```js
export const VIEWER_ADDRESS = '/view';
export function isViewerAddress(pathname) { return /^\/view\/?$/.test(…); }
export function isClientPath(pathname) {
  return /^\/t\/[^/]+(\/[^/]*)?\/?$/.test(path) || isViewerAddress(path);
}
```

Server side, the existing SPA middleware became `if (!isClientPath(req.path))
next()`. Nothing else moved.

**Why it cannot collide**, each reason structural rather than a matter of ordering:

- `/api/t/:token` is mounted above and owns everything under `/api`.
- Every document address begins `/t/`, and §0.5's token is exactly 32 hex
  characters — `view` is neither.
- `express.static` runs first, so a real file named `view` would already have been
  served. There is none, and if one appeared the static handler winning would be
  correct.

`isClientPath` is deliberately LOOSER than `parseDocumentAddress` on the token:
`/t/nonsense/x` is served the bundle so the client can render "that link does not
name a document" (§0.5 — rejected, never repaired). A 404 there would be the server
refusing to explain a link someone was handed.

**The route is inside the `existsSync(CLIENT_DIST)` block**, so with no build `/view`
falls through to Express's 404 exactly as `/t/…` does. That is consistent rather than
new, but it is F89's shape and it is why the routing tests do not depend on a build —
see §3.

**Nothing else was added to the server.** No upload endpoint, no storage, no session,
no namespace access. The only call the page makes is `GET /health`.

### Part A revisions, after the first look

Both asked for once the page was running, and both are in the spec (§12a).

**The subtitle is now "Read the History"**, not "A read-only view of an exported
session".

**A Current Draft card sits above the timeline.** It renders the LAST turn's
`snapshot` — which §0.3 makes the draft as it stood at export — as text rather than
as a record. The reasoning is the one the human gave: a reader wants the bottom line
up front, and reconstructing it by scrolling to the oldest entry and reading forward
is work nobody should have to do. Nothing is recomputed; full snapshots (§0.4) exist
exactly so a reader never replays a chain to find out what the text is.

**It is rendered by a real TipTap editor**, `editable: false`, and that decision is
the one worth defending in a page whose whole promise is that it edits nothing:

- It is the SAME renderer the app draws the live draft with, from the same
  `buildExtensions()` the round-trip tests run against. A Markdown-to-HTML pass
  written for this page would be a second renderer, free to disagree with the editor
  about what a draft looks like — §0.1's failure one layer up.
- The §1 dialect comes with it, stripped by the extension list rather than by a rule
  written here, and `LINK_OPTIONS` brings the `javascript:` href guard unchanged.
- It costs no bundle weight and no dependency: TipTap is already in this bundle.
- `editable: false` means the document takes no caret at all — not a disabled
  control, not a CSS overlay. The browser reports `contenteditable="false"`.

Two empty states, deliberately distinguished: a transcript with **no turns** gets no
card (a "Current Draft" heading over nothing is worse than its absence), while a
session that **ran and ended with the draft empty** gets the card saying so.

### Part B — the history renders open

`useState(false)` → `useState(true)`. Per-session only: no localStorage, no
per-document setting, nothing in the document JSON. A reload opens it again.

The Show/hide control is untouched and still toggles both ways; its resting label is
now "Hide history".

The empty-state copy moved from *"No turns yet. Checkpoint, or send an instruction,
and this fills in."* to *"Every change — yours and the model's — will be recorded
here, turn by turn."* This matters more than it looks: the history is now the first
thing a brand-new document shows, and the old copy made the product's own record
read as an error state on first paint.

§12's constraints are unchanged and were re-verified in a browser (§3): the history
stays in the editor's column, is not an overlay, and the rail is still reachable at
the bottom of an 11,456px page.

---

## 3. What was verified, and how

### Test groups

| group | tests | result |
| --- | --- | --- |
| `viewer.test.js` 1 — routing | 3 (1 build-dependent) | 3 pass |
| `viewer.test.js` 2 — reading the bytes | 4 | 4 pass |
| `viewer.test.js` 3 — the page | 12 | 12 pass |
| `history.test.js` (incl. 1 new) | 15 | 15 pass |
| `components.test.js` (7 updated) | 46 | 46 pass |
| whole suite, `npm test` | **442** | **442 pass, 0 fail, 0 skipped** |

442 = 423 before this chunk + 19 in `viewer.test.js`. `npm test` gained 20 net (19
viewer, 1 history) and lost none.

**The routing tests do not need a build.** CI runs `npm test` *before* `npm run
build`, so a `/view` test that only worked in a built tree would be a test CI never
runs — F89's exact shape, caught this time before shipping rather than after. So the
collision requirement is asserted against `isClientPath` / `isViewerAddress`
directly, and the one test that starts a real server checks `client/dist` first and
calls `t.skip()` with a reason when it is absent. Locally the tree is built and it
runs, which is why the run above reports 0 skipped.

### The viewer rendering a real export, end to end

The end-to-end path is **writer → bytes → reader → DOM**, with no hand-written
fixture in the middle: the test builds a ledger, passes it through
`buildTranscript()` — the same function the Export transcript button calls —
`JSON.stringify`s it, and hands those bytes to the Viewer as a file. If the writer
and the reader ever disagree about the wrapper, this fails.

Then the same thing again in a real browser, against the real server, through the
real file input. `PLAYWRIGHT_BROWSERS_PATH=0`, loopback only, disposable script since
deleted (no committed browser artifact — that arrives with a chunk that names one).

A 3-turn transcript (human turn, AI turn with note + segments + refs + a §2.3
warning, speech-only turn) rendered:

- **3 turns, newest first**, Turn 3 / Turn 2 / Turn 1, badges AI / AI / Human.
- **Diffs computed in the browser from the snapshots.** Turn 2's diff struck
  "into place" and "quietly," out of the opening line; Turn 1 rendered as a full
  insertion. Nothing in the file carries a diff (§0.4, §5) — the page did the work.
- **Speech in its own record** (`.turn-speech`), on the white surface, never inside
  the diff (§0.7, §9 S12).
- **The §2.3 report** — "a heading was stripped from the response", `heading: 1` —
  in `.turn-reported`, separate from the note, per F52.
- **§0.9's speech-only turn**: the note plus "No change to the draft. The model
  answered without proposing a revision…".
- **Segments**, tagged `edit` and `question`, with what the model took each part of
  the prompt to be.
- **Refs resolved**: `tone-reference.md — look to this for length and tone, not
  content`, and the standing rule `no em-dashes — scope: the whole document`.
- **An unresolved ref shown**: `ctx-gone — not in this export`.
- **Zero Restore controls** (`.turn-restore` count: 0), while "Open turn N
  read-only" still works.
- **The Current Draft card above all of it**, headed *Current Draft*, holding the
  final snapshot with `**bold**` as bold, `*aside*` as italic, two bullets as a
  list and `[the docs](…)` as an anchor — `contenteditable="false"` on the
  document. The source markers are gone from the rendered text, which is what
  "a clean render" has to mean.
- Footer: `WordWright v0.1.1`, from `/health`.

Screenshots of the empty state and the loaded transcript were taken and read.

### The browser checks jsdom cannot make

- **`/view` over HTTP: 200**, serving byte-identical HTML to
  `/t/{token}/draft` — one bundle, two pages — while `/health` still answers JSON.
- **The history is open on load** with no click; the toggle reads "Hide history".
- **F65 still holds.** With the history open the real document is 11,456px tall.
  Scrolled to 10,556, the rail's bounding box was at `top: 24` — on screen. The
  sticky rail survives Part B, which is the one §12 constraint Part B could
  plausibly have broken.

---

## 4. Mutation checks

Seven mutations, applied to the real files, run, reverted. Six were caught; the
seventh was not, and that is the most useful line in this report.

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 1 | `/^\/view\/?$/` → `/^\/view/` (a prefix match) | `/view is the viewer…` and the collision test | `AssertionError [ERR_ASSERTION]: "/viewer" is not the viewer` |
| 2 | the `schema_version !== SCHEMA_VERSION` branch made unreachable | `every way a file fails…` and `a newer schema is refused whole…` | `AssertionError: "{\"schema_version\": 2, \"turns\": []}" must be refused` |
| 3 | `readExport` rethrows the JSON parse error | 3 tests, including both viewer error-state tests | (the raw `SyntaxError` propagates out of the component) |
| 4 | the viewer passes `onRestore` to History | `the viewer is read-only: no Restore, on any turn, ever` | `AssertionError [ERR_ASSERTION]: and not one Restore control` |
| 5 | unresolved refs return `null` instead of a row | `segments and refs resolve…` | `AssertionError: The input did not match the regular expression /ctx-gone/` |
| 6 | `showHistory` back to `useState(false)` | 5 tests in `components.test.js` | `AssertionError [ERR_ASSERTION]: the timeline is open on load, with no click` |
| 7 | the marker says "the live draft" in a transcript | **nothing** — see below | — |

**Mutation 7 is the finding.** The newest-turn marker reads "the live draft", which
is true in the app and false at `/view`: the session may be over, or on another
machine. I found it by looking at a screenshot, not by running a test, and when I
mutated the fix back the suite stayed green — nine viewer tests, none of them
watching that string.

Fixed twice: the marker now says "where the draft stood at export" when `tables` is
present, and a test pins it. Re-run under the mutation, that test now fails with
`The input did not match the regular expression /where the draft stood at export/`.
Recorded here rather than quietly patched because it is the honest answer to "how
much does this suite cover": a whole class of wrong-but-plausible copy was invisible
to it until a browser made it visible.

Four more against the Part A revisions, all caught:

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 8 | the card shows `turns[0]`'s snapshot, not the last | `the Current Draft is the last turn's snapshot…` | `AssertionError: The input did not match the regular expression /The opening line settles\./` |
| 9 | `editable: false` dropped from the card's editor | same test | `AssertionError [ERR_ASSERTION]: the draft cannot be typed into` |
| 10 | the old subtitle restored | `before a file is opened, the page says what it is…` | `AssertionError [ERR_ASSERTION]: and what this page is` |
| 11 | the card moved below the history | `the Current Draft is the last turn's snapshot…` | `AssertionError: the draft comes before the history: viewer-about box-surface \| history \| draft-card` |

Final state re-verified on the reverted tree: 442/442, smoke passes, build succeeds.

---

## 5. Changes to shared artifacts

**No §5 fixture was read or written** — not the Markdown fixture, not the clipboard
fixture, not the context bundle. The viewer's test data is a ledger declared in
`test/viewer.test.js` and passed through the real `buildTranscript`.

**The export format is unchanged.** `transcript.js` was not edited. `export-schema.js`
only reads.

**`src/` turn, storage and AI logic untouched.** The two `src/` files that changed
are `addressing.js` (pure routing, no `node:` imports, already shared by client and
server) and `server.js` (the SPA middleware line). Both are the "client
routing/serve wiring needed to make /view reachable" the brief allows.

**§0 untouched.** Verified by diff.

§12a also records the Current Draft card and the subtitle, added with the
revisions rather than left as undocumented behaviour.

CLAUDE.md changes, all four as instructed: §4's first bullet amended, §12a added,
the Build order state line rewritten, and step 14 inserted with 14→15, 15→16, 16→17,
17→18 downstream. The renumber's fallout was chased rather than left: §10's "step
16" → 17, F87's "Blocks step 16" → 17, the Versioning rule's "see step 14" given a
clause saying why 14 is the step it means, and the 2026-09-04 deploy/staging swap
note extended to record that 14 changed hands again.

---

## 6. Findings

- **N1 — `/view` shows the same "Cannot GET" as `/t/…` when the client is not
  built.** The route is inside `existsSync(CLIENT_DIST)`, consistent with every
  other client path, and `/` remains the only unconditional explainer (the F89
  fix). Consistent is not the same as good: a deploy whose build step failed now
  has two silent 404s instead of one. Left alone deliberately — an unconditional
  `/view` explainer is a second F89 fix, which is a decision about the deploy
  path and not part of this chunk.

- **N2 — the viewer surfaces `segments`, which the Build order gives to step 16.**
  Written into §12a as a deliberate distinction rather than left as a collision:
  step 16 is about the LIVE surface, where §9's S2 is explicitly provisional
  pending re-justification. An archived transcript is the one place a
  decomposition is otherwise unrecoverable, and rendering it there commits nothing
  about the working surface. Flagged because a reader of the build order could
  reasonably think this jumped the queue.

- **N3 — the live history is unchanged, and that is enforced only by a prop
  default.** `tables = null` is what keeps segments and refs out of the app's own
  history. Nothing asserts that the app does not pass `tables`; if a future change
  passed it, step 16 would ship by accident. A test could pin it. It does not yet.

- **N4 — the drop target is the whole page, including over the history.** Dropping
  a transcript while reading a transcript replaces the one on screen. Correct, and
  the copy says "anywhere on this page", but there is no confirmation and no undo —
  the previous file is gone from the page and must be re-opened. Cheap to live with
  (the file is still on disk) and named so it is not discovered as a surprise.

- **N4a — the "read-only viewer" now mounts an editor.** `DraftCard` builds a real
  TipTap instance with `editable: false`. It is the most faithful render available
  and it costs nothing extra in the bundle, but it does mean the viewer's rendering
  path runs ProseMirror, and a future change that made that instance editable would
  be a one-word mistake with no server-side consequence and a very bad appearance.
  The `contenteditable="false"` assertion is what stands between here and there;
  mutation 9 confirms it holds.

- **N5 — the version in the viewer's footer is the SERVER's, not the transcript's.**
  A transcript carries no app version — §4's wrapper has `schema_version` and
  nothing else — so a reader cannot tell which version wrote the file they are
  looking at. The footer's number describes the page, not the record. Arguably the
  export should carry the writing version; that is a change to the export format,
  which this chunk was told not to touch.

- **N6 — the empty-state copy is now the first sentence a new user reads.** "Every
  change — yours and the model's — will be recorded here, turn by turn" was the
  brief's suggestion and is used verbatim. Worth watching in use: it appears above
  an empty editor, and it is now doing product-introduction work that no copy in
  this app was previously asked to do.

---

## 7. What was NOT verified

- **The viewer against a transcript from the deployed instance.** Everything was
  verified against exports this code produced, locally. A real file exported from
  wordwright.ink through the browser's own download and re-opened has not been
  through this path — it should be identical bytes, but "should be" is the claim,
  not the observation. It is the first thing to do with a real link.
- **Drag-and-drop as a human performs it.** The browser check used
  `setInputFiles` on the real file input; the drop path was exercised through a
  synthetic `drop` event in jsdom. A real OS drag onto a real window was not
  performed, so `dataTransfer` from an actual desktop drag is untested.
- **Any browser but Chromium**, and any viewport but 1280×900 for the viewer. The
  masthead was checked at 1280 only; the app's masthead is the one with the
  measured breakpoint table (`reports/mini-header.md`).
- **A large transcript.** The 11-turn live document renders acceptably in the app;
  the viewer was tested with 3 turns. Nothing here paginates or virtualizes, and a
  200-turn export will render 200 diffs at once. §0.4 says a few hundred snapshots
  is a few megabytes, so this will arrive eventually.
- **Screen-reader behaviour.** The regions carry `aria-label`s and the error carries
  `role="alert"`, but nothing was run through an actual screen reader.
- **That `/view` is discoverable.** Nothing in the app links to it. Someone who
  exports a transcript is not told the page exists. That is a real gap and it is
  outside the brief's "touch only" list, so it was left; it belongs with whatever
  step decides how a transcript gets shared.
