# Mini: the AI-turn output budget and the request timeout (§2.3)

**Status: complete.** `npm test` (485 pass, 0 fail) and
`node scripts/smoke-session.js` (6 turns, 38 assertions) pass. Nothing committed or
pushed. No client file was touched, so no build was needed and none was run.

Constants only, in two files. The formula's shape is unchanged.

---

## What failed, and why

A live `max_tokens` failure on real memo-length work: an analysis-heavy turn on a
~10,000-character draft exhausted the computed budget. **Thinking shares that
budget**, and the flat term reserved for it was 2048 tokens — enough for a turn that
mostly reproduces a draft, not for one that reasons about it first.

The formula was right about what to measure. Its constants were set when the typical
turn was a rewrite, and an analysis turn is a different shape of output.

---

## Before and after

| draft | before | after | change |
| --- | --- | --- | --- |
| 2,000 chars | 5,116 | **16,000** | +10,884 (213%) |
| 10,000 chars | 9,383 | **16,000** | +6,617 (71%) |
| 30,000 chars | 20,048 | **28,144** | +8,096 (40%) |

At 2K and 10K the floor is what binds — which is the fix. The failing case was a
10K draft receiving 9,383 tokens for a draft reproduction *plus* a note *plus*
thinking; it now gets 16,000 with the floor doing the work, because the whole point
is that a short draft can carry a long analysis.

### The constants

| | before | after |
| --- | --- | --- |
| headroom factor | 1.6 | **2.0** |
| flat thinking/segments term | 2048 | **6144** |
| floor | 4096 | **16000** |
| ceiling | 32000 | 32000 (unchanged) |
| request timeout | 120,000 ms | **480,000 ms** |

`NOTE_MAX_CHARS / 3` (2,000 tokens) is budgeted separately and is unchanged.

### The ceiling, and where it binds

The ceiling stays 32000, and one comment line in `maxTokensForDraft` now says why:
with no streaming (§0.6) and a finite timeout, an unbounded single generation trades
a truncation the `stop_reason` guard **catches and refuses** for a hang it cannot.
That is the wrong direction.

**The clamp starts at ~35,800 characters**, not 60K. Solving
`ceil(chars/3) × 2 + 2000 + 6144 ≥ 32000` gives 11,928 draft tokens, or 35,784
characters. Past that the budget stops covering twice the draft plus the flat terms,
and a long enough document can still hit `max_tokens`. Named as a known limit in the
code and in §2.3; corrected from the brief's ~60K in the findings below.

### The timeout

120s → 480s, and the two numbers are one setting. A generation allowed 32000 tokens
takes longer than one allowed 20000, so raising the budget without the timeout would
have converted the `max_tokens` failures this fixes into **abort** failures — same
cause, worse message, and the abort path says nothing about the budget.

The message renders its seconds from the constant and reads correctly:

> the model API did not respond within 480s and the request was aborted. The draft
> is unchanged and nothing was committed.

Verified rather than assumed: the test now builds its expected string from
`REQUEST_TIMEOUT_MS` rather than a literal, so the message cannot quote a stale
number. Mutation 5 hardcodes `120s` into the message and it fails.

---

## What was verified

| group | tests | result |
| --- | --- | --- |
| `ai-response` — the budget | 2 (1 new) | pass |
| `anthropic-client` — request shape, timeout, message | 3 touched | pass |
| whole suite, `npm test` | **485** | 485 pass, 0 fail |
| `scripts/smoke-session.js` | 6 turns, 38 assertions | pass |

484 → 485: one test added, `a memo-length draft gets a budget that survives an
analysis turn`, asserting a 10,000-character draft yields ≥ 16000 and that the
ceiling still binds at 200K.

**It asserts the number, not the formula.** A test that recomputed
`ceil(len/3) × 2.0 + …` would have agreed with the bug just as happily as with the
fix — the formula is the thing that was wrong.

### Mutation checks

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 1 | floor back to 4096 | `max_tokens is computed from the draft size…` | `AssertionError: floor is too low: 8154` |
| 2 | flat term back to 2048 | `the request carries the model, version header, and a draft-sized max_tokens` | `AssertionError: a long draft must get a budget bigger than the floor` |
| 3 | ceiling removed | `max_tokens is computed from the draft size…` | `AssertionError: the budget must stay under the practical ceiling` |
| 4 | timeout back to 120s | `every request carries an abort signal with a timeout` | `AssertionError: the timeout must leave room for a full generation at the §2.3 ceiling: 120000` |
| 5 | `120s` hardcoded into the message | `a timeout is reported as prose, saying the draft is unchanged` | `AssertionError: the message quotes the configured timeout, not a stale number` |

