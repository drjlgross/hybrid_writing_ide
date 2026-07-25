# Chunk 2b — removed-escape tolerance

Status: **suite is NOT green. 96 tests, 94 pass, 2 fail.** C1 is fixed. A second collision
of the same shape but a different axis is now the only failure, and it is a §0.1 decision,
so I stopped instead of coding around it.

## 1. CLAUDE.md edits — applied verbatim

All three as written, no rewording, nothing extended:

1. §0.1 fixed-point bullet's first paragraph replaced, plus the removal-case paragraph.
2. Granularity paragraph's first sentence replaced so it governs both sets.
3. §9: the HTML clipboard fixture removed from step 2, now its own step 6 immediately
   before the history view, with the deferred-by-priority line. History view → 7,
   everything else → 8. Step 1's parenthetical updated from "fixed point up to added
   escapes" to "up to escape differences" to match the bullet's new title.

## 2. Removed-set tolerance — implemented

`PERMITTED_REMOVED_ESCAPES = new Set(['\\'])`, mirroring the added set. `diffOnlyAddedEscapes`
became `diffOnlyEscapes`, returning `{added, removed}`, and still consults neither allowlist
so the failure modes stay distinguishable.

The backslash case needs care about *where* the disambiguation happens. Canonical has `\`
`t`; TipTap has `\` `\` `t`. Both sides sit on a backslash, so a naive equality-first walk
consumes the pair and then reports the removed escape as sitting before `t`, not before `\`
— which would not match §0.1's pin of exactly `\`. Checking for removal *before* equality
breaks the case where both sides legitimately have `\\`. So the check lives inside the
equality branch: if both are backslashes but TipTap doubled where canonical did not, that is
a removed escape before `\`, and only TipTap's index advances.

Four failure modes, all verified to fire:

| Mutation | Message that fired | Fails |
|---|---|---|
| `PERMITTED_REMOVED_ESCAPES` → `{}` | `NEW REMOVED-ESCAPE DIVERGENCE: canonicalize removed an escape before "\\" in case "canonical block 8: More escape traps: a literal backslash…"` | 3 |
| `PERMITTED_REMOVED_ESCAPES` `+= '#'` | `FIXTURE REGRESSION (PERMITTED_REMOVED_ESCAPES): permits ["#"] but no case in the fixture produces that escape difference any more` | 2 |
| `PERMITTED_ADDED_ESCAPES` `-= '&'` | `NEW ADDED-ESCAPE DIVERGENCE: canonicalize added an escape before "&" in case "canonical block 1…"` and block 8 | 4 |
| `PERMITTED_ADDED_ESCAPES` `+= '#'` | `FIXTURE REGRESSION (PERMITTED_ADDED_ESCAPES): permits ["#"]…` | 2 |
| `bullet: '-'` → `'*'` | `STRUCTURAL DIVERGENCE` in blocks 5, 10, 12, 14, 15 and the whole fixture | 11 |

Fail counts include the group parent and the pre-existing C2 failure below.

C1 is resolved: canonical block 8, the literal-backslash block, now passes.

## 3. The remaining failure — C2, and why I did not make it green

### C2. §0.1's tight-list rule and §0.1's fixed-point requirement are mutually unsatisfiable for a fixture containing a multi-paragraph list item — which §0.1 also requires.

    canonical      …same list item.\n- Item two is an ordinary single-paragraph item.\n
    tiptap output  …same list item.\n\n- Item two is an ordinary single-paragraph item.\n
    canonicalize   …same list item.\n- Item two is an ordinary single-paragraph item.\n

A list item holding two paragraphs makes tiptap-markdown serialize the whole list **loose**
— a blank line between items. §0.1's tight-list rule then removes that blank line. The
difference is neither an added nor a removed backslash escape, so it fails as
`STRUCTURAL DIVERGENCE` in the `whole canonical fixture` case:

    AssertionError [ERR_ASSERTION]: STRUCTURAL DIVERGENCE in case "whole canonical
    fixture": TipTap output and its canonicalization differ by something other than an
    escape difference. A marker, list indent, or blank-line change …
      tiptap:    "s second paragraph belongs to the same list item.\n\n- Item two is an…"
      canonical: "s second paragraph belongs to the same list item.\n- Item two is an…"

Three §0.1 requirements are in play and any two of them can hold, not all three: every list
is tight; the fixture contains a list item holding two paragraphs; the fixed point holds up
to escape differences only.

**Round-trip identity holds for this construct** — verified in isolation and in the fixture,
16/16 cases green. canonicalize tightens on the way back in, so the store is unaffected.
Same posture as C1: the canary is firing on serializer dialect, not on a threat to the draft.

Options, all §0.1 edits and therefore yours:

- **Extend the tolerance to blank-line differences between list items**, pinned to exactly
  that — the direct analogue of the C1 fix. Keeps the tight-list rule, the fixture, and the
  canary. My recommendation.
- **Scope the tight-list rule to exclude lists containing a multi-paragraph item**, so
  canonicalize stops disagreeing with TipTap there. Cheaper to state, but it reintroduces
  the mixed-tightness store the rule exists to prevent.
- **Drop the multi-paragraph item from the fixture.** Loses a construct §0.1 explicitly
  requires be asserted, and it round-trips fine, so this would hide a working case to keep
  a canary quiet.

`canonicalize`, `STRINGIFY_OPTIONS`, and both allowlists are untouched.

I did not make the suite green because the only way to do that is a §0.1 change, and
Operating rules say to report the collision before the code exists. That instruction and
"suite green before you stop" conflict here; I took the §0 rule as the stronger one.

## 4. Findings

**F14. The per-block case splitter silently under-tests any construct containing a blank
line.** Cases are generated by `split(/\n{2,}/)`, which tears the multi-paragraph list into
three fragments — block 14 is the first item alone, block 15 is the second paragraph plus
item two. So the intact construct is exercised only by the whole-fixture case, which is why
C2 shows up there and in no block. Round-trip identity uses the same splitter and has the
same blind spot. Not fixed; it wants a case generator that splits on top-level mdast nodes
rather than on blank lines.

**F15. A failure in one escape direction can trigger the other direction's fixture-regression
message.** With `&` unpermitted, block 8's added-escape assertion throws before the loop
records its removed escapes; block 8 is the only case that exercises the backslash removal,
so `FIXTURE REGRESSION (PERMITTED_REMOVED_ESCAPES)` also fires. Message noise under
cascading failure, not a defect in either check — but it can misdirect debugging.

## 5. Not verified

- The C2 resolution — nothing changed, nothing tested.
- HTML clipboard fixture, now §9 step 6. Still not started.
- Everything else listed in chunk-02a §7 remains as stated.
