# Chunk 1 — `canonicalize()` and its tests

Build order §9 step 1. Status: complete, 46 tests pass, 0 fail.

Scope: `canonicalize()` plus the §0.1 required tests that belong to chunk 1
(idempotence, fixed point up to added escapes, no escape growth, no `+` bullets, every
list tight). Round-trip identity is §0.1's other required test and is chunk 2 item 1 by
the spec's own assignment — see "What was NOT verified".

---

## 1. What was built, file by file

### `src/canonicalize.js`
The one canonical Markdown dialect. `unified` → `remark-parse` → merge transform →
`remark-stringify`, frozen at module load.

- `STRINGIFY_OPTIONS` exported so the pins are inspectable and testable, not buried:
  `emphasis: '*'`, `strong: '*'`, `bullet: '-'`, `listItemIndent: 'one'`, `rule: '-'`
  per §0.1, plus `fences`, `incrementListMarker: false`, `resourceLink: false`,
  `tightDefinitions`, `bulletOther: '+'`. No GFM plugin is loaded, so no tables, no
  strikethrough, no autolink literals — a bare URL stays plain text.
- `remarkMergeAdjacentLists` — mdast transform, merges consecutive sibling `list` nodes
  when `Boolean(ordered)` matches. Recurses, so nested lists merge too. Only
  *sibling-adjacent* lists merge; a paragraph between two lists is a real separation.
- Tight lists: `spread = false` on every list node, never on list items.
- Input hygiene: CRLF/CR normalized to LF before parsing; output always ends in exactly
  one newline, or is `''` for empty input.
- Throws `TypeError` on non-string input rather than coercing.

### `src/tiptap-config.js`
The single TipTap extension list: Document, Paragraph, Text, Bold, Italic, BulletList,
ListItem, Link, Markdown. Nothing else, so the schema cannot represent anything outside
the §1 dialect.

- `MARKDOWN_OPTIONS`: `html: false`, `tightLists: true`, `bulletListMarker: '-'`,
  `linkify: false`, `breaks: false`, `transformPastedText: false`,
  `transformCopiedText: true`. Chosen to agree with `STRINGIFY_OPTIONS`.
- `LINK_OPTIONS`: `openOnClick: false`, `protocols: ['http','https','mailto']`,
  `linkOnPaste: true`, **`autolink: true` — this now contradicts §5, see finding F1.**

### `src/tiptap-serialize.js`
`serializeEditorMarkdown(editor)` — TipTap's own serializer plus the trailing-newline
normalization, so TipTap's output and `canonicalize()` agree on the tail. This is the one
part of the original fixed-point mismatch that was fixable on the TipTap side, which is
where §0.1 says to fix things.

### `test/fixtures/draft-fixture.md`
The shared §5 fixture. Contents and item-by-item walk in section 3.

### `test/fixtures/index.js`
Loads the fixture and exports `FIXTURE`, `FIXTURE_PATH`, and `REQUIRED_CONSTRUCTS` — 21
labelled predicates covering every §5 item plus the deliberate non-canonicality. A gutted
fixture fails a named test instead of silently making every other test vacuous.

### `test/helpers/headless-editor.js`
`createEditor`, `tiptapSerialize`, `tiptapRoundTrip`. Installs a jsdom DOM on `globalThis`
so a real TipTap `Editor` can be constructed in Node. Test-only; `src/` never imports it.

### `test/canonicalize.test.js`, `test/tiptap-fixed-point.test.js`
The test suite. Inventory in section 2.

### `package.json`, `.gitignore`
`"test": "node --test \"test/**/*.test.js\""` — Node's built-in runner, no test framework
installed. `.gitignore` covers `node_modules/`, `.DS_Store`, `documents/`, `*.tmp`.

### devDependency: jsdom
Test-only, approved in Operating rules. Needed because the §0.1 fixed-point test requires
`tiptapSerialize(doc)`; tiptap-markdown's serializer only exists on an `Editor` instance,
and an `Editor` constructs a ProseMirror `EditorView`, which requires a DOM. `getSchema()`
is DOM-free but does not serialize. Without it the test would have had to measure a
hand-built serializer stub instead of TipTap.

