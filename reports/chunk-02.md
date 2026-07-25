# Chunk 2 — item 1 only: round-trip identity

Build order §9 step 2, first item. Status: **round-trip identity holds against the current
fixture.** 56 tests pass, 0 fail. The fixture was not amended.

Also in this document: the three housekeeping items requested alongside item 1 (F3, two
wrong comments in `canonicalize.js`, allowlist mutations re-run against the corrected walk
wiring), and an errata for chunk 1's prose counts.

Remaining chunk 2 work — nested lists, multi-paragraph list items, mailto links, the HTML
clipboard fixture — is **not** started. See section 7.

---

## 1. What was built

### `test/round-trip-identity.test.js` (new)
The §0.1 required test:

    canonicalize(tiptapSerialize(tiptapParse(canonical))) === canonical

Two groups:

- `round-trip identity: canonical → TipTap → canonical is byte-identical` — 8 cases: the
  whole canonical fixture plus each of its 7 canonical blocks. Every input is canonical
  **by construction**, passed through `canonicalize` first. This matters: a block sliced
  out of a canonical document is not necessarily canonical itself — the last block carries
  the document's trailing newline — and comparing against a non-canonical input tests
  nothing. My first probe had exactly that bug and reported a false failure on block 7;
  the corrected probe and the committed test both pass.
- `round-trip identity holds for degenerate drafts` — empty string, whitespace-only, and a
  single word. Not §5 fixture cases; an empty draft is the state the app starts in, so it
  must not churn either. Beyond what §0.1 requires.

On failure the test prints the failing case, the first differing line with want/got, and a
reminder that a canonicalize-side fix is a §0.1 collision to report rather than apply.

### `test/canonicalize.test.js` — F3 addressed
`every list is tight` now parses the canonical fixture output to mdast (parse only, no
stringify) and asserts `spread === false` on every list node **and** every list item node,
which is what §0.1's wording asks for. The synthetic cases are unchanged and still there.
See F8 for the limit of what this assertion can currently catch.

### `src/canonicalize.js` — two comments corrected
- The input-normalization comment claimed form-feed handling that does not exist. It now
  says what the code does: CRLF and lone CR become LF.
- The tightening comment restated the ratification argument. It now points at §0.1 and
  keeps only the operative constraint — list spread yes, list-item spread never.

No behavior change; the suite is byte-identical in outcome before and after.

---

## 2. What was verified

`npm test` → **56 tests, 56 pass, 0 fail.** Per group:

| Cases | Group |
|---:|---|
| 8 | **`round-trip identity: canonical → TipTap → canonical is byte-identical`** — 8/8 |
| 1 | **`round-trip identity holds for degenerate drafts`** |
| 13 | `idempotence: canonicalize(canonicalize(x)) === canonicalize(x)` — 13/13 |
| 13 | `no escape accumulation: ten passes never grow and never change` — 13/13 |
| 8 | `TipTap is a fixed point of canonicalize, up to added escapes` — 8/8 |
| 1 | `fixture covers every construct §5 requires` |
| 1 | `canonical output uses the pinned dialect` |
| 1 | `adjacent same-type lists merge, and no + marker ever reaches the store` |
| 1 | `every list is tight` |
| 1 | `canonicalize preserves the content §5 cares about` |
| 1 | `canonicalize rejects non-strings` |
| 1 | `TipTap's serializer emits the pinned dialect` |
| 1 | `the pipeline converges from NON-canonical input in one pass` |
| 1 | `the schema allows exactly doc/paragraph/text/bulletList/listItem + bold/italic/link` |

`node --test test/round-trip-identity.test.js` alone → 10 pass, 0 fail (8 subtests + the
group parent + the degenerate-drafts test).

§0.1 required-tests conformance is now complete for every item except the granularity
question in F7 and the coverage limit in F8:

| §0.1 requirement | Status |
|---|---|
| Idempotence | Met — 13 cases |
| **Round-trip identity** | **Met — 8 cases, this chunk** |
| Fixed point up to added escapes, `doc` from canonical input | Met — 8 cases |
| ↳ bidirectional pin | Met; granularity still unspecified in the spec (F7) |
| No escape accumulation | Met — 13 cases |
| No `+` bullet reaches the store | Met |
| Every list is tight — no list in canonical output is spread | Met structurally (F8 limits what it catches) |
| ↳ multi-paragraph item keeps its blank line | Met |

---

## 3. Fixture

**Not amended this chunk.** `test/fixtures/draft-fixture.md`, unchanged from the ratified
chunk 1 state:

    sha256  09c151e16d1f766a72e3cbd3731bb6b1d168050038fab4b7195528df17cedf56

