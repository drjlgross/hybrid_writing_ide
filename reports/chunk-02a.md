# Chunk 2a — fixture amendment, and the rest of §9 step 2

Status: **the suite is RED and I stopped rather than fixing it.** 96 tests, 93 pass,
3 fail. The three failures are one §0.1 collision, reported below and not coded around.

**Round-trip identity holds for all six new constructs — 16/16 cases pass.** Nothing in
the nested list, the multi-paragraph item, or the mailto link was interesting after all.
What is interesting is the literal backslash, and it broke the *fixed-point* test, not
round-trip identity.

---

## 1. The collision — read this first

### C1. TipTap escapes a literal backslash; canonicalize does not. §0.1's fixed-point tolerance only covers escapes canonicalize ADDS, so it cannot express this.

Canonical block 8, and the whole canonical fixture that contains it:

    canonical                    …backslash \ stands alone here, a Windows path C:\temp\file…
    tiptapSerialize(tiptapParse) …backslash \\ stands alone here, a Windows path C:\\temp\\file…
    canonicalize(that)           …backslash \ stands alone here, a Windows path C:\temp\file…

TipTap's serializer escapes a literal backslash as `\\`; remark-stringify emits a bare
`\`. So canonicalize **removes** a backslash. §0.1 says the fixed point holds "except for
backslashes canonicalize *adds*, and the permitted set is pinned to exactly `_` and `&`" —
there is no vocabulary in that sentence for a backslash canonicalize takes away, so the
walk classifies it as `STRUCTURAL DIVERGENCE` and fails.

    AssertionError [ERR_ASSERTION]: STRUCTURAL DIVERGENCE in case "whole canonical
    fixture": TipTap output and its canonicalization differ by something other than an
    added escape. A marker, list indent, or blank-line change — check the pinned
    STRINGIFY_OPTIONS and MARKDOWN_OPTIONS against each other.

    AssertionError [ERR_ASSERTION]: STRUCTURAL DIVERGENCE in case "canonical block 8:
    More escape traps: a literal backslash \ s…": …same message…

**The store is not at risk.** Round-trip identity holds for that exact block — canonical →
TipTap → canonical is byte-identical, because canonicalize is the last step and normalizes
TipTap's extra backslash away. This is precisely the complementarity §0.1 now records:
round-trip identity guards what survives a human turn, the fixed-point test is a canary for
serializer dialect drift. The canary is firing on a real dialect difference that costs
nothing.

Every fix is a §0.1 change, so per Operating rules I stopped:

- **Extend the tolerance to removed backslashes**, with its own pinned set (`{\}`), so the
  test says "escapes canonicalize adds, from `{_, &}`; escapes canonicalize removes, from
  `{\}`". Keeps the canary and the fixture. My recommendation, but it is a §0.1 edit and it
  is yours.
- **Drop the literal backslash from the fixture.** Cheapest, and wrong in my view: you
  added it because escape accumulation is the failure mode that matters, and round-trip
  identity now covers it. Removing it to keep a different test green loses real coverage.
- **Change nothing and accept a red suite.** Not viable.

I did not touch `canonicalize`, `STRINGIFY_OPTIONS`, or `PERMITTED_ADDED_ESCAPES`.

Related, and already handled inside the existing tolerance: `AT&T` canonicalizes to
`AT\&T`, TipTap emits `AT&T`, canonicalize re-adds the escape. That is an *added* escape
before `&`, already permitted — so the `&` allowlist entry is now exercised in prose and
not only in a link destination, which was the stated purpose of the entity-text request.
The union assertion still passes with the set exactly `{_, &}`.

---

## 2. Fixture amendment

Appended, so every pre-existing byte is untouched — asserted programmatically
(`after.startswith(before)`), not assumed. 1483 → 2441 bytes.

    sha256  7afe8b104030719f79a2f33c6acaddfd3f3490dcf5fe0bf61b83aeb6015acd3e
    bytes   2441

Per your instruction, word count is gone from fixture stats. Bytes and sha256 do not
depend on which `wc` is installed.

### `cat -A` output, verbatim

macOS `cat` rejects `-A`; `cat -vet` is the same flag set. Note that BSD `cat -v` mangles
multibyte UTF-8 — the smart quotes and the U+00A0 render as partial byte sequences below,
so exact positions for the invisibles follow separately.

```
This paragraph carries **bold text**, *italic text*, and an inline [link to the docs](https://example.com/docs?a=1&b=2) in the middle of a sentence.$
$
Dialect drift on purpose: _underscore italic_ and __underscore strong__ should both come back as asterisks.$
$
A bare URL sits here: https://example.com/bare/url and prose continues after it. A link whose target has parentheses: [parenthesised target](https://example.com/a_(b)) follows it.$
$
Escaping traps: a * b is a literal asterisk, snake_case_name is an underscored identifier, 100% is a percent sign, and 2 * 3 * 4 keeps three of them on one line. $
$
* Star bullet with **bold** and _italic_$
* Star bullet holding a [bullet link](https://example.org/two)$
* Star bullet with a bare URL https://example.net/three and 100% plain text$
$
-   Wide-indent dash bullet, three spaces after the marker$
-   Second wide-indent bullet with an [indented link](https://example.org/wide)$
$
$
$
Pasted from Word: ?M-^@M-^\Smart quotes,?M-^@M-^] an em dash ?M-^@M-^T an ellipsis ?M-^@? a non-breaking space right here: (one nbsp sits just before that paren), an apostrophe in don?M-^@M-^Yt, and a pasted hyperlink [Microsoft Word](https://www.microsoft.com/en-us/microsoft-365/word) that came along with the paste.$
$
Pasted from Google Docs: ?M-^@M-^Xsingle curly quotes?M-^@M-^Y, another apostrophe in it?M-^@M-^Ys, a stray underscore _ standing alone, 100% of the figures, and a pasted hyperlink [Google Docs](https://docs.google.com/document/d/1AbC_dEf-23/edit) that came along with the paste.$
$
More escape traps: a literal backslash \ stands alone here, a Windows path C:\temp\file keeps two more, entity text &amp; and &nbsp; is written out, and AT&T and R&D put an ampersand before a letter.$
$
Reach the author at [mail me](mailto:writer@example.com) or at the [docs mailbox](mailto:docs@example.com?subject=Hello) instead.$
$
- Loose item one, with a blank line after it$
$
- Loose item two, so the list parses as spread$
$
- Loose item three, still loose$
$
A paragraph keeps the loose list away from the nested one below.$
$
- Outer bullet with a nested list beneath it$
  - Nested inner bullet with **bold**$
  - Nested inner bullet with an [inner link](https://example.org/inner)$
- Outer bullet after the nested list$
$
A paragraph keeps the nested list away from the multi-paragraph item below.$
$
- Item one holds two paragraphs, and this is the first.$
$
  This second paragraph belongs to the same list item.$
$
- Item two is an ordinary single-paragraph item.$
```

Invisibles, by exact byte position rather than by eye:

    line  7  trailing space:  '…keeps three of them on one line. '
    line 18  U+00A0 at col 94: 'ce right here:\xa0(one nbsp sits '
    lines 15-17  three consecutive blank lines (one `\n{4}` run in the file)

### The six requested constructs, plus one addition

| Construct | Where | Predicate |
|---|---|---|
| a LOOSE bullet list | L26–30, blank lines between items | `a LOOSE bullet list` |
| literal backslash in prose | L22 `backslash \ stands alone` | `literal backslash in prose` |
| entity text `&amp;` / `&nbsp;` | L22 | `entity text (&amp; and &nbsp;)` |
| nested bullet list | L34–37 | `nested bullet list` |
| multi-paragraph list item | L41–43 | `multi-paragraph list item` |
| mailto link | L24, two of them | `mailto link`, `mailto link with a query string` |

**Addition beyond your list, with reason.** You asked for entity text "so `&` is exercised
outside a link destination". It does not do that on its own: remark **decodes** character
references, so `&amp;` becomes a bare `&`, and a `&` followed by a space needs no escape.
Nothing is escaped and the allowlist entry stays unexercised in prose. So I also added
`AT&T and R&D` — an ampersand before a letter, which canonicalizes to `AT\&T` and does
exercise it. Two extra predicates cover the pair:
`ampersand before a letter, outside a link destination` and
`backslash before a letter (Windows path)`.

Existing constructs all retained, including the two truly adjacent lists at L9–14 —
`REQUIRED_CONSTRUCTS` is now 30 predicates and all 30 pass.

---

## 3. What was verified

`npm test` → **96 tests, 93 pass, 3 fail.** Per group:

| Cases | Group |
|---:|---|
| 16 | `round-trip identity: canonical → TipTap → canonical is byte-identical` — **16/16 pass** |
| 1 | `round-trip identity holds for degenerate drafts` — pass |
| 24 | `idempotence: canonicalize(canonicalize(x)) === canonicalize(x)` — 24/24 pass |
| 24 | `no escape accumulation: ten passes never grow and never change` — 24/24 pass |
| 16 | `TipTap is a fixed point of canonicalize, up to added escapes` — **14 pass, 2 FAIL** (C1) |
| 1 | `fixture covers every construct §5 requires` — pass, 30/30 predicates |
| 1 | `canonical output uses the pinned dialect` — pass |
| 1 | `adjacent same-type lists merge, and no + marker ever reaches the store` — pass |
| 1 | `no list in canonical output is spread` — pass |
| 1 | `loose lists tighten` — pass |
| 1 | `a list item holding two paragraphs keeps the blank line between them` — pass |
| 1 | `canonicalize preserves the content §5 cares about` — pass |
| 1 | `canonicalize rejects non-strings` — pass |
| 1 | `TipTap's serializer emits the pinned dialect` — pass |
| 1 | `the pipeline converges from NON-canonical input in one pass` — pass |
| 1 | `the schema allows exactly doc/paragraph/text/bulletList/listItem + bold/italic/link` — pass |

The 3 failures are the two fixed-point subtests plus their group parent, which node:test
counts as a test.

Case counts grew with the fixture: idempotence and escape growth went 13 → 24
(1 whole + 19 blocks + 4 degenerate), round-trip identity 8 → 16 (1 whole + 15 canonical
blocks), fixed point 8 → 16 likewise.

Every new construct individually, probed before amending anything — canonical form,
idempotence, ten-pass stability, and round-trip identity all verified per construct:

| Construct | Canonical form | Round-trip |
|---|---|---|
| loose list | tightened to `- a\n- b\n- c\n` | holds |
| literal backslash | unchanged, bare `\`, 28→28 chars over ten passes | holds |
| backslash before a letter | `C:\temp\file` unchanged | holds |
| entity text | `&amp;` → `&`, `&nbsp;` → U+00A0 | holds |
| ampersand before a letter | `AT&T` → `AT\&T` | holds |
| nested list | unchanged, 2-space indent | holds |
| multi-paragraph item | internal blank line kept, no blank between items | holds |
| mailto link, plain and with query | unchanged | holds |

---

## 4. Mutation checks

### F8 closure — the structural assertion is now independently load-bearing

Removing `child.spread = false` from `canonicalize` (96 tests, 6 fail) now fails **three
separate tests**, which is what F8 asked for:

| Test | Why it fails |
|---|---|
| **`no list in canonical output is spread`** | **The structural assertion, on its own.** `AssertionError: list node is spread at line 23: canonical output contains a loose list, so the §0.1 tight-list rule is not being applied` |
| `loose lists tighten` | the synthetic cases — `loose list must tighten` |
| `a list item holding two paragraphs keeps the blank line between them` | the fixture's multi-paragraph list goes loose, so blank lines appear between items |

F8 is closed. Before the amendment the structural assertion could not fail — the fixture
held no loose list, so with tightening removed it still parsed to `spread: false`. Now the
loose list at L26–30 makes it fail by itself, with its own message naming the line.

### Regression check on the amended fixture

The two fixed-point subtests fail per C1. All other groups pass, including the three that
the amendment initially broke (section 5).

---

## 5. Changes to shared artifacts

**S5. `test/fixtures/draft-fixture.md` — six constructs added, plus two escape cases.**
Spec conformance: §5 as amended requires them, and §9 step 2 named nested lists,
multi-paragraph items, and mailto links as the work. New sha256 in section 2. Appended
only; all prior bytes preserved and asserted.

**S6. Three of my existing tests hardcoded the old fixture's shape and broke on the
amendment. Fixed test-side; no canonicalize change.** Convenience, not spec conformance —
these were my brittleness, not a spec question:

- `fixture covers every construct §5 requires` — my new `nested bullet list` predicate had
  a regex that required the outer bullet's text to end immediately before the newline. Bug
  in the predicate, not the fixture.
- `adjacent same-type lists merge, and no + marker ever reaches the store` — asserted
  `listBlocks.length === 1`, true only when the fixture had a single list. It now locates
  the merged block by content and, better, asserts the general invariant structurally over
  mdast: nowhere in the tree do two same-type lists sit adjacent. That holds however the
  fixture grows.
- `canonicalize preserves the content §5 cares about` — its word comparison assumed
  canonicalize changes no words. Entity decoding breaks that assumption (`&amp;` → `&`,
  `&nbsp;` → U+00A0), and replacing backslashes with spaces split `AT\&T` into two tokens.
  The comparison now decodes entities on the raw side and deletes backslashes rather than
  replacing them.

**S7. `test/canonicalize.test.js` — `every list is tight` split into three tests.** §0.1
says to assert the multi-paragraph case separately, and F8 required the structural
assertion to fail on its own. Now: `no list in canonical output is spread` (structural,
fixture), `loose lists tighten` (synthetics), `a list item holding two paragraphs keeps the
blank line between them`.

**S8. The item-level spread assertion is gone — it was my overreach and it is
unsatisfiable.** I had asserted `spread === false` on every list *item* as well as every
list. A list item holding two paragraphs necessarily has `item.spread === true`, and §0.1
requires the fixture to contain one, so the two requirements could not both hold. §0.1 only
ever said "no *list* in canonical output is spread". List nodes only now, with a comment
saying why. Caught by the amendment, not by review.

---

## 6. Findings

**F11. canonicalize decodes HTML character references, and this is a content change.**
`&amp;` → `&`, `&nbsp;` → U+00A0. Both render identically to the entity form, so nothing
is lost visually, and it is idempotent and round-trip stable. But it is a source-text
transformation the spec does not mention, and it has a §2.3 consequence: a model that emits
`&amp;` will see its entity silently rewritten in the store. Worth a line in §0.1 or §2.3
so it is a decision rather than an accident.

**F12. `&` is escaped by position, not by presence.** `&` followed by a space is left bare;
`&` followed by a letter becomes `\&`. This is why the entity-text request did not, by
itself, exercise the `&` allowlist entry outside a link destination, and why `AT&T` was
needed. Worth knowing before anyone tries to remove the `AT&T` case as redundant with the
entity text.

**F13. A multi-paragraph list item does not make the parent list spread in remark.**
`list:false item:true` — remark sets `list.spread` from blank lines *between* items and
`item.spread` from blank lines *within* an item, which is looser than CommonMark's
definition of a loose list. This is what makes §0.1's two tight-list requirements
satisfiable together. It is also a remark-specific behavior, so a remark upgrade could
change it; the F3 structural assertion would catch that.

### Still open from earlier chunks

- **F2 / granularity** — now closed. §0.1's new paragraph specifies containment per case
  plus equality over the union, which is exactly what the test does.
- **F7** — closed; the sentence is present, and my previous report's guess that it was an
  unsaved edit was wrong.
- **F9** — now codified in §0.1. C1 is the first time the canary has actually earned its
  keep.

---

## 7. What was NOT verified

- **The C1 resolution.** Nothing was changed, so nothing about the fix is tested. The suite
  stays red until you decide.
- **The HTML clipboard fixture** (§5, chunk 2). Still not started — `clipboardTextParser`,
  `linkOnPaste`, paste filtering, `html: false`, `transformPastedText: false` all remain
  untested. This is the last outstanding item of §9 step 2.
- **Deeper nesting.** The fixture has one level of nesting. Three-deep lists, a nested list
  inside a multi-paragraph item, and a list inside the second paragraph of an item are all
  unverified.
- **Ordered lists, headings, tables, blockquotes, thematic breaks** — excluded from the
  fixture by §5 and belonging to the §2.3 stripper. Untested by design.
- **Autolink under real typing** — still uncharacterized by §5's instruction.
- **`transformCopiedText: true`** — set, never exercised.
- **Everything downstream** — no storage, turn model, server, or UI. The TipTap config has
  never been mounted in a browser.

---

## 8. Errata for earlier reports

Carried forward from chunk 2's errata, now with the word-count item resolved.

| Claim | Correct value |
|---|---|
| chunk-01: fixture is 21 lines | 20 (`wc -l`); 21 came from `split('\n').length` |
| chunk-01: two blank lines before the Word paragraph | three |
| chunk-01: canonical output flat at 1468 chars | 1467 |
| chunk-01: idempotence was "15 cases" pre-amendment | 14, retracted in chunk 1 |
| chunk-01 and chunk-02: fixture is 204 words | Withdrawn as meaningless. GNU `wc -w` says 201, BSD `wc -w` says 204, Python `str.split()` says 204 (it splits on U+00A0), ASCII-only splitting says 203. Word count is tool-dependent and is no longer reported |

`reports/chunk-01.md` is left unedited, as instructed.
