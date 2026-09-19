# mini-users-report-turns — per-namespace turn counts in the operator report

Out-of-band work, not a step in the Build order. Nothing in the Build order moved
and this report carries no number, per the Report naming rule.

**Why.** `claims.jsonl` and `usage.jsonl` measure model spend and nothing else. A
person can write all evening, checkpoint a dozen times, and never call the model —
§3's human turns cost nothing and leave no row in the usage ledger — so a report
built on calls alone prints them as `0 calls, $0.0000, —` and reads them as
someone who signed up and left. That is the wrong conclusion about the most
engaged kind of user the tool has, and it is the conclusion the report currently
invites. The last real run showed four of five sign-ups as zeros with no way to
tell which had written anything.

---

## What changed, file by file

### `scripts/users-report.js`

**A third source.** The header note now names it: the two `.jsonl` files, plus the
namespace directories themselves. The script's own description of its job changed
with it, since "joins two append-only files" stopped being the whole truth.

**`tallyTurns({ root })`** — walks the documents root once and returns a
`Map` from token prefix to `{human, ai, documents, unreadable}`.

*Keyed by prefix*, because that is what both tables already have to look up with:
the usage ledger holds only a prefix by design (`src/usage-ledger.js`), so the
unaccounted table has nothing longer, and `joinClaimsAndUsage` keys on it too. Two
tokens sharing a prefix would aggregate into one row — the same limitation the
existing join already carries, not a new one.

*Existing helpers, no hand-rolled walking:*

| need | helper | already exported? |
| --- | --- | --- |
| token → directory | `resolveNamespace` (`src/namespace.js`) | yes |
| is this a namespace? | `isValidToken` (`src/namespace.js`) | yes |
| documents in a namespace | `listDocuments` (`src/storage.js`) | yes |
| read one document | `loadDocument` (`src/storage.js`) | yes |
| author values | `HUMAN`, `AI` (`src/turns.js`) | yes |

**`src/storage.js` was not touched.** The fence allowed exporting an existing
reader if one was needed; none was. Both readers this needs were already exported,
and the only path-building goes through `resolveNamespace`, so §0.5's rule that one
function turns an identity into a place on disk is intact — a report is not a
reason to make a second one. `src/turns.js` was likewise only *imported from*, never
modified: the author strings are its constants rather than two string literals here
that could drift from it.

*Tolerance at every layer, because an operator report that dies on one bad file
tells you nothing about the other forty:*

- a documents root that does not exist → empty tally, no throw
- anything under it that is not a namespace → skipped by `isValidToken`, the same
  predicate the server uses to accept a token. That is what makes `lost+found`,
  `claims.jsonl`, `usage.jsonl`, `smoke.json` and a half-made directory all fall
  out **without a blocklist naming any of them** — the next stray thing on the
  volume is handled by a rule already written rather than by an edit here.
- a document that will not read → counted `unreadable`, skipped, and **reported in
  a footer line**. Said out loud deliberately: a turn count quietly missing a
  document reads as a quiet person, which is the single wrong conclusion these
  columns exist to prevent.

`loadDocument` is the reader rather than a bare `JSON.parse`, so this report agrees
with the app about what a readable document is. The consequence, named because it
is a real trade: `loadDocument` verifies `schema_version` and asserts the §0.3
invariant, so a document that is corrupt *or merely out of invariant* counts as
unreadable rather than half-tallied. That is the conservative direction for a
number someone reads as engagement, and the footer says how many fell out.

**Two columns, `human` and `ai`, on both tables and the CSV.** Raw counts, no
subtraction of the seed turn — the reader knows the floor is 1, and a "turns minus
one" column is a number that silently disagrees with the history view.

- **CSV: appended, not inserted.** `…,calls,usd,last_call,human,ai`. Every column an
  existing consumer already reads keeps its position.
- **Emitted raw and unquoted**, like `calls` and `usd`, so they stay summable. They
  are machine-generated integers that never touch the public form, so there is
  nothing to arm — and passing them through `field()` would turn them into text,
  which is the failure the "ordinary values are not mangled" test exists to catch.
- **Human tables**: `last call` is now `padEnd(16)` so the two fixed-width numeric
  columns after it line up. Both tables use the same suffix, built from the same
  widths, so they cannot drift apart.

