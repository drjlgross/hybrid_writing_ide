# Pre-commit secret scanning — mechanism and standing rule

Mini-task, not a chunk. Nothing mechanical stopped a real API key from being
committed; catching one depended on somebody remembering to look. This closes
that.

**Status: complete, plus two audit fixes.** 352 tests pass (was 335; +17). Both
verification directions exercised, one of them against the real repository's git.
`node scripts/smoke-session.js` green at 38 assertions. `npx vite build` clean.

**Audited after the first pass; two findings, both real, both fixed — §5 below.**
The scanner failed OPEN when git could not run, and unreadable files were
silently indistinguishable from clean ones. Neither was caught by the original
eleven tests, because every one of them ran in a working repository against
readable files.

The exposure that prompted this was chat-side, not repo-side, and that holds:
`git log -S sk-ant-api03 --oneline --all` is empty, and the three `sk-ant` hits in
the tree are `sk-ant-...` placeholders in `README.md` (×2) and `live-check.js`'s
help text.

---

## 1. What the pattern matches

Two rules, in `scripts/secret-scan.js`. Each is named so a finding can say which
one fired.

| rule | matches |
|---|---|
| `anthropic-api-key` | `sk-ant-` + an optional variant tag + `-` + **≥ 40** characters of `[A-Za-z0-9_-]` |
| `anthropic-key-assignment` | `ANTHROPIC_API_KEY` `=` or `:` + **≥ 40** characters of the same charset |

The variant tag is optional and generic (`[A-Za-z0-9]{1,12}`) rather than an
enumeration of `api03`, so a key format introduced next year is still caught. The
second rule exists for a key pasted without its prefix — a rotated format, or a
value copied out of a vault.

### What it deliberately does not match, and why it is structural

**The discrimination is by charset first, length second.** The placeholders in the
tree are `sk-ant-...` — literal dots, which are **not** in the key charset, so
they cannot match at any length.

That matters more than it sounds: it means the placeholders pass because of what
they *are*, not because they are on a list. **There is no allowlist**, on purpose.
An allowlist is a place for a real finding to hide, and it would need extending
every time someone writes a new placeholder. These all pass for the same
structural reason:

```
ANTHROPIC_API_KEY=sk-ant-...            ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
ANTHROPIC_API_KEY=sk-ant-<your key>     ANTHROPIC_API_KEY=${SECRET}
ANTHROPIC_API_KEY=sk-ant-YOUR-KEY       the key is sk-ant-api03-… (redacted)
```

**`MIN_KEY_CHARS = 40`** is a floor well above every placeholder and well below a
real key (~95 characters of material). A shorter fragment is not a usable
credential — the 18-character prefix that reached a transcript earlier in this
session cannot be authenticated with — so the floor buys precision without giving
up anything that matters. Flagging unusable fragments would train people to
ignore findings, which is how a scanner stops working without failing.

Long non-secret identifiers do not trip it: a 40-char commit SHA is hex and short
of the floor once the `sk-ant-` anchor is required; a long URL path contains `/`
and `.`. Both are asserted.

### What it deliberately does not cover

Anthropic key shapes only. No AWS, GitHub, or generic high-entropy detection —
those bring false positives, and a scanner people learn to override is worse than
none. Named as a limit rather than left as an assumption.

---

## 2. Redaction: the scanner must not become the leak

**Zero characters of a match reach the output.** Not the whole string, not a
prefix. The excerpt is built by *splitting* the line on the secret and joining
with a description of its shape, so there is no index arithmetic that could run
one character wide:

```
export const KEY = '‹REDACTED 107-char secret›';
```

The length is reported because it distinguishes a real key from a long random
identifier, and a length is not itself secret.

This is a direct response to my own error earlier in this session: I printed the
first 18 characters of the live key into the transcript while believing 11-char
truncation counted as redaction. A test asserts the report contains neither the
key, nor any run of its material, nor a prefix.

---

## 3. What it reads — and what it must never read

