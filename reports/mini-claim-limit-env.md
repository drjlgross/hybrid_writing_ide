# mini-claim-limit-env — the sign-up claim limit reads from the environment

Out-of-band work, not a step in the Build order. Nothing in the Build order moved
and this report carries no number, per the Report naming rule.

**Why now.** The operator needs a higher limit tomorrow at a conference venue where
every attendee shares one NAT'd address. Five claims an hour per address is exactly
the right number for the open internet and exactly the wrong one for a room of
people signing up at once, and the difference has to be settable from the Railway
dashboard rather than from a commit.

---

## What changed, file by file

### `src/claims.js`

Three edits, all inside the per-IP friction section. §12b's friction rules are
untouched: it still counts claims and not requests, still does not record a refused
attempt, still takes the rightmost forwarded hop, and still cannot refuse a model
call.

**1. The default is now a named constant.** `const CLAIM_LIMIT_DEFAULT = 5` — not
exported, because nothing outside this file needs it and the parser is the whole
public surface. Its comment gained four words ("unless the deployment says
otherwise") so it no longer reads as the last word on the subject.

**2. `claimLimitFromEnv(raw)`, exported and pure.**

```js
export function claimLimitFromEnv(raw) {
  if (typeof raw !== 'string') return CLAIM_LIMIT_DEFAULT;
  const trimmed = raw.trim();
  if (trimmed === '') return CLAIM_LIMIT_DEFAULT;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return CLAIM_LIMIT_DEFAULT;
  return parsed;
}
```

A positive integer is taken as written; everything else falls back. Two decisions
in there are worth naming rather than leaving to be rediscovered:

- **No ceiling**, per the task. A cap chosen here would be a second limit the
  operator cannot see from the field she set the first one in — she would type 500,
  get 100, and have nothing on the dashboard telling her why.
- **Falling back, not throwing.** A typo in a dashboard field must not take the
  front door down. The cost is a misconfiguration that looks exactly like the
  default, which is the survivable direction for a control the header of this file
  already calls friction and not enforcement.

No logging, per the task. Worth saying out loud what that buys and costs: nothing
here writes to a log that could carry an operator's value, and nothing announces a
rejected one either, so a typo is silent until someone counts sign-ups.

**3. `CLAIM_LIMIT` is now derived, read once at module load.**

```js
export const CLAIM_LIMIT = claimLimitFromEnv(process.env.CLAIM_LIMIT);
```

Everything downstream is unchanged and untouched — `createClaimLimiter`'s `limit =
CLAIM_LIMIT` default, `src/server.js:139`'s `${CLAIM_LIMIT} sign-ups from this
connection` interpolation, and the eight existing test sites that reference
`CLAIM_LIMIT` symbolically. The constant kept its name, its type and its export, so
nothing had to learn that it became configurable. **`src/server.js` was not
touched** and did not need to be, which was the fence's implied bet and it held.

Read once at load means a change takes effect on the next restart, not on the next
request. That matches the limiter's own lifetime — it is in-memory and per-process
and a restart forgets it anyway (§12b) — so there is no state a re-read would
preserve.

### `test/claims.test.js`

Two tests added at the top of group 2 (friction), plus `claimLimitFromEnv` in the
import list and one module-level constant in the harness. **No existing test was
modified**; the file is otherwise byte-identical.

`CLAIM_LIMIT_DEFAULT_VALUE = 5` is written out in the test file rather than
imported from the module under test. Importing it would make "the default is five"
an assertion that cannot fail.

---

## Verification

### Per-group counts

`test/claims.test.js` — **25 passed, 0 failed** (23 before; the two new ones are
both in group 2):

| group | tests | of which new |
| --- | --- | --- |
| 1. validation | 2 | — |
| 2. friction | 7 | **2** |
| 3. the registry | 3 | — |
| 4. the claim | 4 | — |
| 5. the endpoint | 7 | — |
| the operator join | 2 | — |

Full suite, `npm test`: **487 tests, 487 passed, 0 failed, exit 0** (485 before).

`node scripts/smoke-session.js`: **exit 0** — 6 turns, 38 assertions passed. It does
not touch this path; it is run because the Operating rules say to run it after
every chunk, and its value here is that a change to a module the server imports did
not break the session it walks.

### The parser's edge cases, walked against the task list

Every one of these is asserted directly on the function, with no `process.env`
mutation and no re-import anywhere in the file.

| input | result | why it is in the list |
| --- | --- | --- |
| `'50'` | 50 | the conference case, the reason this exists |
| `'1'` | 1 | one is a valid limit, not an edge case to reject |
| `'  12  '` | 12 | a pasted dashboard value keeps its whitespace |
| `'100000'` | 100000 | pins the no-ceiling decision as a test, not a comment |
| `undefined` | 5 | **unset** — what `process.env.X` yields when it was never set |
| `''` | 5 | **empty** — an emptied dashboard field |
| `'   '` | 5 | whitespace-only, the other way a field ends up blank |
| `'five'`, `'5 claims'`, `'NaN'` | 5 | **non-numeric**, in the shapes people type |
| `'Infinity'` | 5 | numeric and not an integer — `Number()` accepts it, we do not |
| `'0'` | 5 | **zero** would close the door to everyone; nobody means that by it |
| `'-3'` | 5 | **negative** |
| `'2.5'` | 5 | **non-integer** |
| `'5.0'` | 5 | *accepted* — `5.0` IS the integer five, so it parses rather than falls back. Asserted with that comment so the next reader does not file it as an inconsistency. |
| `null`, `7` | 5 | not a string at all, belt and braces |

The second new test pins the swap itself: the fallback is 5 (the number that was
hardcoded), and a limiter built with `claimLimitFromEnv('2')` allows two claims and
refuses the third — so a configured value actually reaches the gate rather than
only the parser's return value.

### Mutation checks

Five mutations. Three failed as they should; **two survived and are reported as
survivors rather than omitted.**

| # | mutation | result |
| --- | --- | --- |
| M1 | drop `\|\| parsed < 1` (accept zero and negatives) | **caught** — `AssertionError: actual: 0, expected: 5` |
| M2 | `Number.isInteger` → `!Number.isNaN` (accept floats and Infinity) | **caught** — `AssertionError: actual: Infinity, expected: 5` |
| M3 | move the default to 3 | **caught, by both new tests** — `actual: 3, expected: 5`, 2 failed |
| M4 | revert `CLAIM_LIMIT` to a literal `5`, leaving the parser unused | **SURVIVED — 25 passed** |
| M5 | remove the explicit `.trim()` | **SURVIVED — 25 passed** |

**M4 is the real gap and it is structural.** No test in the file can observe the
one line that reads `process.env`, because the two ways to observe it are the two
ways the task forbids: mutating `process.env` (which leaks into every other test in
the process) or re-importing the module per case (which tests the loader rather
than the parser). The trade is deliberate and I think correct — the parser holds
every decision and the read is one line — but the consequence is that *the wiring
line is not covered by `npm test`*. It is covered by the out-of-band checks below
instead, which is not the same thing and should not be read as if it were.

**M5 is redundancy, not a hole.** `Number()` trims its own argument and
`Number('   ')` is `0`, which the positivity guard already rejects — so the
explicit `.trim()` and the empty-string early return cannot change any result. They
stay because they make the intent legible at the point of reading and cost nothing;
noted here so nobody later reads the surviving mutation as a missing test.

### Out-of-band verification (not committed, not in `npm test`)

Covering M4, at the process level, in a throwaway scratch script:

```
CLAIM_LIMIT=undefined  -> 5
CLAIM_LIMIT="50"       -> 50
CLAIM_LIMIT="0"        -> 5
CLAIM_LIMIT="banana"   -> 5
CLAIM_LIMIT=""         -> 5
```

And the whole claims suite re-run under a configured limit, which exercises the
full path — module load, `createClaimLimiter`'s default, and the server's 429
message, whose test matches `new RegExp(\`${CLAIM_LIMIT} sign-ups\`)` against the
live response body:

```
CLAIM_LIMIT=2 node --test test/claims.test.js  →  25 passed, 0 failed
CLAIM_LIMIT=9 node --test test/claims.test.js  →  25 passed, 0 failed
```

That is the end-to-end evidence that the 429 message interpolates the configured
number and the gate opens at it. It passes because the existing tests reference
`CLAIM_LIMIT` symbolically — which is the property the fence was counting on, now
demonstrated rather than assumed.

---

## Not verified, named as such

- **The deployed path.** Nothing was set in Railway and no deploy was made. The
  claim that the dashboard variable reaches the process is the ordinary Node
  contract and is untested here.
- **The wiring line under `npm test`**, per M4 above.
- **A second instance.** The limit is still per-process (§12b); configuring it does
  not make it shared, and two instances each allow the configured number.
- **The docs.** `reports/chunk-15.md`'s constants table still reads
  `` `CLAIM_LIMIT` | **5** | claims per address per window ``, which is now the
  default rather than the value. It is outside the fence and was left alone.

## Findings

- **F95 — the configurable limit is undocumented where an operator would look.**
  CLAUDE.md §12b states the rate limit as "five claims per hour per address, in
  memory. Named constants in `src/claims.js`", which is now true only of the
  default. Nothing in the spec or in `reports/chunk-15.md` says the variable
  exists, so the feature is discoverable only by reading this file. Both are
  outside the fence; naming it rather than editing it. (F95 was the next free
  number per §13; if a chunk claims it first, this is whatever follows.)
- **No shared-artifact changes.** The §5 fixtures were not read, written, or
  touched. No dependency was added. `package.json` is unchanged.
- **Nothing in the spec was wrong or underspecified for this work** — it is a
  mini, and §12b's friction rules were specific enough to change one number
  without reopening any of them.

## Fence

Touched exactly: `src/claims.js`, `test/claims.test.js`, this report. Not touched:
`src/server.js`, `CLAUDE.md`, the Build order, `package.json`, client code, any
other test. Not committed. No version bump. `scripts/spend-report.js` was already
modified in the working tree before this task began and was not touched by it.