---

## 2. What was verified, and how

`npm test` → **46 tests, 46 pass, 0 fail.** Per group:

| Cases | Group |
|---:|---|
| 13 | `idempotence: canonicalize(canonicalize(x)) === canonicalize(x)` — 13/13 subtests pass |
| 13 | `no escape accumulation: ten passes never grow and never change` — 13/13 subtests pass |
| 8 | `TipTap is a fixed point of canonicalize, up to added escapes` — 8/8 subtests pass |
| 1 | `fixture covers every construct §5 requires` |
| 1 | `canonical output uses the pinned dialect` |
| 1 | `adjacent same-type lists merge, and no + marker ever reaches the store` |
| 1 | `every list is tight` |
| 1 | `canonicalize preserves the content §5 cares about` |
| 1 | `canonicalize rejects non-strings` |
| 1 | `TipTap's serializer emits the pinned dialect` |
| 1 | `the pipeline converges from NON-canonical input in one pass` |
| 1 | `the schema allows exactly doc/paragraph/text/bulletList/listItem + bold/italic/link` |

The 13 idempotence and 13 growth cases are: the whole fixture, each of its 8 blocks
separately, empty string, whitespace-only, no-trailing-newline, and CRLF input
(1 + 8 + 4 = 13). The 8 fixed-point cases are the whole canonical fixture plus its 7
canonical blocks — 7, not 8, because the merge collapses the fixture's two adjacent lists
into one block.

Growth is asserted as: pass 2 through 10 never exceed pass 1's length and are
byte-identical to it, plus a backslash-count check. The raw → pass-1 step legitimately
adds escapes (`a \* b`, `snake\_case\_name`, `\_`, `\&`); everything after is flat at
1468 chars.

### §0.1 required-tests conformance, item by item

| §0.1 requirement | Status |
|---|---|
| Idempotence, for every fixture | **Met** — 13 cases |
| Round-trip identity | **Not met — chunk 2 item 1 by §0.1's own assignment.** Never asserted here |
| TipTap fixed point up to added escapes, `doc` from canonical input | **Met** — 8 cases |
| ↳ pin is bidirectional (equality, not containment) | **Met, with a granularity caveat** — finding F2 |
| No escape accumulation, ten passes | **Met** — 13 cases |
| No `+` bullet ever reaches the store | **Met** — dedicated test, fixture has truly adjacent lists |
| Every list is tight | **Partially met** — finding F3 |
| ↳ list item with two paragraphs keeps its blank line | **Met** — asserted separately |

Two tests exist that §0.1 does not require: `the pipeline converges from NON-canonical
input in one pass` (a supplement, explicitly not a substitute for round-trip identity —
§0.1 is right that a function can converge to a fixed point that is not the canonical
fixture) and `the schema allows exactly ...` (pins the §1 dialect at the schema level).

---

## 3. The fixture

`test/fixtures/draft-fixture.md` — 1483 bytes, 1466 chars, 21 lines, 8 blocks, 204 words.

```markdown
This paragraph carries **bold text**, *italic text*, and an inline [link to the docs](https://example.com/docs?a=1&b=2) in the middle of a sentence.

Dialect drift on purpose: _underscore italic_ and __underscore strong__ should both come back as asterisks.

A bare URL sits here: https://example.com/bare/url and prose continues after it. A link whose target has parentheses: [parenthesised target](https://example.com/a_(b)) follows it.

Escaping traps: a * b is a literal asterisk, snake_case_name is an underscored identifier, 100% is a percent sign, and 2 * 3 * 4 keeps three of them on one line.

* Star bullet with **bold** and _italic_
* Star bullet holding a [bullet link](https://example.org/two)
* Star bullet with a bare URL https://example.net/three and 100% plain text

-   Wide-indent dash bullet, three spaces after the marker
-   Second wide-indent bullet with an [indented link](https://example.org/wide)


Pasted from Word: “Smart quotes,” an em dash — an ellipsis … a non-breaking space right here: (one nbsp sits just before that paren), an apostrophe in don’t, and a pasted hyperlink [Microsoft Word](https://www.microsoft.com/en-us/microsoft-365/word) that came along with the paste.

Pasted from Google Docs: ‘single curly quotes’, another apostrophe in it’s, a stray underscore _ standing alone, 100% of the figures, and a pasted hyperlink [Google Docs](https://docs.google.com/document/d/1AbC_dEf-23/edit) that came along with the paste.
```

