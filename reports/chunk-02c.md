# Chunk 2c — tolerance rule, blank-line tolerance, F14

Status: **green. 94 tests, 94 pass, 0 fail.** The splitter surfaced no new collisions, so
the pre-authorization was not used.

## 1. CLAUDE.md

Both paragraphs added verbatim to §0.1's fixed-point bullet, immediately after the
removal-case paragraph. Nothing else touched.

## 2. Blank-line tolerance

`PERMITTED_EXTRA_BLANK_LINES = new Set(['between list items'])`, structured like the two
escape sets: classified by the walk without consulting any allowlist, containment asserted
per case with its own message, equality asserted over the union of all cases.

Both conditions of the §0.1 rule are met:

- **Round-trip identity holds for the construct.** The intact multi-paragraph list is now
  its own case (node 14) and passes, along with all 15 round-trip cases. The store is
  unaffected: canonicalize tightens on the way back in.
- **Pinned to an exact named set, asserted bidirectionally.** Verified by mutation below.

The classifier is narrow on purpose. It tolerates an extra newline only where TipTap has a
newline canonical does not, the next character matches on both sides, and canonical is
sitting at the start of a list-item line (`/^ *- /`, preceded by a newline). An extra blank
line anywhere else is still structural.

`canonicalize`, `STRINGIFY_OPTIONS`, and the tight-list rule are untouched.

## 3. F14 — case generation by mdast node

`test/helpers/cases.js` — `canonicalCases(canonical)` parses the canonical document, slices
each top-level node by its position offsets, and canonicalizes each slice. Used by both the
fixed-point test and round-trip identity.

Case counts, before → after:

| Test | Blank-line split | mdast-node split |
|---|---:|---:|
| round-trip identity | 16 | **15** |
| fixed point | 16 | **15** |

Fewer cases, more coverage. The old splitter produced 15 blocks from 14 nodes because it
tore the multi-paragraph list into three fragments — first item alone, then second
paragraph plus item two — so the intact construct was never a case. Now node 14 is the whole
list, which is exactly where the blank-line divergence shows up. Node types in the fixture:
9 paragraphs, 4 lists, plus the whole-document case.

Total suite went 96 → 94 tests for the same reason.

## 4. Mutations

The §0.1 rule requires re-verifying that the test still catches marker and list-indent drift
after a tolerance is added. Both still fail:

| Mutation | Message | Fails |
|---|---|---:|
| `bullet: '-'` → `'*'` | `STRUCTURAL DIVERGENCE in case "node 10 (list): * Loose item one…"` | 10 |
| `listItemIndent: 'one'` → `'tab'` | `STRUCTURAL DIVERGENCE in case "node 10 (list): -   Loose item one…"` | 10 |
| `PERMITTED_EXTRA_BLANK_LINES` → `{}` | `NEW BLANK-LINE DIVERGENCE: canonicalize removed a blank line between list items in case "node 14 (list)…"` and the whole fixture | 3 |
| `PERMITTED_EXTRA_BLANK_LINES` += `'between paragraphs'` | `FIXTURE REGRESSION (PERMITTED_EXTRA_BLANK_LINES): permits ["between paragraphs"] but no case in the fixture produces that difference any more` | 1 |
| trailing newline dropped from `serializeEditorMarkdown` | `STRUCTURAL DIVERGENCE in case "node 1 (paragraph)…"` | 17 |

The last one is the narrowness check: a blank-line difference that is *not* between list
items still fails structurally, so the new tolerance did not widen into a general
whitespace amnesty.

One dud on the way there — my first narrowness mutation removed a `.replace(/\n+$/, '')`
that is a no-op, because tiptap-markdown returns no trailing newline for the trim to strip.
0 fails, which proved nothing. Re-run against the line that actually adds the newline.

## 5. Findings

**F15 confirmed again, and now visible in the marker mutations.** Both drift mutations also
fire `FIXTURE REGRESSION (PERMITTED_EXTRA_BLANK_LINES)`: node 14's subtest fails structurally
before it records its blank line, and node 14 is the only case that exercises that
tolerance, so the union assertion reports it as unexercised. Cascade noise, not a second
defect — but with three tolerance sets it is now three ways for one failure to produce
misleading company. Worth deciding whether the union assertions should be skipped when any
case failed.

## 6. Not verified

- Deeper nesting, and a list nested inside a multi-paragraph item.
- HTML clipboard fixture, §9 step 6. Not started.
- Everything else listed in chunk-02a §7 stands.

§9 step 2 is complete: round-trip identity, the amended fixture, and the constructs it
named. Ready for chunk 3, the storage layer, on your word.