Measured with commands rather than by eye (`wc`, and Python for the invisibles):

| Measure | Value |
|---|---|
| bytes (`wc -c`) | 1483 |
| chars (`wc -m`) | 1466 |
| words (`wc -w`) | 204 |
| lines (`wc -l`, newline count) | 20 |
| blocks (split on `\n{2,}`, non-empty) | 8 |
| canonical output, pass 1 | 1467 chars, 1484 bytes |
| canonical output, passes 1–10 | 1467 × 10, flat |

Contents are reproduced in `reports/chunk-01.md` §3 and are byte-identical to that
listing. The §5 walk, re-verified against this revision by `REQUIRED_CONSTRUCTS`:

| §5 requirement | Where |
|---|---|
| bold | L1 `**bold text**`; L9 `**bold**` |
| italic | L1 `*italic text*`; L9 `_italic_` |
| a bullet list | L9–11 and L13–14 |
| an inline link | L1; also L10, L14, L18, L20 |
| a bare URL | L5 `https://example.com/bare/url`; L11 `https://example.net/three` |
| literal asterisk in prose | L7 `a * b`, plus `2 * 3 * 4` |
| underscored identifier | L7 `snake_case_name` |
| percent sign | L7, L11, L20 |
| two adjacent bullet lists | L9–11 then L13–14, nothing between |
| Word typographic artifacts | L18 `“ ”`, em dash, ellipsis, U+00A0, `don’t` |
| Word pasted hyperlink | L18 |
| Google Docs typographic artifacts | L20 `‘ ’`, `it’s` |
| Google Docs pasted hyperlink | L20, underscore inside the doc ID |

