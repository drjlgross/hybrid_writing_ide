# Chunk 7 — autolink investigation, serve-time staleness, empty state, document management, clipboard fixture, warning wording, favicon

Status: all seven numbered items landed. `npm test` 221 pass / 0 fail.
`scripts/smoke-session.js` passes (5 turns, 29 assertions) after every item.
**Item 1 is report-only. No §0 artefact was changed. No code depends on changing one.**

---

## 1. AUTOLINK INVESTIGATION — report only, no fix written

### The question

`documents/00000000000000000000000000000000/draft.json` turn 5 (a **human** turn,
2026-08-20T03:45:05Z) contains:

```
  - gotta love the links <https://www.nytimes.com/>
```

Chunk 6 established the link toolbar serializes as `[text](url)`, so the toolbar
did not produce this.

### (a) Does canonicalize / remark wrap bare URLs in `<>`?

**No — and that is the wrong question.** A bare URL is untouched. What is
collapsed is a *link node whose text equals its destination*.

Measured against the shipped `canonicalize`:

| input | output |
| --- | --- |
| `bare url https://www.nytimes.com/ in prose` | unchanged, still plain text |
| `[https://www.nytimes.com/](https://www.nytimes.com/)` | `<https://www.nytimes.com/>` |
| `<https://www.nytimes.com/>` | unchanged |
| `[nyt](https://www.nytimes.com/)` | unchanged — text ≠ url, so no collapse |
| `[a@b.com](mailto:a@b.com)` | `<a@b.com>` |

The mechanism is `resourceLink: false` in `STRINGIFY_OPTIONS`
(`src/canonicalize.js:26`). That is remark-stringify's default, and it means
"emit the autolink shorthand when the link's text is its own destination".
`resourceLink` is **not** one of the five options §0.1 pins, so it arrived as a
default rather than as a decision.

**But canonicalize is not the only source.** TipTap's serializer does the same
thing independently:

| input | `tiptapSerialize(tiptapParse(x))` |
| --- | --- |
| `[https://www.nytimes.com/](https://www.nytimes.com/)` | `<https://www.nytimes.com/>` |
| `<https://www.nytimes.com/>` | `<https://www.nytimes.com/>` |

So the `<…>` form is produced twice over on the human write path
(editor → `serializeEditorMarkdown` → `canonicalize` → store), and removing it
from one layer alone would not remove it from the store.

### How it got into the editor in the first place

A link whose text equals its href. Two gestures in the shipped UI produce one,
and the store cannot tell them apart:

- **link-on-paste** (`LINK_OPTIONS.linkOnPaste: true`, §5) — paste a URL, TipTap
  wraps the pasted text in a link mark whose href is that same text;
- **the toolbar** — select the literal text `https://www.nytimes.com/`, click 🔗,
  paste the same URL into the href field. `Toolbar.applyLink` calls
  `setLink({href})` over the selection, so text and href coincide.

Autolink is off (`autolink: false`), so this is not the §5 autolink case, and
nothing here contradicts that decision.

### (b) Does the §2.3 allowlist admit an "autolink node type" from AI responses?

**There is no such node type, so the allowlist cannot distinguish them.** Parsed
with `remark-parse` (no GFM, per §0.1), `<https://x.com/>` and
`[https://x.com/](https://x.com/)` produce byte-identical mdast:

```
{ type: 'link', url: 'https://x.com/', children: [{ type: 'text', value: 'https://x.com/' }] }
```

`ALLOWED_TYPES` contains `link`, so both pass, uncounted and unwarned —
confirmed by running `stripOutOfDialect` over both forms (`warning: null`,
markdown unchanged). Admitting them is correct: they *are* the dialect's link.

### Is anything actually lost?

**No.** Round-trip identity holds for every form:

```
canonicalize(tiptapRoundTrip('gotta love the links <https://www.nytimes.com/>\n'))
  === 'gotta love the links <https://www.nytimes.com/>\n'   → true
```

Same for `[url](url)` input and for the mailto forms. The link renders as a link
in TipTap, survives every turn, and produces no phantom diff. This is a **dialect
spelling surprise, not content loss and not a §0.1 violation.**

