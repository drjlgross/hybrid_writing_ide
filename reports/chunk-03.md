# Chunk 3 — storage layer

Status: green. **109 tests, 109 pass, 0 fail** (15 new). §9 step 3 complete.

## 1. What was built

### `src/storage.js`

- `sanitizeSlug(raw)` — lowercase, alphanumeric and hyphens, repeats collapsed. A slug
  that sanitizes to nothing is **refused**, not silently replaced with a generated one:
  the human named the document, and filing it under a timestamp instead would be worse
  than saying no. Non-ASCII is dropped rather than transliterated (`café résumé` →
  `caf-r-sum`), which is ugly but honest — see F17.
- `timestampSlug(now)` — `doc-YYYYMMDDHHMMSSmmm`. Milliseconds included because a
  collision is refused rather than resolved, so two documents created in the same second
  would otherwise be an error the human has to work around.
- `createDocument({slug, dir, now})` — refuses an existing slug with `SlugCollisionError`,
  never overwrites. Takes **no initial draft** — see F16.
- `saveDocument(doc, {dir, hooks})` — canonicalizes, asserts §0.3, writes atomically.
  Refuses a `schema_version` it does not write.
- `loadDocument(slug, {dir})` — verifies `schema_version` and asserts §0.3 **on the way
  in**, so a file that was hand-edited or corrupted into an inconsistent state fails at
  load rather than silently becoming the working draft.
- `assertLedgerInvariant(doc)` — §0.3, throwing `LedgerInvariantError`.
- `documentPath`, `tempPath`, `documentExists`, `SCHEMA_VERSION = 1`.

Document shape: `{schema_version, slug, created_at, draft, history: []}`.

**Atomic write.** `open` the temp path, write, `fsync`, `close`, then `rename`. The fsync
matters: rename is atomic with respect to data already on disk, so without it the rename
could land while the contents are still in the page cache. The `hooks.beforeRename` seam
exists only so a test can simulate a crash at exactly that point.

**Canonicalize runs here**, on the write path into the snapshot store — one of the exactly
two places §0.1 permits. It runs *before* the invariant check, because checking first
would compare a canonical snapshot against a draft that is about to become canonical and
fail spuriously.

### `test/storage.test.js`, `.gitignore`

15 tests. Every one writes to a fresh `mkdtemp` directory under `.tmp-test/`, added to
`.gitignore`. Artifacts stay out of `documents/` so a test run cannot disturb real drafts.
`.tmp-test/` is inside the project root rather than the OS temp directory because the
sandbox rule forbids writing above the root; flagged as a deviation from "a temp dir" in
case you meant `os.tmpdir()`.

## 2. The two tests you asked for by name

**A crash between write and rename leaves the previous file intact.** Commit `first
version`, then attempt to save `second version` with a hook that throws between the fsync
and the rename. Asserted: the real file's *bytes* are unchanged, it reloads as `first
version` with its one turn, the abandoned temp file exists and contains the complete
`second version` (so the crash lost nothing that was already durable), and a later good
write succeeds over the stale temp file and leaves none behind.

**The §0.3 invariant throws when violated deliberately.** Four constructed violations:
last turn's snapshot disagrees with the draft; a draft with an empty history; a draft
matching an *earlier* turn but not the last one; and malformed documents (`null`, history
that is not an array, draft that is not a string), which fail as `LedgerInvariantError`
rather than as incidental `TypeError`s. Also asserted at the boundaries: `saveDocument`
refuses to write a violating document *and leaves the previous file and no temp file
behind*, and `loadDocument` refuses to return a tampered file.

## 3. Mutations

| Mutation | Result |
|---|---|
| atomic write → direct `writeFileSync` (no temp, no rename) | 3 fail — no-temp-file, crash-safety, and the rejected-write test |
| invariant compares `history[0]` instead of the last turn | 2 fail |
| collision check removed | 1 fail — collision test |
| `schema_version` omitted on create | 8 fail |
| canonicalize dropped from the write path | 1 fail |
| `[^a-z0-9]+` → `[^a-z0-9]` (stops collapsing runs) | 3 fail — `spaces---everywhere` |

## 4. Findings

**F16. The invariant caught a flaw in my own API before any test did.** `createDocument`
originally accepted an initial `draft`, and creating a document with one violated §0.3
immediately: text existed that no turn accounted for. I removed the parameter rather than
relaxing the invariant. A new document is now always empty, and initial text has to arrive
as a turn like any other edit — which is chunk 4's job. There is a test pinning that the
seeding route stays closed.

**F17. §0.5 does not say what to do with a slug that sanitizes to nothing.** `!!!`, `---`,
and `日本語` all reduce to an empty string. Silently generating a timestamp slug would file
the document under a name the human did not choose and would not find again, so I refuse
with an error naming the input. Non-ASCII slugs are the sharp edge: a user typing a
Japanese or Arabic title gets a refusal rather than a transliteration. Worth a §0.5 line
either way.

**F18. §0.3 does not define the empty-history case.** Read strictly,
`history[history.length - 1].snapshot === draft` compares `undefined` against the draft, so
a document with no turns could only ever hold an empty draft. I took that reading and made
it explicit with its own message. It is what makes F16 fail loudly instead of quietly.

**F19. A crashed write leaves its temp file behind, deliberately.** Nothing cleans up
`{slug}.json.tmp` after a failed rename, because that is what a real crash does and the
reader never looks at the temp path. Consequence: a repeatedly failing save leaves one
stale temp file per slug, and a stale temp file is indistinguishable from a crash that
happened one second ago. Harmless now; worth revisiting if a recovery flow ever wants to
offer "restore the uncommitted version".

**F15 fixed.** Union assertions in the fixed-point test are skipped when any case failed.
Verified: the `bullet: '*'` mutation now produces `STRUCTURAL DIVERGENCE` five times and
no `FIXTURE REGRESSION` company, where before it produced both.

**CLAUDE.md.** The `This test and round-trip identity are not redundant` paragraph now has
its two-space indent, so it reads as part of the fixed-point bullet.

## 5. What was NOT verified

- **Concurrency.** Two writers to one slug are not defended against. `existsSync` then
  write is a TOCTOU race, and nothing takes a lock. Single local user (§5), so this is a
  non-goal — but it is a real property the tests do not cover, not one they establish.
- **Real crash behavior.** The crash is simulated by throwing at the seam. Actual
  `SIGKILL` mid-write, a full disk, and a read-only directory are untested. `fsync` on the
  containing directory — which is what durably persists the rename itself, not just the
  data — is not done.
- **Large documents.** No test writes anything close to a real session's worth of
  snapshots, so nothing is known about size or write latency at a few hundred turns (§0.4).
- **The turn model.** `history` is written and read but nothing constructs turns, assigns
  `turn_id`, or enforces turn boundaries. Chunk 4, along with `scripts/smoke-session.js`.
- Everything previously listed in chunk-02a §7 still stands, including the HTML clipboard
  fixture (§9 step 6).