**One incidental fix.** The footer notices are now collected and printed with one
leading blank line. Previously the blank line was attached to the *registry* notice
alone, so a usage-ledger notice firing by itself butted against the table. Pre-
existing, cosmetic, and fixed because the new third notice would have inherited it.

### `test/users-report.test.js`

`writeDoc(root, token, slug, authors)` builds a real document on disk. By hand
rather than through `commitHumanTurn`: the point is a file in a known shape, and
going through the turn machinery would make these tests of that machinery.

---

## Existing assertions deliberately updated

Two, both in the CSV tests, both pinning an exact shape that changed.

**1. The header.** `/^date,name,email,prefix,link,calls,usd,last_call$/` →
`/^date,name,email,prefix,link,calls,usd,last_call,human,ai$/`.

This assertion is the contract with whatever the operator has pointed at the CSV,
so it is pinned exactly rather than loosely — a silent column change is what breaks
such a consumer. Updating it is the whole cost of adding a column, and paying it
visibly here is the point of pinning it in the first place.

**2. The row shape.** The destructure in *"ordinary values are not mangled"* went
from 8 fields to 10. The test's root has no namespace directories at all, so the
two new fields are the zero case — which is the state **every pre-existing test in
this file runs in**, and the reason none of the other five needed touching.

Both edits carry an `UPDATED` comment at the assertion saying what changed and why.
No other existing assertion was modified, and none was weakened.

**The formula-injection sweep is unchanged and still passes over the new columns.**
It iterates every quoted cell in every row; the new fields are unquoted integers, so
they are outside the sweep by the same rule that puts `calls` and `usd` outside it.
The sweep's stated purpose — "so a future column carrying claim data cannot slip
through unarmed" — is intact: these columns carry no claim data, and a future one
that does would be quoted and swept.

---

## Verification

`npm test`: **492 tests, 492 passed, 0 failed, exit 0** (487 before; five new).
`node scripts/smoke-session.js`: **exit 0**, 6 turns, 38 assertions.

`test/users-report.test.js` — **10 passed, 0 failed** (5 before):

| test | new? |
| --- | --- |
| the recovery link names the document a claimed namespace actually has | |
| a hostile name from the public form cannot become a spreadsheet formula | |
| a hostile email is armed too, and the header row is untouched | *updated* |
| ordinary values are not mangled: numbers stay numbers, dates stay dates | *updated* |
| turns are tallied by author and aggregated across a namespace's documents | **new** |
| a malformed document is skipped, counted, and never crashes the run | **new** |
| a directory that is not a namespace is skipped, not enumerated by name | **new** |
| the hand-minted table carries the turn columns too | **new** |
| a claimed namespace with no documents on disk reads as zeros | **new** |
| an empty registry still exits 0 and says so | |

The three fixtures the task named are covered by the first two new tests: (a) a doc
with mixed human/ai history, (b) a second doc so counts aggregate — asserted as
`5`/`3` over `3+2` and `2+1` — and (c) a malformed `.json` skipped without failing
the run. The malformed case carries **two** shapes, not one: a truncated file that
will not parse, and a file that parses but declares `schema_version: 99`. They fail
in different places and only the second proves the tolerance covers `loadDocument`'s
checks as well as `JSON.parse`.

### Mutation checks

Five, all caught.

| # | mutation | result |
| --- | --- | --- |
| M1 | swap which column `human` and `ai` increment | **caught** — 3 failed |
| M2 | drop the `isValidToken` filter on directories | **caught** — 1 failed |
| M3 | swallow unreadable documents without counting them | **caught** — 1 failed |
| M4 | make `written()` always return zeros | **caught** — 4 failed |
| M5 | count only the first document in a namespace | **caught** — 2 failed |

M4 and M5 matter most: together they show the assertions discriminate real tallies
from a plausible-looking constant, which is the failure mode a `\s5\s+3\s*$` regex
is otherwise prone to.

### Observed output, against a fixture root

Two claimed namespaces (one that writes and spends, one that never opened its
link), one hand-minted namespace present in usage but not in the registry, one
truncated document, and a `lost+found`:

```
claims registry: <root>/claims.jsonl
usage ledger:    <root>/usage.jsonl

2 sign-ups

  date        name                  email                           prefix      calls       cost   last call          human      ai
  2026-09-08  Ada Lovelace          ada@example.com                 aaaaaaaa      1    $0.0312   2026-09-08T10:00       5       3
    https://wordwright.ink/t/aaaaaaaa000000000000000000000000/welcome-doc
  2026-09-08  Grace Hopper          grace@example.com               bbbbbbbb      0    $0.0000   —                      0       0
    https://wordwright.ink/t/bbbbbbbb111111111111111111111111/welcome-doc

HAND-MINTED OR UNKNOWN — namespaces in the usage ledger that no claim accounts for

  prefix      calls       cost   last call          human      ai
  cccccccc      1    $0.0088   2026-09-08T11:00       1       1

  1 document could not be read and is not counted in the turn columns.
```

Exit 0. `lost+found` is absent from the output, as is the `not-a-token` directory.
The CSV over the same root:

```
date,name,email,prefix,link,calls,usd,last_call,human,ai
"2026-09-08","Ada Lovelace","ada@example.com","aaaaaaaa","https://…/welcome-doc",1,0.031200,"2026-09-08T10:00:00.000Z",5,3
"2026-09-08","Grace Hopper","grace@example.com","bbbbbbbb","https://…/welcome-doc",0,0.000000,"",0,0
"2026-09-08","(hand-minted or unknown)","","cccccccc","",1,0.008800,"2026-09-08T11:00:00.000Z",1,1
```

An empty root is unchanged: `no registry yet — nobody has signed up through the
landing page.`, exit 0.

---

## Findings

- **F96 — a namespace with documents but no usage and no claim is still invisible.**
  Both tables are built from the registry and the usage ledger, so a hand-minted
  namespace that has been written in but has never called the model appears in
  neither, and its turn counts are computed and then never displayed. The smoke
  detector in §12b is spend-shaped, and this change makes writing visible only for
  namespaces some other source already lists. Fixing it means a third section —
  "on disk, in nobody's name, never called the model" — which is a decision about
  what the report is for, not a tidy-up. Named, not taken.
- **F97 — `mixed` turns will be in neither column.** §3 allows `author: "mixed"`
  for proposal turns, which arrive with staging (step 16). They are deliberately
  not folded into either column, so when step 16 lands, `human + ai` will stop
  equalling the document's turn count. The code carries a comment saying so at the
  branch. Whether step 16 adds a third column or redefines these two is that step's
  call.
- **A document whose internal `slug` disagrees with its filename counts as
  unreadable.** `listDocuments` returns the slug from *inside* the file, and
  `loadDocument` builds its path from that slug — so the two must agree or the read
  misses. They cannot diverge through the app (`saveDocument` writes to
  `documentPath(doc.slug, dir)`, so the filename is derived from the field), which
  makes this reachable only by a hand-edited file. It degrades to "unreadable" and
  shows in the footer count rather than to a wrong number, which is the right
  direction; recorded so the footer line is interpretable if it ever fires without
  an obviously corrupt file on disk.

- **A document counting as unreadable is stricter than "will not parse."**
  `loadDocument` also enforces `schema_version` and the §0.3 invariant, so a
  structurally valid document that is out of invariant contributes 0 and appears in
  the footer count. Deliberate, stated above, and visible rather than silent.
- **No shared-artifact changes.** The §5 fixtures were not read or written. No
  dependency was added. `package.json` is unchanged.
- **Nothing in the spec was wrong or underspecified.** §12b describes the report's
  columns loosely enough ("calls, cost and last call") that adding two did not
  contradict it; it also does not *require* them, so a later chunk that wants the
  spec to pin this shape should say so there.

## Not verified, named as such

- **Production.** Not run against the deployed volume; the session's permissions
  block production reads. The fixture root is shaped like one but is not one.
- **Scale.** The tally reads every document in every namespace on every run, and
  reads each file twice — once in `listDocuments`, once in `loadDocument`. Fine for
  the handful of namespaces that exist; not measured beyond that, and the same
  class of latent issue as F92's unrotated ledger.
- **A namespace directory that is unreadable as a directory** (permissions, not
  content). `listDocuments` returns `[]` for a path that does not exist, but a
  directory that exists and cannot be listed would throw out of `readdirSync`
  inside it. Not reproduced, not handled, not tested.

## Fence

Touched exactly: `scripts/users-report.js`, `test/users-report.test.js`, this
report. Not touched: `src/storage.js` (no new export was needed), `src/claims.js`,
`src/turns.js`, `CLAUDE.md`, the Build order, `package.json`, client code, any
other test. Not committed. No version bump.