There is one asymmetry worth recording: `<a@b.com>` is a canonicalize fixed point
but TipTap serializes it as `[a@b.com](mailto:a@b.com)`. Round-trip identity
still holds (canonicalize collapses it back), so it falls under §0.1's existing
"tolerated iff round-trip identity holds" rule — but it is not in the pinned
tolerance set, because the shared fixture never exercises it. See the fixture gap
below.

### Why nobody caught it — a fixture gap (finding)

The §5 shared fixture contains **nine links, and not one of them is self-titled.**
Walked programmatically over `canonicalize(FIXTURE)`:

```
link to the docs → https://example.com/docs?a=1&b=2      selfTitled: false
parenthesised target → https://example.com/a_(b)         selfTitled: false
bullet link → https://example.org/two                    selfTitled: false
indented link → https://example.org/wide                 selfTitled: false
Microsoft Word → https://www.microsoft.com/...           selfTitled: false
Google Docs → https://docs.google.com/...                selfTitled: false
mail me → mailto:writer@example.com                      selfTitled: false
docs mailbox → mailto:docs@example.com?subject=Hello     selfTitled: false
inner link → https://example.org/inner                   selfTitled: false
```

`autolink chars in canonical fixture: false`. §5 requires "an inline link" and "a
bare URL" and the fixture has both — but a **link whose text is its own URL** is
neither, and it is the single most common thing a writer produces (paste a URL).
Every chunk-1/2 test therefore passed without ever exercising the construct.

**This is a proposed change to the §5 shared fixture, which is §0 territory. Not
written. Reporting before the code exists, per the operating rules.**

### If you want it changed, the decision is §0.1's and it has two parts

1. `resourceLink: true` in `STRINGIFY_OPTIONS`. Probed (not committed): it turns
   `<url>` into `[url](url)` and round-trip identity still holds for the
   https, `[url](url)`, and mailto cases. Because canonicalize is the last step on
   the write path, this alone is sufficient — TipTap would keep emitting `<url>`
   and canonicalize would normalize it away, exactly as §0.1 intends.
2. Add a self-titled link to the §5 fixture so the choice is pinned by a test
   rather than by a default.

I have no recommendation to offer beyond noting that the current behaviour is
harmless and the store is consistent either way, so this is a legibility
preference, not a correctness fix. **Nothing in chunks 2–7 depends on which way
it goes.**

---

## 2. Serve-time staleness check

### Built

- **`src/client-build.js`** (new). `newestMtime(path)` walks a file or tree and
  returns the newest `{path, mtimeMs}`, skipping dotfiles and `.DS_Store`.
  `checkClientBuild({root})` returns one of three states:
  - `no-build` — `client/dist` absent. **Not stale.** A fresh clone has never
    built; refusing here would break the first run.
  - `fresh` — every build input is at or older than the newest dist file.
  - `stale` — some input is strictly newer. Carries a `message`.
- **`scripts/serve.js`** — calls it before `startServer()`. On `stale`, prints the
  message and `process.exit(1)`. On `no-build`, prints one line saying the API is
  serving without a UI and continues.

The refusal message, verified live by touching `client/src/App.js`:

```
refusing to serve a stale client build.

  client/src/App.js
      was changed 2329 minute(s) after the last build wrote
  client/dist/index.html

Serving anyway would hand the browser the PREVIOUS build, so your change would
simply not be there — which looks like a bug in the code rather than a missing
build step. Rebuild first:

      npx vite build

Or run `npm run dev`, which serves client/src directly and never goes stale.
```

`node scripts/serve.js` exited 1. Restored and re-verified `fresh`.

### Finding: one build input beyond the brief

The brief named `client/src` and `vite.config.js`. I added **`client/index.html`**.
It is Vite's entry document and the file the favicon now lives in, so editing it
without rebuilding produces the identical silent failure. This makes the gate
stricter, never looser, and cannot affect the no-build path. Named here rather
than folded in silently.

### Verified — `test/client-build.test.js`, 8 pass / 0 fail

Real temp directories with real `utimesSync` mtimes; no stubbed clock, because
the thing under test is a filesystem comparison and a stubbed `statSync` would
only prove the stub works.

1. fresh clone, dist absent → `no-build`, `message === null`
2. dist newer than every input → `fresh`
3. the watched input set is exactly `['client/src', 'client/index.html', 'vite.config.js']`
4. each of the three inputs, touched **alone**, → `stale`, message matches
   `/npx vite build/`, and names the file that moved