Staged content (`git diff --cached -U0`, added lines only) and tracked files
(`git ls-files`). **Nothing else, and that boundary is the mechanism.**

**The scanner never reads `.env`.** A scanner that opens the secret file to look
for secrets has become one more process holding the key. `.env` is gitignored, so
it is neither tracked nor stageable — scanning only those two sets is what
*guarantees* the scanner cannot reach it, rather than relying on it to decline.

The test asserts this three ways: `.env` is absent from `git ls-files`, `git
check-ignore` confirms it cannot be staged, and the module's executable source
(comments stripped) contains no `.env` at all.

Binary files are skipped by a NUL check on the first block — `reports/` tracks
PNGs, and regex-scanning a decoded PNG is waste at best and a spurious finding at
worst.

### On the git calls

`ls-files` and `diff --cached` only report. That is the same read-only class as
`spend-guard`'s HEAD read, not the ratifying act the operating rule governs — and
the amended rule now says so explicitly by naming commits and pushes rather than
git as a whole.

---

## 4. Verification, both directions

A scanner only ever observed passing is a stub. That is F60 and F70 applied to the
scanner itself, so both directions are exercised and both are in the suite.

### Direction A — the real tree passes; placeholders do not trip it

```
$ node scripts/secret-scan.js
secret-scan: clean — 0 staged files, 82 tracked files scanned, 4 binary skipped,
no key material found.
EXIT: 0
```

And with real content staged, to exercise the staged-diff path against the actual
repository's git rather than only a fixture:

```
$ git add -A && node scripts/secret-scan.js
secret-scan: clean — 4 staged files, 84 tracked files, no key material found.
EXIT: 0
$ git reset -q
staging restored exactly? YES — git status byte-identical
```

### Direction B — a staged synthetic key fails, with a redacted report

Realistic shape, entirely fake material (107 chars vs the real 108), built at
runtime. Run in a throwaway git repo under `.tmp-test/`; **the real staging area
is never touched.**

```
────────────────────────────────────────────────────────────────────────────
SECRET SCAN FAILED — 1 finding. Do not commit.

  config.js:1  (anthropic-api-key, staged)
    an Anthropic API key
    export const KEY = '‹REDACTED 107-char secret›';

  The matched text is redacted above and is not printed anywhere by this
  scanner. If this is a real credential: rotate it first, then remove it —
  a key that reached a working tree should be treated as already exposed.

  If this is a placeholder the pattern misjudged, that is a scanner bug and
  the pattern is the thing to fix, not the finding to suppress.
────────────────────────────────────────────────────────────────────────────

EXIT: 1
```

The `README.md` beside it, carrying `ANTHROPIC_API_KEY=sk-ant-...`, did **not**
trip — the same run proves both directions at once.

### One finding, not two

The first version reported the same secret twice, once from each scan. Findings
are deduplicated on **`file:line`** — not `file:line:rule`, which was the second
version and still double-counted: `ANTHROPIC_API_KEY=sk-ant-…` matches *both*
patterns, so one secret produced two findings from a single line. The **staged**
origin wins, because it is the actionable one: it names something not yet
committed that can still be stopped. A scanner whose count cannot be trusted has
given away the last property it needs.

### The 17 tests

`test/secret-scan.test.js`. Grouped: what the pattern catches (3), what it
deliberately does not (3), redaction (1), the two git-level directions (2), the
CLI's exit behaviour (1), the `.env` boundary (1), binary handling (2), failing
closed (2), unreadable and awkwardly-named files (2), and dedup across patterns
(1).

Two rules govern the file, both stated in its header:

- **No test touches the real staging area.** Every git-level test builds a
  throwaway repo under `.tmp-test/`. `git status` is identical before and after
  the suite — verified.
- **No synthetic key appears as a literal.** Every one is assembled at runtime
  from fragments. A key-shaped string written out in a tracked file is exactly
  what the scanner rejects; the suite would fail on itself and the tempting fix
  would be to weaken the pattern.

