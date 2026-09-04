# Deploy readiness — key-independent groundwork for step 13

Not a numbered chunk. Everything here is key-independent: no Railway config, no
real key, no deploy. Four spec edits, seven pieces of code, one measurement
subsystem, one error surface, and a fresh-clone rehearsal.

**Status: complete, rehearsal-verified.** 415 tests pass (was 382; +33).
`npm run smoke` green at 38 assertions. `npx vite build` clean.
`node scripts/secret-scan.js` clean, exit 0. **$0.00 live spend** — nothing in
this chunk needs the API, which is the point of it. 13 mutations run, 13 caught.

The rehearsal found one real defect that passed in the working tree and failed in
a clone (§7.1). That is what it is for.

---

## 1. Spec edits, as ratified

### 1.1 F37 resolved — the default token is refused off localhost

Written into §0.5. The rule, in the spec's words:

> **when the server is not listening on a loopback address, any request carrying
> the default token is refused with 403 and one line saying why.** Deployed
> namespaces exist only via generated tokens.

Three things the spec text now pins, each of which was a decision:

**Keyed on the BINDING, not on an environment label.** `NODE_ENV=production` is a
string someone can forget to set, and forgetting it *fails open* — the exposure
ships and nothing says so. A socket reachable from another machine is the hazard
itself and cannot be misdeclared. `HOST` therefore does double duty: the setting
that makes the server reachable is the same setting that turns the refusal on, so
there is no ordering in which you get one without the other.

**Refused, never sanitized and never redirected** to a generated namespace. Same
rule the invalid-token branch already followed: a request that quietly became a
different namespace is worse than one that failed.

**Local development is unchanged.** Bound to loopback, the default token works
exactly as it always has — asserted, not assumed (§4, group 1).

One consequential side effect, named because it is a behaviour change to a
default: `startServer` now binds `127.0.0.1` rather than every interface.
Previously `app.listen(port)` bound `0.0.0.0` implicitly. A dev server on a LAN
stops being reachable from another machine on the network, which is strictly safer
and is the behaviour most people assume they already had.

### 1.2 F43 accepted — last Checkpoint wins

Written into §0.5. Two tabs on one document both load, both edit, the later commit
wins. **The ledger keeps both** — every commit appends and nothing is rewritten
(§0.3), so both parties' turns are in the history and either draft is restorable
(§4). What is lost is bounded to the uncommitted hand edits in the losing tab.

§12's capability disclosure now carries the sentence, and it is live in the app:

> …Share it the way you would share a key. **If two of you have it open at once,
> the last Checkpoint wins — the history keeps both, but unsaved typing in the
> other tab is lost.**

Visible in the screenshot without a click, which is the F51 rule it inherits.

### 1.3 F-number collision renumbered