5. a file three levels deep under `client/src` counts
6. `.DS_Store` and a dotfile beside the sources do **not** fake staleness
7. equal mtimes → `fresh` (strictly-newer is what makes the gate usable)
8. `newestMtime` → `null` for an absent path, newest entry for a tree

### Mutations

| broke | result | message |
| --- | --- | --- |
| `BUILD_INPUTS` → `['client/src']` | **2 fail** | `actual: [ 'client/src' ], expected: [ 'client/src', 'client/index.html', 'vite.config.js' ]`; `actual: 'fresh', expected: 'stale'` |
| `<=` → `<` (equal mtimes stale) | **1 fail** | `actual: 'stale', expected: 'fresh'` |
| `no-build` reported as `stale` | **1 fail** | `actual: 'stale', expected: 'no-build'` |
| stop skipping dotfiles | **1 fail** | `actual: 'stale', expected: 'fresh'` |
| stop recursing into subdirectories | **3 fail** | `actual: 'fresh', expected: 'stale'`; `actual: '…/tree', expected: /c\.js$/` |

**One mutation initially escaped and the test was rewritten because of it.** The
first version looped `for (const input of BUILD_INPUTS)`, so deleting an input
deleted its own test case and all 7 passed. Test 3 now asserts the list as a
literal and test 4 iterates the same literal.

---

## 3. Empty editor state

### Built

- **`client/src/App.js`** — an `empty` state, set from `instance.isEmpty` at both
  places the document can change shape: the `update` handler (typing) and the
  session's `setMarkdown` adapter (initial load and a committed AI turn, both of
  which run `setContent(..., {emitUpdate: false})` and therefore fire no update
  event). Renders `<p class="editor-placeholder">Start writing. Bold, italic,
  bullets and links are the whole vocabulary.</p>` when empty and unlocked.
- **`client/src/styles.css`** — `.editor-placeholder` absolutely positioned over
  the editor's text origin, `pointer-events: none` so it cannot swallow the click
  that places the caret. `min-height: 60vh` and `border: 1px solid var(--line)`
  on `.editor .tiptap` were already there and are now pinned by a test.

Why a real element rather than CSS `::before`: a pseudo-element is invisible to a
screen reader and to a headless test, which are the two readers that matter here.

The border and min-height live on `.tiptap`, which only exists once TipTap has
mounted — so a bordered box of the right size *is* the evidence the editor is
alive, and the placeholder is the evidence it is empty rather than broken. Those
are the two halves the brief asked to separate.

### Verified — inside `test/components.test.js`, 20 pass / 0 fail (was 14)

- empty draft → `.editor .tiptap` exists (mount succeeded), `editor.isEmpty` true,
  `.editor-placeholder` present, text matches `/Start writing/`
- a loaded draft → no placeholder (the `setContent` route)
- typing into an empty draft → placeholder gone, `isEmpty` false (the `update`
  route — a different code path from the one above)
- the stylesheet declares `min-height:` and `border: 1px solid` inside the
  `.editor .tiptap` rule, and `pointer-events: none` inside `.editor-placeholder`

### Named as such: the stylesheet test asserts CSS *text*

jsdom applies no stylesheet, so a rendered assertion about the border would pass
with the rule deleted. This test reads `client/src/styles.css` and regex-matches
the two rules. It catches deletion, which is what it is for; it does not prove
anything renders.

### Mutations

| broke | result | message |
| --- | --- | --- |
| `setMarkdown` no longer recomputes emptiness | **1 fail** | `a loaded draft shows no placeholder (the setContent route)` — `actual: 1, expected: 0` |
| `onUpdate` no longer recomputes emptiness | **1 fail** | `typing into an empty draft clears the placeholder (the update route)` — `actual: 1, expected: 0` |
| placeholder element removed | **2 fail** | `actual: null, expected: truthy` |
| `min-height: 60vh` deleted from styles.css | **1 fail** | `expected: /min-height:/`, actual is the whole rule text |

### Two test-suite defects found while mutation-checking, both fixed

1. **A failing `assert.equal(<live DOM element>, null)` takes ~23 seconds and
   reports the FILE as failed instead of naming the test.** Node serializes the
   whole jsdom node into its diff. Five such assertions existed (three predate
   this chunk, in the §0.2 lock tests). All now use a `count(view, selector)`
   helper and fail in milliseconds with `actual: 1, expected: 0`.