Invisible characters, verified by byte inspection rather than by eye:

- one trailing space at the end of the `Escaping traps:` line (line 7)
- one literal U+00A0 immediately before the `(` in `right here: (one nbsp…` (line 18)
- two consecutive blank lines between the wide-indent list and the Word paragraph

### §5 walk, item by item

| §5 requirement | Where in the fixture |
|---|---|
| bold | L1 `**bold text**`; L9 `**bold**` |
| italic | L1 `*italic text*`; L9 `_italic_` (underscore form, normalizes) |
| a bullet list | L9–11 and L13–14 |
| an inline link | L1 docs link; also L10, L14, L18, L20 |
| a bare URL | L5 `https://example.com/bare/url`; L11 `https://example.net/three` |
| literal asterisk in prose (`a * b`) | L7, plus `2 * 3 * 4` |
| underscored identifier (`snake_case_name`) | L7 |
| percent sign (`100%`) | L7, L11, L20 |
| **two adjacent bullet lists** | L9–11 then L13–14, nothing between them |
| Word typographic artifacts | L18: `“ ”`, em dash, ellipsis, U+00A0, `don’t` |
| Word pasted hyperlink | L18 `[Microsoft Word](…)` |
| Google Docs typographic artifacts | L20: `‘ ’`, `it’s` |
| Google Docs pasted hyperlink | L20 `[Google Docs](…)`, underscore inside the doc ID |

Nothing §5 names is absent. Every row is enforced by a named predicate in
`REQUIRED_CONSTRUCTS`, so deleting any of them fails the fixture guard by name.

Deliberate non-canonicality, so idempotence has real work to do rather than passing on
already-clean input: `_underscore italic_`, `__underscore strong__`, `*` bullets,
three-space list indent, a trailing space, and stacked blank lines.

Deliberately excluded per §5, and correctly absent: headings, ordered lists, thematic
breaks, tables.

### Escaping traps that are absent — recommended before chunk 2

The fixture satisfies §5 as written, but §5's own framing is that "escaping is the failure
mode that matters", and by that standard it is thin. All of the following are absent and
all are representable in TipTap, so each is a live round-trip-identity risk for chunk 2:

- **literal backslash in prose** — the most direct test of escape accumulation; drafted
  during chunk 1 and lost when trimming the fixture. Straight miss.
- literal entity text (`&amp;`, `&nbsp;`) — sharpest gap, because `&` is one of only two
  allowlisted escape characters and currently appears *only* inside a link destination,
  never in prose
- `[1]`-style literal square brackets; literal `<` and `>`
- nested bullet list; multi-paragraph list item — both exist only as synthetic assertions
- link text containing formatting (`[**bold** link](url)`)
- mailto/email, which `LINK_OPTIONS.protocols` explicitly permits

---

## 4. Mutation checks

A passing test proves nothing until it has been seen to fail. Every pin and every
transform was mutated and the suite re-run. Two of these found real holes.

### Dialect pins

| Mutation | Result | Exact message |
|---|---|---|
| `bullet: '-'` → `'*'` | 6 fail | `STRUCTURAL DIVERGENCE in case "whole canonical fixture": … differ by something other than an added escape` |
| `listItemIndent: 'one'` → `'tab'` | 6 fail | same `STRUCTURAL DIVERGENCE` message |
| `emphasis`/`strong: '*'` → `'_'` | 6 fail | `canonical output uses the pinned dialect` + 3 fixed-point cases |

### Merge transform