All 21 `REQUIRED_CONSTRUCTS` predicates pass. Invisibles: one trailing space on L7, one
U+00A0 on L18, and **three** consecutive blank lines between the wide-indent list and the
Word paragraph (chunk 1's report said two — see errata).

---

## 4. Mutation checks

### The new round-trip identity test

Run against `test/round-trip-identity.test.js` alone, so attribution is unambiguous.

| Mutation | Round-trip file alone | Note |
|---|---|---|
| `MARKDOWN_OPTIONS.linkify` false → **true** | **6 pass, 4 fail** | The load-bearing one |
| trailing-newline normalization removed from `src/tiptap-serialize.js` | fails; 10 fail suite-wide | Breaks nearly everything |
| `MARKDOWN_OPTIONS.bulletListMarker` `'-'` → `'*'` | **10 pass, 0 fail** | Not caught here — see F9 |
| `MARKDOWN_OPTIONS.tightLists` true → **false** | **10 pass, 0 fail** | Not caught here — see F9 |

`linkify: true` is the mutation that proves this test is not decorative: TipTap autolinks
the bare URLs at parse time, they serialize as `[url](url)`, canonicalize preserves that,
and 4 of the 10 cases stop matching. Round-trip identity is the test that protects §5's
autolink-off / bare-URL-as-plain-text boundary.

### Allowlist mutations, re-run against the corrected walk wiring

Chunk 1's numbers for two of these were collected before the walk stopped consulting the
allowlist. All four re-run on the current tree; totals are out of 56 now:

| Mutation | Result | Message |
|---|---|---|
| allowlist `-= '&'` | 53 pass, 3 fail | `NEW DIVERGENCE` — group parent + whole canonical fixture + canonical block 1 (the `?a=1&b=2` link destination) |
| allowlist `-= '_'` | 53 pass, 3 fail | `NEW DIVERGENCE` — group parent + whole canonical fixture + canonical block 4 (`snake_case_name`) |
| allowlist `→ {}` | 52 pass, 4 fail | `NEW DIVERGENCE` — group parent + whole fixture + blocks 1 and 4 |
| allowlist `+= '#'` | 55 pass, 1 fail | `FIXTURE REGRESSION` — group parent only |

Both directions still fire, and each names the case. Fail counts include the group parent,
which node:test counts as a test.

### F3 assertion

| Mutation | Result |
|---|---|
| `child.spread = false` removed | 55 pass, 1 fail — `every list is tight` |

The failure comes from the synthetic `loose list must tighten`, **not** from the new
structural assertion. See F8.

---

## 5. Changes to shared artifacts

None. The fixture is unchanged (hash in section 3), `CLAUDE.md` was not touched, and the
only edits to committed files are the two corrected comments in `src/canonicalize.js`,
which change no behavior.

---

## 6. Findings

**F7. §0.1's fixed-point bullet has no granularity sentence, so F2 is still open.** The
instruction for this chunk said to re-read it because "the granularity sentence is new".
`CLAUDE.md` has an mtime of 16:50, earlier than the read that produced chunk 1's final
report, and lines 139–159 are byte-identical to that read. `grep -i
"granular\|per case\|per-case\|union\|containment"` matches one line — the pre-existing
"not that it is contained by it". Nothing addresses whether the equality is per case or
over the union. The implementation is unchanged from what chunk 1 reported: containment per
case, equality over the union of all cases, because per-case equality is impossible
(canonical block 1 produces only `&`, block 4 only `_`). Presumably an unsaved edit.

**F8. The new F3 structural assertion cannot fail against the current fixture.** With
tightening removed from `canonicalize`, the fixture's canonical output still parses to one
list with `spread: false`, because the fixture contains no loose list — its source lists
are already tight, and the merge does not introduce looseness. Verified directly, not
inferred: with the rule removed, `lists found: 1, spread values: [false]`, so the assertion
passes. It is a guard for a future fixture, not a live check today. Making it load-bearing
requires a loose list in the shared fixture, which this chunk was explicitly forbidden to
add. The synthetic cases are what actually catch the regression.

**F9. Round-trip identity does not catch TipTap serializer drift, and the fixed-point test
does not catch autolink drift. Neither test subsumes the other.** Changing
`bulletListMarker` to `'*'` or `tightLists` to `false` leaves round-trip identity fully
green, because canonicalize is the last step and normalizes both away — the same mutations
fail the fixed-point test with `STRUCTURAL DIVERGENCE`. Conversely `linkify: true` breaks
round-trip identity in 4 cases. Worth recording so neither test is later deleted as
redundant: the fixed-point test guards the serializer's dialect, round-trip identity guards
what survives a human turn.

**F10. Round-trip identity is what makes §5's autolink decision enforceable.** §5 resolved
autolink off by decision rather than by test, explicitly declining a headless input-event
test. The `linkify: true` mutation shows this test catches the *parse-time* half of the same
boundary. The typing-time half remains uncovered by design.

---

## 7. What was NOT verified

- **The rest of §9 step 2.** Nested bullet lists, multi-paragraph list items, and mailto
  links are still absent from the shared fixture, so round-trip identity is **unproven**
  for all three. §9 step 2 names them as the next thing to test, and the spec warns that a
  failure wanting a canonicalize-side fix is a §0.1 collision to report before coding. Not
  started.
- **The HTML clipboard fixture** (§5, chunk 2). `clipboardTextParser`, `linkOnPaste`, paste
  filtering, `html: false`, and `transformPastedText: false` remain entirely untested.
- **Autolink under real typing.** Still deliberately uncharacterized per §5. The
  `linkify: true` mutation covers parse-time autolinking only; it says nothing about what
  the input rule does when a human types beside a URL.
- **The escaping traps missing from the fixture** — literal backslash, entity text
  (`&amp;`, `&nbsp;`), `[1]`, `<`/`>`, formatted link text. Round-trip identity is unproven
  for all of them. Recommended in chunk 1 §3; not added, since the fixture was not to be
  amended.
- **`transformCopiedText: true`** — set, never exercised.
- **Everything downstream.** No storage, no turn model, no server, no React app. The TipTap
  config has still never been mounted in a browser.

---

## 8. Errata for `reports/chunk-01.md`

Four of the five prose counts flagged as wrong are confirmed wrong; all were narrative, and
none were values any test asserts. Re-derived with commands:

| Claim in chunk-01.md | Correct value | How |
|---|---|---|
| fixture is 21 lines | **20** | `wc -l` = 20. My 21 came from `split('\n').length`, which counts the empty string after the final newline |
| two consecutive blank lines before the Word paragraph | **three** | counted programmatically |
| canonical output flat at 1468 chars | **1467** | `canonicalize(FIXTURE).length` = 1467, flat across ten passes |
| idempotence was "15 cases" before the fixture edit | **14**, retracted in chunk 1 | 1 whole + 9 blocks + 4 edge |

The fifth, **204 words → 201**, I cannot reproduce. `wc -w` reports 204 and Python's
`str.split()` reports 204 on the current file, whose hash is in section 3. Excluding
pure-markup tokens (bare markers, bare URLs, whole link constructs) gives 193. I have no
measure that yields 201, so I have left 204 in this report; if 201 came from a different
tool, say which and I will match it.

Chunk 1's report is committed and I have not edited it. Say the word if you want the four
confirmed corrections applied there rather than only recorded here.