Mutation 2 is worth noting: raising the floor to 16000 masks the flat term at small
drafts, so lowering the flat term alone is invisible until the draft is long enough
for the formula to beat the floor. It is caught by the long-draft assertion in the
client test rather than by the floor assertion — the two together are what pin all
three constants.

Final state re-verified on the reverted tree: 485/485, smoke passes.

---

## Findings

- **N1 — §2.3 stated none of these numbers.** The brief asked to "update the §2.3
  numbers… wherever stated"; they were stated nowhere. The headroom factor, the flat
  term, the floor, the ceiling and the timeout lived only in `src/`, which is how
  constants that were too lean went unexamined until a live failure. They are now
  written into §2.3 with the formula, the reason for the ceiling, and where it binds.
  That is slightly more than "update the numbers", and it is the change that makes
  the next raise checkable against something ratified.

- **N2 — the ceiling binds at ~36K characters, not ~60K.** The brief's figure was
  optimistic by a factor of about 1.7. Worth knowing because the gap is exactly the
  range where a document is long enough to clamp and short enough that nobody
  expects it to: a 40,000-character draft gets 32000 tokens and needs about 13,300
  just to reproduce itself.

- **N3 — RESOLVED: the fix was tested against the failure that caused it.** See
  "Live confirmation" below. The turn was replayed twice on the real memo and the
  finding is more precise than the original diagnosis: the old budget was not
  hopelessly small, it was **marginal**, which is why the failure was intermittent.

- **N4 — 480s is a long time to hold a locked editor.** §0.2 keeps the editor
  read-only for the whole request, so the worst case is now eight minutes of a
  frozen draft before the timeout says anything. The pending indicator is the only
  thing on screen during it. Nothing about that is new except the duration, and the
  duration is now four times what it was.

- **N5 — the message says "480s", not "8 minutes".** Correct and derived from the
  constant, which is what matters; it reads a little machine-like at this magnitude.
  Left alone — the brief fenced this to constants, and rendering minutes would be a
  code change to the message.

---

## Live confirmation

Added after the fact, on the real memo. The failing session was exported
(`gxl-vs-brief`, 14 turns, final draft **4,724 characters**) and the exact prompt
that stalled was replayed against the API through `scripts/spend-guard.js`, then a
second editing pass was chained onto the result to see whether the budget survives
the memo growing.

| | draft in | budget now | budget before | output used | of new | stop_reason | elapsed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| replay A — the prompt that stalled | 4,724 | 16,000 | 6,568 | **7,350** | 46% | `end_turn` | 73.7s |
| replay B — same prompt again | 4,724 | 16,000 | 6,568 | **6,228** | 39% | `end_turn` | 63.3s |
| a following editing pass | 6,476 | 16,000 | 7,503 | **6,392** | 40% | `end_turn` | 52.7s |

**The old budget was marginal, not hopeless — and that is the real diagnosis.** The
same prompt on the same draft wanted 7,350 output tokens on one run and 6,228 on the
next, against an old cap of 6,568. It sat on the boundary, which is exactly why the
failure was intermittent rather than reproducible: one run is cut off mid-JSON and
the next completes. A cap that always failed would have been found much earlier.

Both replays validated cleanly against §2.3's guards and returned what was asked
for: three segments (context / question / edit), a 2,152-character note commenting
on the structure and flagging two specific disagreements, and a draft grown from
4,724 to 6,476 characters with the open bullets filled in.

**Headroom for further passes is comfortable.** Every pass used 6,200–7,400 output
tokens regardless of draft size, leaving ~9,600 of the 16,000 unused. The floor
covers this memo until it reaches **11,784 characters** — two and a half times its
current length — at which point the formula takes over and keeps growing. Nothing
about this memo approaches the ceiling; that starts at ~35,800 characters.

Three calls, **$0.2210** of the $1.00 window.

---

## What was NOT verified

- **That the ORIGINAL failure was `max_tokens` and not something else.** The replay
  shows a turn that wants more than the old cap, twice, on the same draft and
  prompt. It does not prove the observed stall had that cause — the failing turn's
  own `stop_reason` was not captured at the time.
- **The payload the failing turn actually sent.** The replay reconstructs the draft
  from the export and sends no context files, no standing rules and no conversation
  window — the export carries context as metadata only (§0.5), so the file bytes are
  not recoverable from it. Those affect input tokens, not `max_tokens`, but the live
  turn's input was larger than the 3,396 tokens measured here.
- **Cost at scale.** A larger `max_tokens` is a ceiling, not a spend — it bills what
  it generates. But turns that previously truncated now complete, and completing
  costs more than failing: roughly **$0.07 per pass** on this memo.
  `npm run spend-report` is where that shows up on the deployment.