| Mutation | Result | Exact message |
|---|---|---|
| `.use(remarkMergeAdjacentLists)` removed | 5 fail | `list marker must be '-': "+ Wide-indent dash bullet, three spaces after the marker"`, `a + list marker reached the store`, `no double blank lines`, `loose list must tighten`, `STRUCTURAL DIVERGENCE` |
| merge ignores list type (`Boolean(ordered)` check → `true`) | 1 fail | `adjacent same-type lists merge…` — the ordered-list case |
| merge ignores adjacency (previous sibling → any list under the parent) | 1 fail | same test; produced `- a\n- b\n\ntext\n` instead of `- a\n\ntext\n\n- b\n` — lists fused across the paragraph |

The last one confirms the paragraph-separated negative case
(`test/canonicalize.test.js:117`) is load-bearing, not decoration.

### Tight lists — found a hole

| Mutation | Result |
|---|---|
| `child.spread = false` removed — **first attempt** | **0 fail** |
| same mutation, after adding the `every list is tight` test | 1 fail — `loose list must tighten` |

Tightening shipped untested. The fixture's lists are already tight and every synthetic
case in the merge test used tight input, so nothing exercised the rule. Only the mutation
check caught it. The `every list is tight` test now covers loose input, part-loose input,
nested loose input, and the multi-paragraph-item guard.

### Escape allowlist — found a second hole

| Mutation | Result | Exact message |
|---|---|---|
| allowlist `+= '#'` — **first attempt** | **0 fail** | — |
| allowlist `+= '#'`, after making the pin bidirectional | 1 fail | `FIXTURE REGRESSION: the allowlist permits ["#"] but no case in the fixture produces that escape any more. Either restore the construct that exercised it (§5) or remove the character from PERMITTED_ADDED_ESCAPES — a permitted-but-unexercised character silently tolerates a future divergence.` |
| allowlist `-= '&'` | 3 fail | `NEW DIVERGENCE: canonicalize added an escape before "&" in case "whole canonical fixture", which the allowlist does not permit. Either TipTap's serializer changed, or canonicalize started escaping something new.` |
| allowlist `-= '_'` | 3 fail | same `NEW DIVERGENCE`, canonical block 4 (`snake_case_name`) |
| allowlist `→ {}` | 4 fail | both of the above |

Adding a character to a tolerance set can never break a containment check, so the `#`
mutation passed by construction and the allowlist could silently accumulate dead entries.
The pin is now bidirectional, per §0.1.

A related bug surfaced while wiring this: the walk function originally consulted the
allowlist itself, so an unpermitted escape failed inside it with the *structural* message
and the caller's per-case check was unreachable dead code. The walk no longer consults
the allowlist, and the three failure modes are now distinguishable — `STRUCTURAL
DIVERGENCE` (marker/indent drift), `NEW DIVERGENCE` (unpermitted escape character),
`FIXTURE REGRESSION` (permitted character nothing exercises). All three verified to fire.

### Other

| Mutation | Result | Note |
|---|---|---|
| `autolink: true` → `false` | 0 fail | No current test outcome depends on the autolink setting. Reverted; see F1 |

---

## 5. Changes to shared artifacts

**S1. `test/fixtures/draft-fixture.md` — separating paragraph removed. Spec conformance.**
The fixture originally had a paragraph between the two bullet lists, added during chunk 1
to dodge remark's `+` marker before the merge transform existed. §5 now states that truly
adjacent lists are required and that "a separating paragraph makes the fixture
non-conformant". The paragraph is gone; the lists are adjacent. Block count 9 → 8, which
moved the idempotence and growth groups from 14 cases to 13. Ratified as a §5 change.

**S2. `test/fixtures/draft-fixture.md` — two adjacent bullet lists are now a required
construct.** Same edit as S1, plus a `REQUIRED_CONSTRUCTS` predicate so the adjacency
cannot be lost silently. Spec conformance.

**S3. `CLAUDE.md` — §0.1, §2.3, §5, §9 edited.** Done at explicit instruction, recording
decisions taken in review: round-trip identity as the property the store depends on, the
adjacent-list merge, `rule: '-'` as defensive only plus the §2.3 out-of-dialect check, and
the HTML clipboard fixture. Not a unilateral change.