---

## 5. Audit fixes

### 5.1 Failing closed when the scan cannot run

`scanStaged` and `scanTracked` computed `available: false` when git failed, and
**nothing read it**. `formatReport` saw zero findings, printed `clean`, and the
CLI exited 0. Reproduced before fixing, in a directory whose `.git` points at
nothing:

```
staged.available : false
tracked.available: false
report           : secret-scan: clean — 0 staged files, 0 tracked files, …
CLI would exit   : 0   <-- FAIL-OPEN
```

A scan that did not run and a scan that found nothing produce the same empty
result, so treating the first as a pass reports success at exactly the moment the
scanner knows least. This is the project convention already set by spend-guard's
unreadable ledger: **unknown is not zero, and unknown means stop.**

`scanRepository` now returns `ok` and `blockers`, and `ok` is the only thing a
caller branches on — false when a scan *found* something and equally when a scan
*could not run*. Both the CLI and the smoke step use it. The two cases print
differently on purpose: "Do not commit" is right for both, but the reader's next
move is not — one is a credential to rotate, the other is a scanner to repair.

```
────────────────────────────────────────────────────────────────────────────
SECRET SCAN COULD NOT RUN — this is NOT a pass. Do not commit.

  the staged diff could not be read (is this a git repository?)
  the tracked file list could not be read (is this a git repository?)

  A scan that did not run and a scan that found nothing produce the same
  empty result. Treating the first as clean would report success at exactly
  the moment the scanner knows least, so it fails instead.
────────────────────────────────────────────────────────────────────────────
EXIT: 1
```

The fixture is a `.git` **file** pointing at a nonexistent path, not an empty
directory — an empty directory inside this repo would let git's discovery walk up
and find the real repository, and the test would silently verify the wrong thing.

**One interface addition was needed to test this.** The CLI deliberately scans the
repo it lives in rather than the process's working directory, so it cannot be made
to fail by changing directory — the only way to reach the failure path would have
been to break this repository. `--root <dir>` points it at a fixture. The audit
asked for the *failure exit* to be asserted, and the exit code is the contract
CLAUDE.md tells the reader to trust, so testing it through the real entry point
rather than the exported function was worth a flag.

### 5.2 Unreadable files counted, and path resolution fixed

`scanTracked` built paths with `new URL(file, new URL(cwd, 'file://'))` and
swallowed every failure in `catch { continue; }`. Two problems, compounding:

- A URL treats `#` as a fragment and `%` as an escape, and drops the last path
  segment when the base has no trailing slash. A tracked file named `notes #2.js`
  or `100%.js` resolved to the wrong path, or to none.
- The silent `continue` then made that **indistinguishable from "scanned, clean"**.

Together those are a hiding place: a key in `100%.js` would have been reported as
a clean scan. Paths are now resolved with `path.join`, and failures are collected
rather than skipped:

```
  locked.js could not be opened (EACCES), so it was not scanned
```

Any unreadable file fails the scan. The test asserts the security-relevant half
directly — a synthetic key **in a percent-named file** is found, where before it
would have been silently missed.

**Binary skips are counted separately and are NOT failures.** The repo tracks
PNGs and always will; skipping them is a policy decision, not an inability. The
count is reported so "82 files scanned" never quietly means "some of them":

```
secret-scan: clean — 0 staged files, 82 tracked files scanned, 4 binary skipped,
no key material found.
```

### 5.3 Why the original tests missed both

Every one of the first eleven ran in a working repository against readable files.
Neither failure mode was reachable from inside that assumption — the same shape as
F60 (a stub accepting a request the API rejects) and F70 (a metric that reports a
working system as broken). The new tests construct the conditions the code claimed
to handle: a repo where git genuinely cannot run, and files that genuinely cannot
be opened.

---

## 6. Wired into the smoke session

`scripts/smoke-session.js` gains step (0), before the provenance work:

```
smoke-session — provenance model, driven directly against the store
document: documents/00000000000000000000000000000000/smoke.json

(0) scan staged and tracked content for key material (CLAUDE.md § Operating rules)
      ok — no key material in 82 tracked and 0 staged files, 4 binary skipped

(a) create a document with slug "smoke"
```

First, because it is the check whose cost of being skipped is unbounded:
everything below it verifies that the provenance model still holds, and a
committed credential is not something a later check can undo. It branches on
`ok`, so it exits 1 both on a finding and on a scan that could not run — with
different wording for each, since "nothing is verified" and "a key is present"
send the reader to different places.

It runs here as well as at commit time so it is exercised on every
session-opening run — the difference between a scanner that works and one nobody
has run since the day it was written.

---

## 7. The CLAUDE.md diff

One line replaced, in the Operating rules. Nothing else in the file changed:

```diff
-Never run git. Commits are a human ratification step.
+Git commits and pushes happen only on the human's explicit instruction, never of
+the assistant's own accord — ratification is the human's act even when the
+assistant types the command. Before any commit: run `node scripts/secret-scan.js`
+and proceed only on exit 0. A hit means stop, show the finding, and wait;
+committing over a failed scan is never correct.
```

---

## 8. Named findings

**F71 — `spend-guard.js` now carries a stale cross-reference.** Its docblock says
"CLAUDE.md's operating rules say never to run git", which was the old wording.
The rule it was appealing to still holds in substance — reading HEAD off the
filesystem is not a commit — but the sentence it cites no longer exists. Not
fixed: the boundary for this task was explicitly "no changes to spend-guard".
One-line fix whenever spend-guard is next touched.

**F74 — the audit found what the tests could not.** Both fixes in §5 were live in
the tree with eleven green tests over them. The tests were not weak individually;
they all shared one assumption — a working repository, readable files — and
neither failure mode exists inside it. Recorded because it is the fourth instance
this session of a check that could only pass, and because the fix is the same
every time: construct the condition the code claims to handle, rather than the
condition it was written in.

**F72 — the scan is a rule, not a hook.** Nothing forces it to run before a
commit; the standing rule is the control. A git `pre-commit` hook would enforce
it mechanically, but `.git/hooks/` is untracked (so it would not survive a clone)
and `core.hooksPath` needs a `git config` write. Same reasoning as the spend
guard's HEAD-anchored window, and the same honest limit: the code makes the rule
hard to forget, not impossible to break. Say if you want the hook as well.

**F73 — history is not scanned.** `scanStaged` reads added lines only, and
`scanTracked` reads the working tree. A secret already in a past commit would not
be found. That is deliberate — this scanner's job is to stop an introduction, and
a secret in history needs rotation and a rewrite, not a warning — but it means a
clean scan says nothing about the repository's past. The `git log -S` check at
the top of this report is what covered that question, once, by hand.

---

## 9. What I did NOT verify

**A real key against the scanner.** The synthetic fixture matches the real shape
and length, but I did not test the scanner against the actual key in `.env` — by
design, since that would mean reading it, which is the one thing the scanner must
never do.

**Any non-Anthropic secret.** Out of scope by choice; see §1.

**Performance on a large repository.** 84 files scan instantly; a repo with
thousands of tracked files reading every one on every smoke run may want the
tracked scan gated behind a flag.

**A multi-line secret.** Scanning is line-by-line, so a key split across lines by
a formatter would not be caught. Unlikely for an env-style value, but it is a
real gap rather than an impossible one.

**A file that becomes unreadable mid-scan**, or a `git ls-files` that succeeds
while `git diff --cached` fails. Both are handled by the same `available` /
`unreadable` machinery and neither is exercised: the tests break git for both
calls at once.

**`--root` pointed at a path that exists but is not a repository**, as distinct
from the broken-`.git` fixture. Same code path, untested separately.

---

## 10. Stopping here

Mini-task complete; not a chunk, so nothing in the Build order moved. Step 12
(context files and human-written standing rules) is still next and untouched.
