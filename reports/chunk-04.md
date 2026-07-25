# Chunk 4 — turn model, Checkpoint, smoke session

Status: green. **121 tests, 121 pass, 0 fail** (12 new). `scripts/smoke-session.js` runs
clean: 5 turns, 28 assertions. §9 step 4 complete.

Run it yourself:

    node scripts/smoke-session.js
    node scripts/smoke-session.js --dir .tmp-test/smoke-alt

## 1. What was built

### `src/turns.js`

Pure over documents — every function takes a document and returns a new one, never
mutating the input and never touching disk. Persistence stays the caller's job, so the
§0.3 invariant gets asserted twice on every commit: once here at the turn boundary, once
in `saveDocument` on the way to disk.

- `commitHumanTurn(doc, draftText, {now})` → `{doc, turn}`. Returns `turn: null` when the
  draft is unchanged, so no empty turn is created. Serves **both** §3 turn boundaries —
  (a) Checkpoint and (b) prompt submission — and `checkpoint` is an exported alias so the
  Checkpoint call site reads as itself.
- `commitAiTurn(doc, {draft, prompt, warnings, now})` → `{doc, turn}`. Refuses to exist
  without a prompt string, and stores it verbatim.
- `submitAiPrompt(doc, {pendingDraft, prompt, callModel, now})` → `{doc, humanTurn, aiTurn}`.
  The §2.4 sequence minus the API call itself.
- `restoreToTurn(doc, turnId, {now})` → appends a new human turn holding that turn's
  snapshot. Throws on an unknown turn id.
- `getTurn(doc, turnId)`, `HUMAN`, `AI`.

**§3 rule (b) is enforced structurally, not by convention.** `submitAiPrompt` takes the
model call as an injected function, so there is no way to reach the AI turn without the
pending human edits having been committed first — and `callModel` receives the document as
it stands at that moment, which is exactly what §2.1 needs to compute the hand-edit diff.
Chunk 5 passes the real API call where the smoke script passes a canned response. Had this
been two functions the endpoint calls in order, forgetting the first would silently absorb
the human's edits into the model's turn, which is the failure the app exists to prevent.

### `src/storage.js` — directory fsync

After the rename, the containing directory is opened and fsync'd. Flushing the file only
makes its *contents* durable; the rename is a change to the directory, so without this a
crash immediately after the rename can leave the entry unwritten — the data survives under
the temp name and the session looks like it lost its last commit. Verified the call works
on this platform rather than assuming it.

### `scripts/smoke-session.js`

Standalone, no HTTP, no browser, AI stubbed. Runs §9 step 4's sequence exactly: create
`smoke` → human turn with bold, a bullet and a link → stubbed AI turn with a known prompt →
human turn hand-editing the AI output → restore to turn 2 → second stubbed AI turn. Prints
turn_id, author, prompt, and the first 80 characters of each snapshot.

- Asserts the §0.3 invariant after every step, and prints each assertion as it passes.
- Asserts the restore **appended**: turn count grew by one, and the turns before it are
  byte-identical to a `structuredClone` taken beforehand.
- Persists after every step and reloads the file at the end, comparing it to the in-memory
  session — so the on-disk path is exercised, not just the model.
- Re-runnable: it removes a previous `documents/smoke.json` and says so. `--dir` puts it
  somewhere else.
- Exits 1 on the first failed assertion, and any throw from anywhere in the session prints
  a `smoke-session FAILED` banner rather than a bare stack trace.

## 2. The §3 rule (b) test, directly

`test/turns.test.js`, `§3 rule (b): a hand edit then a prompt makes two turns, each holding
only its own changes`. Committed draft: `The cat sat on the mat. The dog barked loudly.`
The human hand-edits `barked` → `howled` without checkpointing, then submits a prompt. The
stub changes `sat` → `dozed` and preserves the hand edit.

Asserted:

- three turns, in order `[1 human] [2 human] [3 ai]`
- turn 2 holds **only** the hand edit — `howled` present, `cat sat` still present, so the
  model's change is not in it — and carries no `prompt` key
- turn 3 holds **only** the model's change — `cat dozed` present, `howled` still present,
  so the model turn did not revert the hand edit — and carries the exact prompt
- the model was called *after* the human turn was committed and saw that draft
  (`{draft: handEdited, humanTurnId: 2}`), which is what makes the §2.1 diff possible

Plus the negative: submitting with nothing typed since the last turn creates no empty human
turn, giving `[1 human] [2 ai]`.

## 3. Mutations

| Mutation | Result |
|---|---|
| restore truncates instead of appending | 4 test failures; smoke exits 1 with `cannot restore to turn 2: no such turn. History holds: 3` |
| AI turn committed before pending human edits (rule (b) broken) | 1 failure — the rule (b) test, and only it |
| empty-turn rule removed | 3 failures |
| prompt trimmed before storing | 1 failure — the exact-prompt test |
| `history[0]` instead of last turn in the invariant (chunk 3) | still 2 failures |
| atomic write → direct write (chunk 3) | still 3 failures |

## 4. Findings

**F20. §3 and §2.4 disagree about an AI turn that changes nothing.** §3 says "if the draft
is unchanged since the last turn, don't create an empty turn"; §2.4 step 6 says commit the
AI turn with the exact prompt string, unconditionally. I applied the no-empty-turn rule to
human turns only, and commit AI turns even when the text is identical. The reasoning: the
prompt is provenance. A prompt that changed nothing is a real fact about the session — the
human asked, and the model declined or no-opped — and skipping the turn erases the only
record that it happened. §8's verdict field is aimed at exactly this kind of signal. Worth
a §3 line either way, because the opposite choice is defensible and this is currently my
reading, not the spec's.

**F21. Restoring to where you already are creates no turn.** If the working draft already
equals the target snapshot, `restoreToTurn` returns `turn: null` rather than appending an
identical turn. Consistent with the no-empty-turn rule, but it means "restore" is not
guaranteed to produce a history entry, and a UI that reports "restored to turn N" should
check. Not in the spec either way.

**F22. The unchanged-draft check happens after canonicalization.** Retyping `*` bullets as
`-` bullets produces no turn, because it is the same canonical draft. That is right — the
history view would otherwise show a turn with an empty diff — but it means the editor can
be in a state where the human made keystrokes and Checkpoint reports nothing to commit.

**F23. The invariant is now asserted on entry as well as exit.** A test caught that
`commitHumanTurn` returned early on an unchanged draft *before* validating, so a document
handed in already broken passed through silently. Both commit functions now assert on the
way in. The class of bug this closes: a corrupted document staying invisible until some
later write happens to notice.

## 5. What was NOT verified

- **Concurrency**, unchanged from chunk 3: no locking, `existsSync`-then-write is a TOCTOU
  race. Single local user, so a non-goal — but not a property these tests establish.
- **Real crash durability.** The directory fsync is called and the platform accepts it,
  but nothing proves the ordering guarantee under an actual power loss; that needs a
  crash-injection harness this project will not have.
- **The diff.** §2.4 step 3 computes the hand-edit diff for the payload. Nothing here
  computes a diff — `diff-match-patch` is chunk 6. `submitAiPrompt` hands `callModel` the
  document and the human turn so a diff *can* be computed, but does not compute one.
- **Turn volume.** The smoke session has 5 turns. Nothing exercises a few hundred, so
  §0.4's "a few hundred snapshots is a few megabytes" remains an assumption.
- **`warnings`.** The field is stored and asserted in a unit test, but nothing produces one
  yet — the §2.3 shrink guard and the out-of-dialect stripper are chunk 5.
- Everything else from chunk-02a §7 stands, including the HTML clipboard fixture (§9 step 6).