**S4. `test/tiptap-fixed-point.test.js` — `doc` derived from canonical input, not raw.**
Spec conformance: §0.1 now states this explicitly. Originally changed because the merge
made the raw-input form unsatisfiable — canonicalize is deliberately not a no-op on two
adjacent lists.

---

## 6. Decisions ratified during chunk 1

### Tight lists — ratified
Every list is stringified tight; `spread = false` on the list, never on its items.

Built before it was authorized and disclosed afterwards, which is backwards under the
Operating rules; the rule now reads that a §0 collision is reported before the code
exists. Recorded here because the code is in the repo and the reasoning should not live
only in a terminal scrollback.

- **It is diff hygiene, not a round-trip requirement.** tiptap-markdown preserves
  tightness in both directions — it stores it as a `tight` attribute on `bulletList`
  (`{"tight":{"default":true}}`), so loose Markdown round-trips as loose. Verified: with
  tightening removed, a loose canonical list satisfies
  `canonicalize(tiptapSerialize(tiptapParse(canonical))) === canonical`. Round-trip
  identity holds with or without the rule.
- **What it prevents:** a model flipping a list from tight to loose while changing no
  words renders in the word diff as every item deleted and re-inserted. Exactly the
  phantom diff §0.1 exists to prevent.
- **Why global rather than a merge-scoped tie-break:** the tie-break only fires when two
  lists are adjacent, and most drafts have one list, so a loose list from the model would
  never be merged and would stay loose. A scoped rule also makes tightness depend on
  whether another list happened to follow, which is an accident, not a dialect.
- **The cost, stated plainly:** unlike the merge, this discards a distinction TipTap *can*
  represent. A loose list written by the model is silently made tight and that intent is
  unrecoverable from the store. Accepted because nothing in v1 lets a human ask for a
  loose list — §1's formatting list omits it, the editor has no gesture for it, typed
  lists come out tight.
- **Scope is load-bearing:** only the list's own spread. Setting it on list items would
  turn `- para one\n\npara two` into a single paragraph on reparse, which is content
  corruption. Pinned by a test.

### Autolink — resolved in §5, code not yet updated
§5 now reads: autolink OFF in v1, link-on-paste ON, because autolink converts a bare URL
to `[url](url)` when the human types beside it, landing in a human turn as an edit the
human did not make. The store holds bare URLs as plain text (no GFM, §0.1), so §5 resolves
against §0.1 by decision rather than by test. `src/tiptap-config.js` still sets
`autolink: true` — open mismatch F1, deliberately not fixed inside chunk 1.

---

## 7. Findings — spec wrong, underspecified, or contradicted by the code

**F1. `src/tiptap-config.js` contradicts §5 on autolink.** `LINK_OPTIONS` sets
`autolink: true` with a now-stale comment reading `// §5: autolink and link-on-paste
enabled`. §5 as written requires autolink OFF. No test outcome depends on the setting
(verified by mutation), so this is a one-line change plus a comment, deferred so §5's
resolution is applied deliberately rather than folded into chunk 1's tail.

**F2. §0.1's bidirectional pin does not specify a granularity, and the obvious reading is
impossible.** "Assert the observed divergence set EQUALS the permitted set" cannot hold
per case: canonical block 1 produces only `&` (a link destination) and canonical block 4
produces only `_` (`snake_case_name`). Implemented as containment per case (fails fast,
names the case) plus equality over the union of all cases. The union form couples this
test to the fixture — if the fixture stops producing one permitted character, the test
fails as a fixture regression. That coupling is now deliberate and carries its own
message; §0.1 should say which granularity it means.

**F3. "Every list is tight" is asserted on synthetic inputs, not as a property of the
fixture's canonical output.** §0.1 says "assert no list in canonical output is spread".
The test asserts exact output equality for loose, part-loose, and nested-loose synthetic
inputs, which is stronger for those cases but does not scan the fixture's canonical output
for a spread list. The fixture's list is tight either way, so nothing is currently
missed — but the assertion does not match the spec's wording, and a future fixture with a
loose list would not be caught by it.