2. **Two mounts in one test hangs on failure** — the first assertion throws and
   the second editor is never torn down. The placeholder test is now two tests,
   one mount each, with a comment saying why.

---

## 4. Document management

### Server — within-namespace listing only

- **`src/storage.js`** — `listDocuments({dir})`. Takes a resolved namespace
  directory and nothing else; there is no argument that widens scope, and the
  only thing that produces a `dir` is `resolveNamespace`. Filters `*.json` (never
  the `.json.tmp` of an atomic write in flight), reads each, returns
  `{slug, created_at, turns, updated_at}` sorted newest-activity-first.
- **`src/server.js`** — `GET /api/t/:token/library`. Behind `withNamespace`, like
  every other route; the handler reads `req.namespace.dir` and never sees a token.

### Finding: the listing is at `/library`, not `GET /documents`

`GET /api/t/:token/documents` already means **the default document** — §0.5's
"a missing slug resolves to a default document", created on demand so a fresh
link opens onto something writable. That rule is load-bearing and tested. Rather
than break it, the listing took a separate name. Convenience, not spec
conformance — §5's "one endpoint" was already departed from in chunk 5 for
`/checkpoint`, and this is the third route.

### Finding: an unreadable document is listed, not dropped

A `.json` that will not parse comes back as
`{slug, unreadable: <parse error>, updated_at: <mtime>}` and renders in the list
as a red `unreadable` badge. Skipping it would make a document vanish from the
human's view while its bytes sit on disk, which is worse than a row saying
something is wrong.

### Client

- **`client/src/Library.js`** (new) — the document list, current entry marked with
  `aria-current="page"`, per-entry turn count and short date, and a `+ New
  document` toggle opening an inline name field. No modal.
- **`client/src/api.js`** — `list()` → `GET /library`. Every call still carries
  the token in `base`; there is no client call that reaches another namespace.
- **`client/src/draft-session.js`** — `documents` and `missing` state,
  `refreshLibrary()` and `createDocument(slug)`. `load()` refreshes the library
  either way, and treats a **404 as `missing: true` with `error: null`** rather
  than as a failure.
- **`client/src/App.js`** — renders the library in a new right-hand rail above the
  AI panel; renders a missing-slug pane when `state.missing`.

### The unknown-slug screen

Not a bare 404. It says *"There is no document called `my-esay` yet"*, explains
nothing was lost, offers a `Create my-esay` button, and lists the documents that
**do** exist beside it. Creating from there loads in place (no navigation);
creating any other slug navigates to `/t/{token}/{new-slug}`.

Two details that are load-bearing:

- The draft pane is **hidden, not unmounted**, on the missing screen. It is keyed,
  so React keeps the same DOM node — the TipTap mount point survives and the
  effect that built the editor into it does not re-run and tear it down. Asserted:
  after creating, `.editor .tiptap` is still there.
- The client follows **`doc.slug` from the server**, never the string typed. The
  server sanitizes (`Track C Post` → `track-c-post`) and refuses collisions; using
  the typed slug would navigate to a 404 it had just created.
- A **failed listing never sets the draft error.** Only one of those two failures
  means the human's text is in doubt, and conflating them would send someone
  looking for lost work that is fine.

### Verified

**`test/storage.test.js` — 18 pass / 0 fail (was 15)**

1. lists this directory only, ordered by activity not by filename or creation —
   asserted in **both** directions so it is scoping rather than luck
2. ignores a `good.json.tmp`; reports a `broken.json` with `unreadable` set and
   leaves `good` clean
3. a namespace never written to returns `[]`

**`test/namespace.test.js` — 16 pass / 0 fail (was 12)**

4. `GET /library` on two live namespaces: each sees only its own,
   `JSON.stringify(body).includes('their-secret') === false`, asserted both ways
5. no route lists namespaces: `/api/library`, `/api/t/library`, `/api/t//library`,
   `/api/namespaces`, `/api/t` all non-200 and none names a document; a bad token
   → 400 with `invalid_token`, never "list them all"
6. an empty namespace → 200 `{documents: []}`
7. `GET /documents` still returns the default *document* (`slug: 'draft'`, an
   array `history`, no `documents` key) while `/library` lists all three