CLAUDE.md §13's own rule said "Renumber upward if any collide with an F-number
already used in `reports/`." It had not been applied. §13's F40–F47 block
overlapped `reports/chunk-06.md`, which had already used F31–F46, so **two
different findings were wearing the number 43** (this file's "modified-accept
record location" and chunk-06's "two tabs clobber"), and the same for 44.

**§13's block moved to F81–F88. The reports keep the numbers they were given.**
F47 did not collide and moved anyway, so the block stays readable as one set.
Cross-references updated: §10's "Blocked on F46" → F87, §11's K1 "(F44)" → F85,
the Build order step 16 note → F87.

Survey behind it: F1–F80 are used across `reports/` (chunk-12 reaching F80), and
F81–F88 are now used in §13. **The next free number is F89**, and §13 says so
explicitly so the next chunk does not have to redo the survey.

### 1.4 Two stale cross-references fixed

- **§13's "F37 … now step 14"** — F37 is resolved and the line is gone; deploy is
  step 13.
- **F37's own "§9 step 9"**, in `reports/chunk-06.md`. Annotated in place with a
  dated editorial note rather than rewritten: a report is a record of what was
  found on a day, and silently correcting its text would make the record less
  trustworthy, not more. The note says F37 is resolved, that "§9 step 9" was the
  numbering of the day, and that deploy is now step 13. F43 got the same treatment
  where it sits.

### 1.5 LICENSE

MIT, `Copyright (c) 2026 Julia Gross`, standard text. Asserted in the suite
(present, names the author, carries the warranty disclaimer) so it cannot be
deleted by accident.

---

## 2. What was built, file by file

**New:**

| file | what it is |
| --- | --- |
| `src/binding.js` | `isLoopbackHost` / `allowsDefaultToken` / the refusal message. The whole of the F37 control, pure and dependency-free so it can be asserted directly. |
| `src/version.js` | `APP_VERSION`, read from `package.json` at import. Never throws — a version string is diagnostic and must not be able to stop a server starting. |
| `src/usage-rates.js` | Dated rate table (`RATES_AS_OF`), worst-rate fallback, `costOf`. |
| `src/usage-ledger.js` | `recordUsage` / `readUsage` / `summarizeUsage`. Append-only JSONL on the documents volume. |
| `scripts/spend-report.js` | Total, per-namespace ranked table, seven-day trend. |
| `.github/workflows/test.yml` | `npm ci` → test → smoke → build → secret-scan. |
| `LICENSE` | MIT. |
| `test/deploy-readiness.test.js` | 20 tests, five groups. |
| `test/usage-ledger.test.js` | 13 tests. |

**Changed:**

- `src/namespace.js` — `DOCUMENTS_ROOT` reads `process.env.DOCUMENTS_ROOT`;
  `resolveNamespace` also returns `label` (see §3.2).
- `src/server.js` — `GET /health`; `host` option; the F37 refusal inside
  `withNamespace`; usage recording wrapped around `callModel`; `budget_exhausted`
  on the error path; `/` hoisted out of the client-build check (§7.1);
  `startServer` reads PORT/HOST/DOCUMENTS_ROOT and binds the host.
- `src/anthropic-client.js` — `ModelApiError`, `classifyApiFailure`, and a
  non-2xx path that throws structured fields instead of a sentence.
- `client/src/api.js` — `health()`; `budget_exhausted` and
  `default_token_refused` on `ApiError`.
- `client/src/draft-session.js` — `BUDGET_EXHAUSTED_MESSAGE` and its branch in
  `describe()`.
- `client/src/App.js` — version fetch, `<footer class="colophon">`, the F43
  sentence in the disclosure.
- `client/src/styles.css` — `.colophon`.
- `package.json` — `spend-report` script, `engines.node >= 22`.
- `README.md` — production sequence, env table, `/health`, spend report, F43.
- `test/namespace.test.js` — the `label` assertion (§3.2).

---

## 3. Decisions worth arguing with

### 3.1 The version comes from `/health`, not from the bundle

The obvious implementation is a Vite `define` baking `package.json`'s version into
the client at build time. I fetched it from the server instead.

**Reason: a bug reporter needs the version of the thing that just misbehaved.** A
build-time constant reports what the bundle was compiled from, which is the same
number right up until the moment it isn't — a half-finished deploy, a stale
`client/dist`, a rollback. The server reading its own `package.json` is the
deployment's version by construction.

Cost: one extra request on load, and the footer says `version unavailable` for a
few hundred milliseconds. The footer is diagnostic; a flicker on it is not a cost
worth optimising.

Note also that §12 enumerates the top row and three boxes and stops — **it does
not describe a footer.** This is the Versioning rule's requirement landing, not a
§12 change, and it is the only chrome outside §12's list.

### 3.2 The ledger's namespace label is derived by the one function

The ledger needs *something* that identifies a namespace. The obvious move is for
the `/ai-edit` handler to slice `req.params.token` — which is exactly the thing
§0.5 says no handler does.

So `resolveNamespace` returns `label` (the first 8 hex characters) alongside `dir`.
Attribution comes out of the one function that turns an identity into a place, no
handler touches a token, and when tokens become accounts the label changes there
and nowhere else.

**Eight characters, never the token.** A capability token is the whole identity, so
a ledger that logged one would have written a credential to disk. Asserted both
ways: the label is 8 characters, is a genuine prefix, is not the token, and the
written file does not contain the token anywhere.

### 3.3 The ledger swallows its own failures

`recordUsage` never throws; it returns `{written: false, error}`.

A ledger write happens *after* a model call has succeeded and cost money.
Throwing there converts a completed turn into a failed one and loses the human's
work to a bookkeeping error. Losing a row is a gap in a cost report; losing a turn
is a gap in someone's draft. Mutation-checked: making it throw fails the test.

### 3.4 The rate table is duplicated, deliberately

`src/usage-rates.js` repeats `scripts/spend-guard.js`'s table and its
worst-rate-for-unknown-model convention. It has to: CLAUDE.md forbids anything in
`src/` importing the dev guard, and `test/spend-guard.test.js` asserts it.

The **convention** is copied on purpose — a dollar figure that means one thing in
the dev report and another in the deploy report is worse than a duplicated table.
The separation test passes unchanged (16/16), and a new test asserts it in the
other direction too: the guard does not read the app ledger.

---

## 4. What was verified, and how

**415 tests, 415 pass, 0 fail.** Per group:

| group | pass |
| --- | --- |
| `deploy-readiness.test.js` (new) | 20 |
| `usage-ledger.test.js` (new) | 13 |
| `namespace.test.js` | 21 |
| `spend-guard.test.js` (unchanged) | 16 |
| `components.test.js` | 59 |
| `draft-session.test.js` | 24 |
| everything else | 262 |

`npm run smoke` — 6 turns, 38 assertions.

### The five groups in `deploy-readiness.test.js`

1. **F37.** `isLoopbackHost` against 7 loopback spellings and 10 non-loopback
   ones, including `''`, `undefined` and `null` — the fail-open cases, since
   `app.listen(port)` with no host binds everything, so "unspecified" must read as
   "exposed". Then: **all eight default-token addresses refused with 403**, GET and
   POST both, because a refusal covering only reads would leave the namespace
   world-*writable*, which is the actual hazard. Then that nothing was created on
   disk, that a *generated* token is unaffected, that loopback is unchanged, and
   that `/` never points at a page that will refuse the visitor.
2. **Env.** `DOCUMENTS_ROOT` honoured end to end (a document lands in the injected
   root); `PORT`/`HOST`/`DOCUMENTS_ROOT` read from the environment, and the host
   actually passed to `listen` rather than merely read.
3. **`/health`.** Returns `{status, version}`, no token needed, and **exactly those
   two keys** — it is the one address reachable without a link, so anything it says
   is public. Plus: the version equals `package.json`'s, and `src/storage.js` does
   not mention `APP_VERSION` (it is not `schema_version`).
4. **First visit.** See §5.
5. **Budget exhaustion.** See §6.

### Mutation checks — 13 run, 13 caught

| # | mutation | caught by | failure message |
| --- | --- | --- | --- |
| 1 | `isLoopbackHost('')` returns true (fail open) | F37 loopback test | `'""' is not loopback` |
| 2 | loopback becomes `startsWith('127.')` | F37 loopback test | `'127.0.0.1.evil.example' is not loopback` |
| 3 | F37 refusal disabled | F37 403 test | `GET /api/t/000…/documents` expected 403, got 200 |
| 4 | 429 *with* retry-after called budget exhaustion | ambiguity test | `retry-after present means retry works` |
| 5 | 402 no longer detected | three-shapes test | expected true, got false |
| 6 | 400 probe widened to every `invalid_request_error` | ambiguity test | `"messages: roles must alternate…" is not a budget signal` |
| 7 | ledger writes the whole token | prefix test | `the whole token is never in the file` |
| 8 | failed ledger write throws | bookkeeping test | threw instead of returning |
| 9 | trend drops quiet days | 2 tests | `seven days of zeroes, not an empty series` |
| 10 | unknown model billed as free | rates test | expected worst rate, got 0 |
| 11 | `DOCUMENTS_ROOT` hard-coded again | env test | `DOCUMENTS_ROOT is configurable` |
| 12 | `/health` drops the version | health test | version `undefined` ≠ `0.0.0` |
| 13 | budget message falls back to the raw API error | panel-sentence test | got `the model API returned 402: …` |

Mutation 9 failing *two* tests is worth noting: the zero-fill is load-bearing in
both the empty-ledger path and the summary path, and only one of those is obvious.

---

## 5. First-visit behaviour — checked, and it was already right

The item said to check what a brand-new generated token sees at a slug that does
not exist, and fix it if unhelpful. **It was already correct, and nothing needed
building.** What is new is that it is now asserted.

- `/t/{token}` and `/t/{token}/draft` → the default slug, **created on demand**,
  200, empty history. §0.5's missing-slug rule.
- `/t/{token}/anything-else` → 404 from the API, which the client turns into the
  offer-to-create screen ("There is no document called *notes* yet… Nothing was
  lost"), with a Create button and the namespace's other documents in the
  switcher. That screen has existed since chunk 6.
- `/library` on an empty namespace → `{documents: []}`, not an error.

The deliberate asymmetry — default slug created, any other slug 404 — is chunk-6's
F40 and stands: a typo that silently starts a second document is worse than a typo
that fails to find the first.

**The one thing that *was* broken for a first visitor is `/` on a deployment**, and
that is §7.1.

---

## 6. Budget exhaustion — what I keyed on, and the source

Source: **https://platform.claude.com/docs/en/api/errors, fetched 2026-09-04**, via
the `claude-api` skill's live-sources list. Not from memory.

The docs put budget exhaustion behind **three different statuses**, and only two are
distinguishable from an ordinary failure by structured fields:

| status | type | verdict |
| --- | --- | --- |
| **402** | `billing_error` | **Detected.** "There's an issue with your billing or payment information." 402 has no other meaning on this API. |
| **429** | `rate_limit_error` | **Detected only without `retry-after`.** The docs give the discriminator verbatim: *"A tier spend-cap 429 has no `retry-after` header and keeps failing until access resumes."* A 429 *with* `retry-after` is ordinary rate limiting — transient, retryable, and not a budget. |
| **400** | `invalid_request_error` | **Ambiguous.** The docs say a 400 is returned "when usage reaches an organization or workspace spend limit you set" — the same status and the same type as every malformed request, with no published message text. |

**What I did about the 400, and the argument for it.** The two signals above stand
alone; if the third never fires the feature still works. For the 400 I read the
message and match `/credit balance|spend limit|spend cap|usage limit/i` — the
platform's own vocabulary for the condition, not an invented string. It is labelled
in the code as the one non-structural check and as **secondary**.

The trade: a false positive costs a wrong-but-harmless sentence; a false negative
costs the whole point, and a self-set workspace spend limit is the likeliest way a
demo budget actually ends. Anything else a 400 says falls through to the generic
error, which is what an ambiguous failure deserves. Mutation 6 confirms the probe
is narrow rather than a blanket 400 rule.

**The sentence, exactly as it renders:**

> **That turn did not commit.**
> You've outrun the demo budget — tell Julia! Your draft is exactly as you left it.

The heading is the Prompt box's existing error treatment, which is where §12 puts
system reporting (F52) — this is the system talking about a turn, not the model
speaking, so it does not go near Model Response. The guarantee sentence is appended
by the same `describe()` path every §2.3 failure uses. Asserted as an exact string
equality, plus: editor unlocked, `pending` null, editor genuinely editable, draft
untouched.

---

## 7. Findings

### 7.1 F89 — `/` answered "Cannot GET /" on a fresh clone, and the rehearsal is what caught it

The `/` route was mounted **inside** `if (existsSync(CLIENT_DIST))`. So its
behaviour depended on build state: with no `client/dist`, Express fell through to
its default 404 page.

That is the least informative page available, served at exactly the moment
something needs explaining — a fresh clone, or a deploy whose build step failed.
It is also the first thing a person does with a bare hostname.

**Caught by the rehearsal, not by the suite.** The test passed in my working tree,
which had a `client/dist` sitting in it from an earlier build, and failed in the
clone. It also means my original test was written around the symptom — it had an
`if (response.status === 404)` guard that made the assertion conditional on the
very thing that was broken.

Fixed twice over: the route is hoisted out of the build check and is now
unconditional, and the test asserts unconditionally in both directions — 302 into
the dev namespace locally, and on a deployment a 404 that matches
`/capability links/i`, does **not** match `Cannot GET`, and does **not** contain the
default token (§0.5: nothing enumerates namespaces, least of all the page a
stranger is most likely to reach).

**This is also a finding about `npm test` itself.** CLAUDE.md requires a fresh
clone to pass it, and for one test it did not. The rehearsal is the only thing in
the process that checks that requirement, which argues for it happening more often
than once per deploy.

### 7.2 F90 — `npm run build` needs devDependencies, and a production install will not have them

`vite` is a devDependency. A host that runs `npm ci --omit=dev` — a common
production default — installs no vite and `npm run build` fails. Nixpacks and most
Node buildpacks install everything and then build, so this is latent rather than
broken, but it is a one-line configuration away from being a failed deploy with a
confusing message.

Not fixed in code, because the fix is a deploy-step decision (install everything
and prune, or promote vite to a dependency) and step 13 owns it. Documented in the
README as an explicit `npm ci # NOT --omit=dev`.

### 7.3 F91 — `startServer`'s bind default changed from all interfaces to loopback

Named because it is a silent behaviour change to a default rather than a new
feature. Previously `app.listen(port)` bound `0.0.0.0`; it now binds
`127.0.0.1` unless `HOST` says otherwise.

This is the F37 mechanism working as designed — the safe value is the one you get
by not thinking about it — but it means a dev server is no longer reachable from a
phone on the same wifi without setting `HOST`, and someone will eventually notice
that and think something broke.

### 7.4 F92 — the usage ledger is not rotated, and nothing prunes it

`usage.jsonl` grows without bound on the volume. At one row per turn and roughly
200 bytes per row this is irrelevant for a handful of people — a thousand turns is
200KB — and it is a real question at any scale beyond that. `readUsage` reads the
whole file into memory, so the report is the first thing that would feel it.

Deliberately not solved: rotation is a decision (by size? by month? archive or
discard?) and inventing one now would be building for a scale this does not have.
Named so it is not discovered as a surprise.

### 7.5 F93 — `/health` is unauthenticated and says the version out loud

Anyone who can reach the host learns the app's version without a link. That is the
point — a probe has no token — but it is worth stating that the version is public
information on a deployed instance. It reveals nothing a page load would not, and
the alternative (a health check requiring a capability token) is not a health
check.

### 7.6 F94 — the concurrency disclosure lengthens the header on a narrow viewport

The F43 sentence adds roughly one line to the capability paragraph. At 1440px it
is four lines (screenshot); on a narrow window it will be more, and the header is
above the editor. Watch in use. Shortening it would mean dropping either the
"history keeps both" reassurance or the "unsaved typing is lost" warning, and
neither is the half to drop.

---

## 8. Spec gaps found while building

- **§12 does not describe a footer.** The Versioning rule requires the version be
  surfaced; §12's enumeration of the surface predates that rule and stops at the
  three boxes. The footer is the one piece of chrome outside §12's list. Not a
  collision — a rule added later needing somewhere to land — but §12 should
  probably acknowledge it the next time it is edited.
- **Neither §0.5 nor §5 said where a cross-namespace operational file lives.** The
  usage ledger sits at `{DOCUMENTS_ROOT}/usage.jsonl`, beside the namespace
  directories rather than inside one. It has to be outside, or it would be
  readable by anyone holding that namespace's link. Nothing enumerates
  `DOCUMENTS_ROOT`, so this does not create a listing path. Named because the spec
  gave no rule and I made one.
- **The § Versioning rule I wrote last commit says the version bumps at deploy to
  `0.1.0`.** `package.json` is therefore still `0.0.0` and `CHANGELOG.md` does not
  exist yet — both correct, both slightly odd-looking in a chunk about deploy
  readiness. The footer currently reads `version 0.0.0`, which is honest.

---

## 9. The fresh-clone rehearsal

Method, stated precisely because "fresh clone" can mean several things:

1. `git clone . .tmp-test/rehearsal` — HEAD at `62896ed`, committed state only.
2. `git apply` of `git diff HEAD`, plus a copy of every untracked new file. The
   result is **byte-identical to what a clone will be once this chunk is
   committed**.
3. Confirmed absent, all gitignored: `.env`, `client/dist`, `documents/`,
   `node_modules/`, `.spend.json`.

Then, in that directory:

| step | result |
| --- | --- |
| `npm ci` | clean |
| `npm test` (no build present) | **413/413** — after §7.1 was fixed; 412/413 before |
| `npm run smoke` | 6 turns, 38 assertions |
| `npm run build` | `✓ built in 101ms`, 686KB JS / 10KB CSS |
| `node scripts/secret-scan.js` | clean, exit 0 |

**Launched with env vars only** — no edits, no config file, no `.env`:

```
PORT=4319 HOST=127.0.0.1 DOCUMENTS_ROOT=$C/volume \
  ANTHROPIC_API_KEY=sk-ant-dummy-not-a-real-key node scripts/serve.js
```

```
co-writing server v0.0.0 on 127.0.0.1:4319
documents root:    …/rehearsal/volume
local namespace:   http://localhost:4319/t/00000000000000000000000000000000/draft
the default token is fixed and guessable by design (§0.5, local development).
Bound to loopback, so nothing outside this machine can reach it.
```

- `GET /health` → `{"status":"ok","version":"0.0.0"}`
- `GET /` → `302 → /t/000…/draft`
- default token → `200`
- documents written to `…/volume/000…/draft.json` — the injected root, not `./documents`

**A second instance on `HOST=0.0.0.0`**, the deployed shape:

```
bound to 0.0.0.0, which is reachable from outside this machine, so the fixed
development namespace is REFUSED (§0.5, F37). Mint links with:  npm run new-token
```

- default token → **403** with the refusal line
- generated token → **200**
- `GET /` → 404 carrying the capability-links explainer, no token in it
- `/health` → still `{"status":"ok","version":"0.0.0"}`

**Screenshot: `reports/deploy-readiness-fresh-clone.png`** — the app from the
fresh clone, real typing in the editor, `version 0.0.0` in the footer, the
concurrency sentence in the disclosure, three boxes each showing their white
surface at first paint (§12). **Zero console errors.**

The spend report was exercised both ways: empty (`no ledger yet — … the normal
state of a fresh deploy, not a problem`, exit 0) and seeded with five rows across
three namespaces and three days, including one unknown model, which produced the
ranked table, the zero-filled trend, and the over-reporting note.

Rehearsal artifacts deleted afterwards (110MB, `.tmp-test/`, gitignored).

---

## 10. What I did NOT verify

Named as such, per the operating rules.

- **Anything against the real API.** No live call was made — $0.00 this window.
  `classifyApiFailure` is tested against the documented error shapes, **not against
  a real 402 or a real spend-limit 429**, because producing one means actually
  exhausting a budget. The 402 and 429 branches rest on the documentation being
  accurate about the shapes; the 400 branch additionally rests on the message
  wording, which the docs do not publish. **If the budget message ever fails to
  appear in real use, this is the first place to look**, and the fix is to read the
  `budget_signal` field and the logged status.
- **Railway.** No config, no volume, no deploy, no persistence across a real
  redeploy. `DOCUMENTS_ROOT` is verified against a local directory only.
- **The GitHub Action actually running.** The workflow is asserted as a file — the
  steps exist, no secret reaches the job, no browser is downloaded — but it has not
  executed on GitHub. Its steps are each verified locally in the rehearsal.
- **Concurrent writes.** F43 is *accepted*, not tested. There is no test that two
  simultaneous checkpoints leave the ledger consistent, because the accepted
  behaviour is that the later one wins and the earlier one's uncommitted edits are
  gone. Worth saying plainly: the claim "the ledger keeps both" rests on §0.3's
  append-only property, which is well tested, and not on a concurrency test.
- **The version footer under a slow or failed `/health`.** The fetch is
  `catch`-swallowed and the footer reads `version unavailable`; that path is not
  asserted, only the success path.
- **Ledger behaviour under concurrent appends.** `appendFileSync` of a single
  short line is atomic enough in practice on the platforms this will run on; it is
  not asserted, and interleaved partial lines are what the skip-and-count reader
  exists to survive.
- **Anything about step 13 itself.** This chunk removes reasons a deploy would go
  wrong. It does not deploy.