**F4. `bulletOther: '+'` is now unreachable but cannot be removed.** remark requires
`bulletOther !== bullet`, so the option must hold some value, and the merge transform means
no input can ever reach the code path that uses it. Dead-but-mandatory; noted so it is not
mistaken for a live pin.

**F5. §0.1's required-tests list and §9 step 1 describe different sets.** §0.1 lists
round-trip identity as required; §9 step 1 lists chunk 1's tests without it, and §0.1
itself assigns it to chunk 2. Consistent once read together, but a reader checking chunk 1
against the §0.1 list will find one required test missing and should not conclude it was
skipped.

**F6. §5's fixture list does not cover its own stated failure mode.** §5 says escaping is
what matters, then names no escaping trap beyond `a * b`, `snake_case_name`, and `100%`.
The gaps are listed at the end of section 3. Chunk 2's round-trip identity runs against
this same file, so a thin fixture hollows out that test too.

### Resolved during chunk 1 (kept for the record)

- Strict TipTap fixed point is unachievable and §0.1's "adjust TipTap, not the
  canonicalizer" had no knob to turn: remark-stringify escapes conservatively,
  tiptap-markdown's prosemirror-markdown serializer does not, and TipTap exposes no
  option. Resolved in §0.1 as a fixed point up to added escapes, pinned to `_` and `&`.
- Adjacent lists produced `+` markers, violating `bullet: '-'`. Resolved as the authorized
  merge.
- `rule: '-'` contradicted §1/§7, which exclude thematic breaks. Resolved as defensive
  only, plus the §2.3 out-of-dialect check.
- A `.md` fixture cannot exercise paste filtering at all. Resolved as the separate HTML
  clipboard fixture in §5, chunk 2.
- canonicalize's escapes are visible to the model in the API payload
  (`snake\_case\_name`, `?a=1\&b=2`), which invites tidying churn. Recorded in §2.3 as a
  chunk 5 watch item.
- The trailing newline mismatch between tiptap-markdown and canonicalize was fixable on
  the TipTap side and was fixed there, in `src/tiptap-serialize.js`.

---

## 8. What was NOT verified

Named as such, because none of it is covered by the 46 passing tests.

- **Round-trip identity — `canonicalize(tiptapSerialize(tiptapParse(canonical))) ===
  canonical` is not asserted anywhere.** It was observed to hold once, in a throwaway
  probe, against an earlier revision of the fixture that predates both the merge transform
  and tight lists. That observation is not evidence about the current fixture and is not a
  test. Chunk 2 item 1.
- **Nested bullet lists, multi-paragraph list items, mailto links** — no round-trip
  coverage. Nested lists and multi-paragraph items appear only as synthetic assertions
  inside `every list is tight`; mailto is not covered at all, despite being in
  `LINK_OPTIONS.protocols`. §9 step 2 calls these out as chunk 2 work.
- **The HTML clipboard paste path.** `clipboardTextParser`, `linkOnPaste`, and paste
  filtering are entirely untested. `MARKDOWN_OPTIONS.html: false` and
  `transformPastedText: false` are set but unexercised. Chunk 2.
- **Autolink behavior under real typing.** Deliberately not characterized — §5 forbids
  building a headless input-event test for it. Earlier programmatic probes
  (`insertContent` adjacent to a bare URL) did not trigger autolink, but programmatic
  insertion does not exercise the input-rule path, so those probes prove nothing either
  way. No test was left behind.
- **`transformCopiedText: true`** — set in `MARKDOWN_OPTIONS`, never exercised.
- **The individual effect of the unpinned `STRINGIFY_OPTIONS` entries** — `fences`,
  `incrementListMarker`, `resourceLink`, `tightDefinitions`. Not named by §0.1 and not
  mutation-tested one by one.
- **Adversarial or large input.** No fuzzing, no deeply nested structures, no
  multi-megabyte drafts, no performance measurement. Idempotence is verified to 10 passes,
  which is what §0.1 asks for, and not beyond.
- **Everything downstream.** No storage layer, no turn model, no server, no React app, no
  editor UI. `src/tiptap-config.js` has never been mounted in a browser; it is exercised
  only through the headless helper.