**`test/components.test.js` — 20 pass / 0 fail**

8. documents listed with hrefs `/t/{token}/{slug}`, current marked
   `aria-current="page"`, turn counts rendered
9. create → raw name goes to the server, browser follows the server's slug
10. unknown slug → `.missing` pane, no `.status.error`, existing documents still
    listed, `Create my-esay` creates in place with **no** navigation and the
    editor takes over with `.editor .tiptap` intact
11. a failed listing leaves no draft error and the draft still loads

**Live check** (server on :3117, real `documents/`):

```
/api/t/000…0/library      → 3 documents (smoke, track-c-post, draft), activity-ordered
/api/t/000…0/documents/my-esay → 404
/t/000…0/my-esay          → 200 (the SPA, which then shows the missing pane)
/api/library → 404   /api/t/library → 400   /api/namespaces → 404
```

### Mutations

| broke | result | message |
| --- | --- | --- |
| `listDocuments` stops filtering `.json` | **1 fail** | `actual: [ 'broken', 'good', 'good.jso' ]` |
| unreadable documents silently dropped | **1 fail** | `broken` missing from the listing |
| `/library` reads the documents ROOT instead of the namespace | **2 fail** | cross-namespace slugs appear |
| a 404 goes back to being a bare error | **1 fail** | `actual: null, expected: truthy` (`.missing` absent) |
| a failed listing sets `error` | **1 fail** | `actual: 1, expected: 0` (`.status.error`) |
| client navigates to the TYPED slug | **1 fail** | `actual: [ '/t/000…0/Track C Post' ]` |
| missing-slug screen removed | **1 fail** | `actual: null, expected: truthy` |

---

## 5. HTML clipboard paste fixture (§5, §9 step 7)

### Built

- **`test/fixtures/clipboard/word.html`** — a real Word clipboard payload:
  `xmlns:o`/`xmlns:w` namespaces, the `<style>` block with `mso-style-link` and
  `@font-face`, `p.MsoNormal` runs, `<o:p>` empty runs, `<h1>`, a
  `class=MsoTableGrid` table, `mso-list:l0 level1 lfo1` fake bullets with their
  `<![if !supportLists]>` Symbol-font glyph, two hyperlinks (one inside a fake
  bullet), `<b style='mso-bidi-font-weight:normal'>`, `<i>`, `&#8220;`/`&#8212;`.
- **`test/fixtures/clipboard/google-docs.html`** — a real Google Docs payload:
  the `<b style="font-weight:normal;" id="docs-internal-guid-…">` wrapper around
  everything, per-run `<span style="font-size:11pt;font-family:Arial;…">`, `<h2>`,
  a real `<ul>` of `<li><p role="presentation">`, a `<table>` with `<colgroup>`,
  two `google.com/url?q=…&sa=D&source=editors&ust=…` redirected hyperlinks,
  `font-weight:700` bold, `font-style:italic` italic, `&rsquo;`/`&lsquo;`.
- **`test/fixtures/clipboard/index.js`** — exports both plus
  `CLIPBOARD_FIXTURES`, each entry carrying `required` predicates (same shape as
  the Markdown fixture's `REQUIRED_CONSTRUCTS`), the prose that must survive in
  order, the links that must survive, and the bold/italic runs.
- **`test/clipboard-paste.test.js`** — 10 tests.

### Finding: the payload goes through `view.pasteHTML`, not `clipboardTextParser`

§5 says "fed through TipTap's `clipboardTextParser`". `clipboardTextParser` is the
hook for the **plain-text** clipboard flavour. The HTML flavour — the one §5 is
actually about, and the only one carrying span/style noise — is handled by
ProseMirror's `parseFromClipboard`, whose public entry point is
`view.pasteHTML(html, event)`. Feeding these files through `clipboardTextParser`
would insert them as literal text and assert nothing about filtering. Departure
from the letter of §5, taken deliberately, named here.

(jsdom has no `ClipboardEvent`, so a plain `Event('paste')` is passed. ProseMirror
only consults the event to decide whether to allow a default, and there is none.)

### Verified — 10 pass / 0 fail

Fixture non-emptiness first, item by item, so a gutted fixture fails **there**
naming the missing construct rather than making every later assertion trivial.
Word: 11 required constructs. Google Docs: 10.

Per payload:
- **lands in the dialect and nothing else** — every node type in the resulting doc
  is in `{doc, paragraph, text, bulletList, listItem}`, every mark in
  `{bold, italic, link}`; and `heading`, `table`, `tableRow`, `tableCell`,
  `image`, `codeBlock`, `hardBreak`, `orderedList`, `blockquote` are each named
  as absent, as are the `strike`, `code`, `underline`, `textStyle`, `highlight`
  marks
- **prose and links survive** — every phrase present, in order (a stripped heading
  keeps its words as a paragraph; both table cells survive as prose); every link
  as `[text](url)`; bold as `**…**`, italic as `*…*`
- **safe for the store** — `canonicalize` is idempotent on the paste output, the
  canonical form round-trips byte-identically through TipTap (§0.1), and no `+`
  bullet appears

Plus three payload-specific tests:
- **Google Docs' `<b>` wrapper does not bold the paste** — exactly two `**`
  markers in the whole result, i.e. one bold run, the one that was actually bold
- **Google Docs' `<ul>` survives as a real bullet list** — `bulletList` and
  `listItem` present; TipTap serializes it **loose**, canonicalize makes it tight
  (§0.1), asserted in both forms
- **Word's `mso-list` bullets arrive as paragraphs** — `bulletList` absent, the
  `·` glyph and its NBSPs land in the prose, the link inside survives

### Finding: Word bullets are not lists, and Google Docs links keep their redirector

Two real behaviours, both now pinned by a test rather than discovered mid-draft:

- Word never emits `<ul>`. Its bullets are paragraphs with a Symbol-font `·` and
  non-breaking spaces faking the indent, so what lands is prose beginning `·   `.
  Nothing is lost; nothing becomes a list either. Fixing it would mean a
  Word-specific paste transform, which is not in scope for v1.
- Google Docs links arrive as
  `https://www.google.com/url?q=<real-url>&sa=D&source=editors&ust=…`, so the
  **stored href is a Google redirector, not the destination**, and canonicalize
  escapes its `&` as `\&`. Unwrapping it would be a content change. Not made.

### Finding: the paste filtering is done by the Markdown pipeline, not the schema

Discovered while mutation-checking. `DOMParser.fromSchema(schema).parse(<h1>…)`
**does** produce a heading node when one is in the schema — but the paste never
reaches it. `view.someProp('handlePaste')` is set (by tiptap-markdown), and the
payload is round-tripped through Markdown, so anything the configured Markdown
dialect cannot express is flattened. Consequences:

- The guarantee is stronger than schema filtering: it is "expressible in the
  configured Markdown dialect or gone".
- Adding a `heading` node to the schema did **not** make headings survive a paste,
  so a dialect-widening mutation cannot break these tests. Their sensitivity was
  demonstrated with mark-level mutations instead (below).
- Removing `<b style="font-weight:normal">`'s style attribute from the fixture
  still does not bold the paste — so it is **not** Bold's font-weight guard doing
  the work here, contrary to the obvious assumption. The test's comment says so;
  it asserts the outcome, not the mechanism.

### Mutations

| broke | result | message |
| --- | --- | --- |
| `Link` extension removed | **3 fail** | links absent from both payloads |
| `Bold` extension removed | **3 fail** | including the `<b>`-wrapper test |
| a `heading` node added to the schema | **0 fail** | *see finding above — the paste pipeline strips it regardless* |
| `MARKDOWN_OPTIONS.html: true` | **0 fail** | that option governs markdown-it inline HTML, not the paste path |
| `MARKDOWN_OPTIONS.linkify: true` | **0 fail** | not exercised by these payloads |

The last three are **not** covered by this test file. Named as such.

---

## 6. §2.3 warning: rendering confirmed, shrink wording softened

### Confirmed rendering

`AiPanel` already rendered `state.warnings` in a `.status.warning` block headed
"Committed, with warnings", one `<li>` per warning. The pre-existing test built
that state by hand, which proves the panel *can* display a warning it is given —
not that one *reaches* the screen. Added an end-to-end test that submits a prompt
through the real client path and asserts on the rendered result:

- `2 headings`, `1 blockquote`, `1 table`, `63% shorter` all present in
  `.status.warning`
- exactly two `<li>`, so a second warning cannot hide behind the first
- no `.status.error` — the turn committed

### Changed: `asksForCutting` softens, it no longer suppresses

Before: a keyword match **removed** the shrink warning entirely.

**Why that was wrong.** §2.3 writes the soft guard for "a model quietly dropping a
paragraph [that] still returns `end_turn`". The instruction under which that
happens is *"tighten the second paragraph"* — §2's own worked example — which is
also exactly what the keyword heuristic matches. So the guard was switched off in
the case it was written for.

After (`src/ai-response.js`): the threshold check no longer consults
`asksForCutting`; the keyword only chooses the wording.

- no compression word: `the draft is 63% shorter than before this turn, and the
  instruction did not ask for cutting`
- compression word: `the draft is 90% shorter than before this turn. The
  instruction did ask for cutting, so this may be exactly right — check that
  nothing you meant to keep went with it.`

Both still carry the percentage, both still commit the turn, both land in
`turn.warnings` and therefore in the history. A false positive now costs a
sentence that reads slightly off instead of a missing warning.

### Verified

- **`test/ai-response.test.js` — 10 pass / 0 fail.** For each of `cut the second
  paragraph`, `make it shorter`, `tighten this up`, `condense`, `trim the fat`:
  `asksForCutting` is true, **exactly one warning is still produced**, it names
  the percentage, it matches `/did ask for cutting/`, it does **not** match
  `/did not ask for cutting/`, and it still says to check what went. Plus: an
  instruction with no compression word keeps the blunt wording, and a 20% shrink
  is still under the threshold and warns about nothing.
- **`test/ai-edit.test.js` — 13 pass / 0 fail.** New: `tighten the second
  paragraph` returning a 90%-shorter draft commits **and** lands one softened
  warning on `aiTurn.warnings`.
- **`test/components.test.js`** — the end-to-end render test above.

### Mutations

| broke | result | message |
| --- | --- | --- |
| re-add `&& !asksForCutting(prompt)` to the threshold | **1 fail** (ai-response) | `actual: 0, expected: 1` — "must still warn" |
| same, seen from the committed turn | **1 fail** (ai-edit) | `a shrink asked for still warns on the turn, in softened words` |
| `AiPanel` stops rendering warnings | **2 fail** (components) | both §2.3 render tests |

---

## 7. Favicon and the `act()` warnings

### Favicon

`client/index.html` now carries an inline SVG data-URI `<link rel="icon">` — a
paper-cream rounded square with three strokes in the app's own palette (accent
green, warn amber, rule grey). Inlined rather than a file: nothing extra to
request and nothing to 404 when Express serves the built assets in a deployment.
Verified present in `client/dist/index.html` after `npx vite build`.

### `act()` warnings — 4 before, 0 after

Source: `Toolbar` subscribes to the editor's `selectionUpdate` and `transaction`
events and calls `setState` from both, so a bare `editor.commands.setTextSelection(...)`
in a test is two React state updates React cannot see coming. Two such calls × two
events = the four warnings.

Fix: `test/helpers/render.js` exposes `view.act(fn)`, which runs the callback
inside React's `act()` scope. The two toolbar tests and the new typing test use
it. This is not only cosmetic — the render React warned about was genuinely not
flushed before the next assertion.

```
$ npm test 2>&1 | grep -ic "not wrapped in act"
0
```

---

## Test counts, per group

| file | pass | fail | delta this chunk |
| --- | --- | --- | --- |
| `canonicalize.test.js` | 58 | 0 | — |
| `round-trip-identity.test.js` | 17 | 0 | — |
| `tiptap-fixed-point.test.js` | 19 | 0 | — |
| `storage.test.js` | 18 | 0 | +3 |
| `turns.test.js` | 12 | 0 | — |
| `namespace.test.js` | 16 | 0 | +4 |
| `ai-response.test.js` | 10 | 0 | — (one test rewritten) |
| `anthropic-client.test.js` | 6 | 0 | — |
| `ai-edit.test.js` | 13 | 0 | +1 |
| `draft-session.test.js` | 14 | 0 | — |
| `components.test.js` | 20 | 0 | +6 |
| `clipboard-paste.test.js` | 10 | 0 | +10 (new) |
| `client-build.test.js` | 8 | 0 | +8 (new) |
| **total** | **221** | **0** | **+35** |

`scripts/smoke-session.js`: 5 turns, 29 assertions, run after every numbered item
and again at the end. The §0.3 invariant holds after every step and the restore at
step (e) appended turn 4 rather than truncating history.

### The §5 shared Markdown fixture — unchanged

Walked item by item against §5's list, as required. All 30
`REQUIRED_CONSTRUCTS` still pass and the file is byte-identical to chunk 2c's.
The **only** proposed change is the self-titled link in item 1, which is not made.

The new clipboard fixture is a **second, separate** fixture, exactly as §5
requires ("Do not treat the Markdown artifacts as covering paste behavior"). It
does not touch the Markdown one.

---

## Shared-artifact changes

| artefact | change | conformance or convenience |
| --- | --- | --- |
| §5 shared Markdown fixture | **none** | — |
| §0.1 `STRINGIFY_OPTIONS` | **none** (item 1 is report-only) | — |
| §2.3 `ALLOWED_TYPES` | **none** | — |
| `src/tiptap-config.js` | **none** | — |
| `src/ai-response.js` shrink guard | softened instead of suppressed | **spec conformance** — restores the guard in the case §2.3 wrote it for |
| server routes | added `GET /library` | convenience — §5 names one endpoint; this is the third |
| `test/helpers/render.js` | added `view.act(fn)` | convenience (test hygiene) |
| `test/components.test.js` | 5 element-vs-null assertions → count-based | convenience (failure legibility) |

---

## Wrong or underspecified in the spec

1. **§5 names `clipboardTextParser` for an HTML payload.** It is the plain-text
   hook. The HTML flavour goes through `parseFromClipboard` / `view.pasteHTML`.
   Followed the intent, not the letter (item 5).
2. **§0.1 pins five stringify options and `resourceLink` is not among them**, yet
   it decides whether `[url](url)` is stored as `<url>`. That is a visible dialect
   choice arriving as a library default (item 1).
3. **§5's fixture list has no self-titled link**, so the most common link a writer
   produces — a pasted URL — is untested end to end (item 1).
4. **§5 says "one endpoint"** but the app now needs four (`/documents`,
   `/checkpoint`, `/ai-edit`, `/library`). The constraint has been overtaken.
5. **§2.3's soft guard and its own worked example collide.** "Tighten the second
   paragraph" (§2) is both the canonical instruction and a compression keyword.
   §2.3 says "commit it but surface a warning"; the suppression read of "the
   instruction did not ask for cutting" turned the guard off exactly there.
   Resolved by softening; flagging the ambiguity rather than assuming.
6. **§0.5 does not say a document listing exists.** It says no endpoint may list
   namespaces or read across them, which the new route respects, but the listing
   itself is an addition the spec neither authorises nor forbids.

---

## NOT verified — named as such

- **No browser check ran.** The Chrome extension could not load
  `http://localhost:3117` or `http://127.0.0.1:3117` (`Frame with ID 0 is showing
  error page` on every attempt, after three tries). Stopped rather than
  rabbit-holing. The server itself was verified live with `curl`, and the UI is
  covered by 20 jsdom tests mounting the real `App` with a real TipTap editor —
  but **nobody has looked at the placeholder, the document list, the missing-slug
  screen, the new rail layout, or the favicon in a real browser.** The CSS in
  particular is asserted only as text. Worth ten seconds of your eyes before
  ratifying.
- **The new CSS is unrendered.** `.rail`, `.library`, `.doc-list`, `.missing` and
  `.editor-placeholder` have never been laid out by a layout engine. The
  `.rail .panel { position: static }` override in particular is a guess about how
  a sticky panel behaves inside a sticky rail.
- **`MARKDOWN_OPTIONS.html` and `linkify`** are not exercised by the clipboard
  tests; flipping either changed nothing there.
- **The staleness gate has never fired in a deployment.** The reasoning that
  Railway's build runs after checkout (so dist is always newer) is untested.
  If it is wrong, `npm start` refuses to boot in production.
- **No live AI turn ran this chunk.** `scripts/live-check.js` was not run; the
  softened shrink wording has only been seen against stubbed responses.
- **Concurrency.** Two people in one namespace creating the same slug at once
  resolves to a 409 from `createDocument`'s `existsSync` check, which is a TOCTOU
  race. Not tested, not fixed.
- **`listDocuments` reads every document in the namespace on every page load.**
  Fine at three documents; not measured at three hundred.
