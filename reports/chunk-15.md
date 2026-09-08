# Chunk 15: public claim endpoint + landing page + signup registry

**Status: complete.** `npx vite build`, `npm test` (484 pass, 0 fail, 0 skipped) and
`node scripts/smoke-session.js` (6 turns, 38 assertions) all pass. Nothing committed
or pushed.

WordWright has a front door. A stranger at the bare domain can read what the tool
is, sign up, and receive a working namespace with no operator in the loop.

---

## 0. Two notes on the brief, before anything else

**"the Measurement-infra rule" is not in CLAUDE.md.** The rule the brief points at
— measure, never enforce; the Console workspace limit is the backstop — is written
in the header of `src/usage-ledger.js`, not in the spec. I followed it as stated
there and cited that file rather than inventing a section reference. §12b now
repeats the rule where the rate limit is specified, so the next reader is not sent
looking for a section that does not exist.

**The spec section is §12b, not §14.** The brief said "new numbered section"; the
numbered sections run 0–13, and 13 is Open items. Chunk 14 established the pattern
of lettered insertions before it (§12a), so this is §12b. Source comments written
during the build refer to "§14" in a few places and have been left as they were
written where the meaning is unambiguous — named here rather than silently
divergent. Worth a sweep if it bothers you.

---

## 1. What was built, file by file

### New

**`src/seed-document.js`** — the `SEED_DOCUMENT` constant, verbatim, and
`SEED_SLUG`. §1 dialect: paragraphs plus bold section labels; no headings, no
lists, no links, no font styling. `wordwright.ink/view` in it is a bare URL and
stays plain text.

**`src/claims.js`** — validation, the per-address limiter, the registry, the claim
itself, and the operator join. The §0.5 machinery is called and never
reimplemented: `generateToken`, `resolveNamespace`, `createDocument`,
`commitHumanTurn`, `saveDocument`. Nothing here slices a token to make a path.

**`client/src/landing-copy.js`** — `LANDING_COPY`, `KEY_DISCLOSURE`, `DISCLAIMERS`,
verbatim, plus `wordmarked()`.

**`client/src/Landing.js`** — the landing view and the success view.

**`scripts/users-report.js`** + the `users-report` npm script.

**`test/claims.test.js`** (22 tests), **`test/landing.test.js`** (9 tests).

### Changed

**`src/server.js`** — `POST /api/public/claim`, mounted above the namespaced
router; `/` reworked (§2 Part B); `NO_BUILD_NOTICE` exported so the fallback text
is assertable whatever the build state (§4, mutation 6).

**`src/addressing.js`** — `isLandingAddress()`, and `/` added to `isClientPath()`.

**`client/src/main.js`** — `/` renders `Landing`.

**`client/src/styles.css`** — the landing and success views, `.wordmark-inline`,
and `.missing .primary` generalized to `.primary` so the landing form's Start
writing inherits §12's forest green rather than growing a second copy of it.

**`package.json`** — the script entry. No dependency added.

**`test/deploy-readiness.test.js`, `test/viewer.test.js`** — updated for `/`
(§2 Part B).

---

## 2. The three parts

### Part A — the claim endpoint

`POST /api/public/claim` with `{name, email}` → `201 {token, address, slug}`.

**Rate-limit constants**, all in `src/claims.js`:

| constant | value | what it is |
| --- | --- | --- |
| `CLAIM_LIMIT` | **5** | claims per address per window |
| `CLAIM_WINDOW_MS` | **3 600 000** (1 hour) | the sliding window |
| `CLAIM_IP_MAX` | **10 000** | tracked addresses before the oldest are dropped |

Three properties of the limiter, each deliberate and each mutation-checked:

- **It counts CLAIMS, not requests.** `check()` asks without counting; `record()`
  is called only after a namespace has actually been minted. A mistyped email is
  refused before anything exists, so it does not spend one of the five — I found
  this by running the flow: the first end-to-end pass had one typo consume a slot,
  which meant a person fumbling their address twice would be down to three.
- **A refused attempt is not recorded**, so retrying cannot extend a lockout. Without
  it a one-hour limit becomes permanent for anyone who double-clicks.
- **The address is the RIGHTMOST `X-Forwarded-For` hop.** Each proxy appends the
  address it received from, so behind one trusted proxy the last entry is what our
  proxy saw. The leftmost is whatever the client typed, and taking it would let
  anyone reset their own limit with a header.

`CLAIM_IP_MAX` is a bound on memory rather than a second limit: rotating addresses
would otherwise grow the map without end, which is a way to take the server down
rather than a way to get namespaces.

This is friction, not enforcement — per-process, forgotten on restart, shared by no
second instance. Nothing in `src/` can refuse a model call, unchanged.

**The registry.** One JSONL row per successful claim in `claims.jsonl`, beside
`usage.jsonl` on the volume: `{at, name, email, token}`.

It holds the **whole token**. That is the mirror of §0.5's rule and the one place
it is deliberately inverted: the usage ledger writes an eight-character prefix
because a token in a log is a credential in a log, and this file inverts it because
it is the only record connecting a person to a namespace. With no login and no
recovery, a registry without the full token means a lost link is lost documents and
nobody can help. A prefix cannot open a namespace — which is exactly what makes it
useless for this file's one job.

The rule that makes that safe is not a code rule, because it cannot be: **the
registry never leaves the server.** Served by no route, read on no request path, in
no export, pasted nowhere. `scripts/users-report.js` is its only reader and prints
the prefix in its human table. The decision and the rule are in the module header,
and a test asserts the header still says it.

Writes follow the ledger's discipline: after the namespace exists, never throwing,
and a swallowed failure logged to the server rather than shown to the visitor,
whose namespace is real either way.

**The seed document is `welcome-doc`, and its section labels are bold.** Both were
asked for after the first walkthrough — see Part 2a below.

**The seed turn is authored `human`.** §3 has three authors — `human`, `ai`,
`mixed` — and none of them is "system". A fourth would change the turn schema for a
rendering nicety, so I did not add one, and the brief permitted the plain choice
with a spec note. It is defensible on its own terms: a person placed this text, and
every §4 control behaves correctly on it. Recorded in §12b so nobody later reads
`human` as a bug.

### Part 2a — four revisions after walking the flow

All asked for once the flow was running. The first three are written into §12b; the
fourth amends §12's top-row enumeration.

**The section labels are bold.** `**Working Together:**`, `**Checkpoints:**`,
`**Using AI:**`, `**Exporting:**`, `**New Document:**`, with the colon inside the
bold as hand-marked. Bold is in the §1 dialect and §1 has no heading node, so this
is what a scannable label looks like here. Verified two ways: `canonicalize(SEED_DOCUMENT)`
is byte-identical to the source, so the store holds the marks rather than an
artifact of them; and the browser renders exactly five `<strong>` elements in the
editor.

**The seed document's slug is `welcome-doc`, not `draft`.** `SEED_SLUG` in
`src/seed-document.js`; the claim's returned `address` and `slug` follow it.

The reasoning, written into §12b: it is a welcome page, not the visitor's first
draft. Calling it `draft` invites someone to start writing over instructions they
have not finished reading, and its own name is what makes it findable in the
switcher afterwards — which is what the seed text already promises when it says the
welcome page stays in your namespace.

**The consequence, named rather than left to be found.** §0.5's `DEFAULT_SLUG` is
`draft`, so a claimed namespace now has no document at the default slug: trimming
the URL back to `/t/{token}` reaches the ordinary "there is no document called
draft yet" screen, which offers to create it and lists what is there. Nothing
routes a new visitor there — the success link, Start writing, and the switcher all
name the welcome page — but a person who edits their own URL will meet it. It is
asserted as a test rather than left implicit.

**"Welcome to WordWright." was cut from the landing copy.** `LANDING_COPY`'s first
paragraph now opens "This app exists to enable and enforce human judgment…". The
lockup sits two inches above it, so the greeting was the reader's third look at the
same name before the page had said anything. The rest of the sentence is untouched,
and the cut is recorded beside the line and in §12b — ratified copy changes only
when the person who ratified it says so, and the reason travels with it.

**The seed document still opens with the greeting**, deliberately. Inside the tool
it is the first thing said rather than a caption under the sign, and it is a
different surface reached at a different moment. The two are not inconsistent and
the divergence is named in both files so nobody "fixes" one to match the other.

Side effect, checked: the landing page now renders three inline Allison wordmarks
rather than four. The test counts occurrences from the constants rather than from a
literal, so it followed the copy without being edited — which is the property that
made it worth writing that way.

**A View WordWright Doc control was added to the top row**, between Export
transcript and Checkpoint, opening §12a's viewer. §12's enumeration of the top row
is amended to name it.

Four decisions inside a small control:

- **A new tab.** The load-bearing one. Hand edits are uncommitted until Checkpoint
  (§3), so navigating away in the same tab would silently discard whatever is typed
  and not yet ratified — exactly the loss Checkpoint's dirty marker exists to warn
  about. It is also the shape of the task: export a transcript here, read it there,
  with both open.
- **An anchor, not a button.** It goes somewhere, so middle-click, cmd-click and
  "open in new tab" work with no handler of ours in the path. It wears `.top-button`
  because §12's split is about what a control DOES — this is navigation, so lilac.
- **`rel="noopener noreferrer"`.** The capability token is in the referring page's
  URL. `noopener` keeps it out of the opened window's `opener`; `noreferrer` and
  index.html's document-wide `<meta name="referrer" content="no-referrer">` keep it
  out of the Referer header. Two layers, because a leaked token is not recoverable.
- **Shown even when the slug names no document.** It is global, and the
  missing-document screen is a plausible place to want to go read a transcript
  instead.

**Its label is NOT set in Allison.** §12b's wordmark rule is scoped to the landing
and success pages, and a script face inside a 0.85rem control costs legibility for a
consistency nobody asked for. Flagged rather than assumed — it is one line to change
if the name should wear its face everywhere.

### Part B — the landing page, and what happened to `/`

`/` is now a client path and serves the landing bundle. `/t/…`, `/view` and
`/api/…` are untouched; all three tests come from `src/addressing.js`, so there is
one definition rather than several that agree today.

**`/` no longer redirects into the development namespace on a loopback binding.**
That is a deliberate change and the one behavioural regression in this chunk, named
here rather than discovered later. The reasoning: a front door that only appears in
production is a front door nobody looks at, and I could not have verified this page
in the place it was developed. `/` now behaves identically on every binding. The
convenience it replaced still exists — `startServer` prints the development
namespace's URL at every start.

The plain-text route at `/` survives as the **no-build fallback**, mounted
unconditionally, which is F89's lesson kept intact: a fresh clone or a failed build
still gets an explanation rather than "Cannot GET /". It answers 503 now rather
than 404, because "the bundle is missing" is a server-side condition, and it says
what to run.

Neither answer hands out a token, on any binding.

**Typography.** Every rendered "WordWright" in page chrome and copy is set in
Allison — four occurrences on the landing page, plus the lockup. The mechanism
splits the string and wraps occurrences; it changes no character, which is asserted
directly (`wordmarked()` round-trips every constant exactly). Allison is a light
script, so inline it is set at `1.45em` with a small baseline nudge, or it reads
thinner than the serif around it. **The seed document gets none of this**, per §12b.

Spelling is *judgment* throughout, asserted against `/judgement/i`.

**The success view's entire job is the link**: the full absolute URL in a bordered
monospace block, a copy button, `KEY_DISCLOSURE` beside it, and Start writing. The
form is gone from that view.

Failure states — 429, 400, 500, and a network that never answers — all render as
one calm line with `role="alert"`, the form intact beside them.

### Part C — the operator report

`npm run users-report`, `npm run users-report -- --csv`. The join lives in
`src/claims.js` as `joinClaimsAndUsage()` so it can be asserted without capturing
stdout — the same split `summarizeUsage` has from the spend report.

Sample, against a fabricated registry and ledger (three claims, one of them
unused; one namespace spending money that no claim accounts for):

```
claims registry: .tmp-test/opsroot/claims.jsonl
usage ledger:    .tmp-test/opsroot/usage.jsonl

3 sign-ups

  date        name                  email                           prefix      calls       cost   last call
  2026-09-08  Ada Lovelace          ada@example.com                 a695050b      3    $0.0422   2026-09-08T12:20
    https://wordwright.ink/t/a695050bf41c238dbf9d23af87c425db/welcome-doc
  2026-09-08  Grace Hopper          grace@example.com               7c1f9d4e      1    $0.0049   2026-09-08T11:58
    https://wordwright.ink/t/7c1f9d4e2b6a084f35d0c8e1a9b27d63/welcome-doc
  2026-09-08  Katherine Johnson     katherine@example.com           3f8b2c17      0    $0.0000   —
    https://wordwright.ink/t/3f8b2c17d94e60a5b1c7e2f04a86d9b3/welcome-doc

HAND-MINTED OR UNKNOWN — namespaces in the usage ledger that no claim accounts for

  prefix      calls       cost   last call
  00000000      1    $0.0512   2026-09-07T22:10
```

And `--csv` over the same data:

```
date,name,email,prefix,link,calls,usd,last_call
"2026-09-08","Ada Lovelace","ada@example.com","a695050b","https://wordwright.ink/t/a695050bf41c238dbf9d23af87c425db/welcome-doc",3,0.042156,"2026-09-08T12:20:00.000Z"
"2026-09-08","Grace Hopper","grace@example.com","7c1f9d4e","https://wordwright.ink/t/7c1f9d4e2b6a084f35d0c8e1a9b27d63/welcome-doc",1,0.004947,"2026-09-08T11:58:00.000Z"
"2026-09-08","Katherine Johnson","katherine@example.com","3f8b2c17","https://wordwright.ink/t/3f8b2c17d94e60a5b1c7e2f04a86d9b3/welcome-doc",0,0.000000,""
"2026-09-07","(hand-minted or unknown)","","00000000","",1,0.051150,"2026-09-07T22:10:00.000Z"
```

Note the third row: a claim with no calls is a row, not a gap — "signed up and never
came back" is a fact worth seeing. The unaccounted section is the smoke detector
with names attached, kept separate because "a namespace nobody can account for is
spending money" is a different fact from "a person is". `00000000` there is the
local development namespace, which is exactly what that section is for.

An empty or missing registry exits 0 with a calm message, verified.

---

## 3. One claim, end to end

Driven in headless Chromium against the real server on loopback
(`PLAYWRIGHT_BROWSERS_PATH=0`, disposable script since deleted).

1. **The form.** `http://127.0.0.1:3000/` served the landing page —
   `document.title` "WordWright", the lockup, the three ratified paragraphs, four
   inline Allison wordmarks, the name/email fields, the disclaimers, footer
   `WordWright v0.1.2`. Typed "Ada Lovelace" / "ada@example.com", clicked Start
   writing.

2. **The registry row.** One line appended to `claims.jsonl`:

   ```json
   {"at":"2026-09-08T12:25:34.811Z","name":"Ada Lovelace","email":"ada@example.com","token":"…"}
   ```

   Full token, one row, nothing else written.

3. **The seed document.** Read back through the ordinary API at
   `/api/t/{token}/documents/welcome-doc`: `history.length === 1`, `turn_id: 1`,
   `author: "human"`, `draft === history[0].snapshot` (§0.3 from turn one), first
   line "Welcome to WordWright. This app exists to enable and enforce human
   judgment across all the writing you do with AI.", last line "Happy Writing!".

4. **The success view.** The absolute URL in the bordered block, Copy link putting
   exactly that string on the clipboard, `KEY_DISCLOSURE` beside it, Start writing
   pointing at the same URL.

5. **Following it.** Start writing loaded the app on the new namespace: the
   document-name button reading `welcome-doc`, the seed text in the editor with its
   five bold labels as `<strong>` elements, the history open below it (chunk 14)
   with one HUMAN turn whose diff is the whole document as an insertion, and no
   link where `wordwright.ink/view` appears — the §0.1 no-autolink rule holding on
   real stored content.

Screenshots of all three screens were taken and read.

---

## 4. Mutation checks

Nine mutations, applied to the real files, run, reverted. Eight were caught
immediately; the ninth was not, and fixing that gap changed the code.

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 1 | limiter counts requests instead of claims | `the sixth claim…` + `an invalid submission…` | `AssertionError [ERR_ASSERTION]: claim 3 of 5` |
| 2 | leftmost `X-Forwarded-For` hop | `the address is the RIGHTMOST forwarded hop…` | `AssertionError: Expected values to be strictly equal:` (`9.9.9.9` ≠ `203.0.113.7`) |
| 3 | registry stores an 8-char prefix | `the registry keeps the WHOLE token…` + `two claims are two namespaces…` | `AssertionError [ERR_ASSERTION]: the full token is in the registry` |
| 4 | registry write rethrows | `a registry write never throws…` | (the raw `Error` propagates out of `recordClaim`) |
| 5 | seed writes two turns | `a claim mints a namespace whose default document holds exactly one seed turn` + the endpoint test | `AssertionError [ERR_ASSERTION]: exactly one turn — no synthetic history` |
| 6 | a token put into the `/` fallback text | **nothing** — see below | — |
| 7 | `wordmarked()` drops the name it marks up | `the landing page carries the ratified copy, verbatim` + the wordmark test | `AssertionError: missing: Welcome to WordWright. This app exists to enable…` |
| 8 | success view shows a relative address | `a successful claim shows the whole link…` | `AssertionError: Expected values to be strictly equal:` (`/t/…/draft` ≠ `https://wordwright.ink/t/…/draft`) |
| 9 | `/` removed from `isClientPath` | `/ is a client path and nothing else is mistaken for it` | `AssertionError: Expected values to be strictly equal:` |

**Mutation 6 is the finding, and it is F89 wearing a different hat.** I put the
default token into the no-build text at `/` and every test stayed green — because
in a built tree `/` serves the landing bundle and the fallback string is never
reached. The assertion that should have caught it was fetching `/` and therefore
testing a different response than it thought. In CI, where `client/dist` does not
exist, the same test would have caught it: the test's MEANING depended on build
state, which is precisely the asymmetry F89 was raised about.

Fixed in the code rather than only in the test: the text is now an exported
`NO_BUILD_NOTICE` constant, asserted directly for "no 32-hex, no Cannot GET, says
what to run". Re-run under the mutation it fails with `no token in the fallback`.

Two more against the revisions in Part 2a, both caught:

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 10 | bold removed from the five section labels | `a claim mints a namespace whose default document holds exactly one seed turn` | `AssertionError [ERR_ASSERTION]: Working Together is a bold label in the store` |
| 11 | `SEED_SLUG` back to `'draft'` | same test | `AssertionError: Expected values to be strictly equal:` (`draft` is not `welcome-doc`) |

Final state re-verified on the reverted tree: 474/474, smoke passes, build succeeds.

---

## 5. Changes to shared artifacts

**No §5 fixture was read or written.** No change to the turn model, the storage
layer, the export format, the AI path, or namespace resolution — `src/claims.js`
calls those functions and modifies none of them. `scripts/spend-report.js` is
untouched.

Test counts: 442 → **474**, all new (23 claims, 9 landing). Two existing tests were
edited, both for `/`:

- `F37: '/' never sends a person to a page that will refuse them` — rewritten. The
  guarantee got **stronger**: it used to assert a 302 locally and a 404 explainer
  remotely; it now asserts that `/` never redirects on either binding and leaks no
  token in either answer, without depending on the build state.
- `/view cannot collide with a document address or with the API` — `/` moved out of
  its "not a client path" list, with a pointer to where it is now asserted.

**§0 is byte-identical**, verified by diff.

CLAUDE.md: §12b added, the Report naming rule added to the Operating rules, step 15
inserted with 16–19 renumbered, the state line updated, the renumbering note
extended, and the three downstream references chased (§10's step number, F87's
block, §12a's forward reference).

---

## 6. Findings

- **N1 — `/` no longer redirects locally.** Section 2 Part B. A deliberate
  regression in a developer convenience, taken so the front door is testable where
  it is built. The startup log still prints the development link.

- **N2 — the rate limit is per-process and Railway may run more than one.** Five an
  hour per address becomes five per address per instance. It is friction, and §12b
  says so, but the number in the spec is not the number a second instance would
  enforce. Worth knowing before it is quoted as a guarantee.

- **N3 — nothing verifies an email address, so the registry will contain junk.**
  By design (§12b), and the pattern is deliberately loose. The consequence is that
  `users-report` is a list of what people typed, not a list of reachable people,
  and the first time it is used to email anyone that difference will be discovered.

- **N4 — a claim is not idempotent, and a refresh on the success view loses the
  link.** The token is in component state and the URL does not change, so a reload
  returns to an empty form. The registry has the link and the operator can recover
  it, which is precisely why the registry keeps whole tokens — but the visitor
  cannot, and `KEY_DISCLOSURE` telling them to bookmark it now is the only thing
  standing between them and a lost namespace. The cheap fix is pushing the address
  into `history` on success; I did not do it because it would make the landing
  page's URL a capability URL, and that deserves a decision rather than a reflex.

- **N5 — nothing rate-limits by anything but address.** One person on one
  connection can make five namespaces an hour, indefinitely, and each seeds a
  document on the volume. The Console cap bounds the SPEND, not the disk. At this
  scale it does not matter; it is the kind of thing that matters suddenly.

- **N6 — the landing page has no link to `/view`.** Chunk 14's N7, unchanged and
  now more visible: there is a public page a stranger can reach, and it does not
  mention the other public page. Still outside this brief's touch list.

- **N7 — `claims.jsonl` has no rotation and no size bound**, the same shape as F92
  for the usage ledger. Irrelevant at this scale, real beyond it.

- **N8 — source comments say "§14" where the spec section is §12b.** Section 0.
  Cosmetic, and worth a sweep.

---

## 7. What was NOT verified

- **The deployed instance.** Everything here ran locally. `/` on wordwright.ink
  still serves the old plain-text explainer until this is ratified and pushed, and
  the claim endpoint does not exist there yet. The first real signup is the test
  this report cannot perform.
- **The rate limit through Railway's proxy.** `clientAddress` takes the rightmost
  `X-Forwarded-For` hop, which is correct for exactly one trusted proxy. Whether
  the deployment has exactly one, and what it sets, is asserted nowhere — it is
  inferred from how proxies behave. Worth one check with `curl` after deploy: two
  claims from one machine should both succeed, and the report should not show the
  proxy's own address governing everyone.
- **Any browser but Chromium**, and any viewport but 1280×1000. The landing form's
  behaviour on a narrow screen — where the three flex children wrap — was not
  looked at.
- **The clipboard on a real page.** The copy button was exercised through an
  injected clipboard in tests and not clicked in the browser run; `navigator.clipboard`
  requires a secure context, and `http://127.0.0.1` counts as one, but that is a
  claim about Chromium's rules rather than an observation.
- **Email deliverability, spam, and abuse in practice.** No verification, no
  captcha, no blocklist. The first day this is public is the measurement.
- **What happens when the volume is full.** `claimNamespace` throws, the visitor
  gets the 500, and nothing is written — but that path was reasoned about, not
  exercised.

---

## 8. Layout fixes

> The interface decisions in §§8–10 and Part 2a are told as one story, with the
> reasoning rather than the evidence, in `reports/mini-ui-updates.md`. This file
> stays the record: measurements, test counts and mutations live here.


A fenced fix pass over the uncommitted chunk, after walking the built flow. Four UI
changes, no server code, no routing, no seed content. §12 is amended to match.

### What moved

**Show/Hide History left the top row for the History section's own heading**, sitting
immediately to the right of the word *History*. Two consequences, both load-bearing
and both now asserted:

- **The history's HEADING always renders; only the log collapses.** A toggle inside
  the thing it toggles would vanish with it and leave no way back. `History` takes
  `open` and `onToggle`; the section is mounted unconditionally, and the turn list
  plus the "N turns, newest first" line are what hide.
- **The count is back on the control** — `Hide History (12)` / `Show History (12)`.
  **This resolves F50** ("the history toggle lost its turn count"), open since chunk
  10. It has to be on the button rather than in the heading's hint, because the hint
  is part of what collapses: hidden, the button is the only thing left saying how
  much record there is.

**Checkpoint left the top row for the editor's bottom-right**, parallel to the
Prompt box's Submit — each surface's commit action at its own bottom-right. The
dirty signal travelled with it unchanged: the `checkpoint-marked` class, the `•`
marker, and the `aria-label` that says "you have uncommitted hand edits" are all on
the moved button, which is what §12 requires now that there is no status row.

*(This landed sticky and was then reversed on sight — see §9, the commit-group pass
below, which is the current behaviour.)*

**The `View WordWright Doc` anchor matches the buttons' anatomy.** It was a few
pixels taller: a `<button>` defaults to `line-height: normal` while an `<a>`
inherited the body's 1.6. Both sides are now pinned at 1.2 and the anchor is
`inline-flex` with centred items, which is how a button centres its own label. All
four controls measure **28px** in the browser.

**Button labels are Title Case everywhere** — top row (`+ New Document`,
`Export Transcript`, `View WordWright Doc`), the history's per-turn controls
(`Restore to This Turn`, `Open Turn 1 Read-Only`, `Hide Turn 1`), the link toolbar
(`Set`), the landing and success pages (`Start Writing`, `Copy Link`,
`Making Your Workspace…`), and the viewer's picker (`Open a Transcript`,
`Open a Different Transcript`). Labels only: no route, id, or body copy changed.
The document-name button is exempt — it is a slug the human typed, and §0.5
lowercases it.

### The sticky mechanism

The draft and the history were two grid items in column 1. `position: sticky` only
holds an element inside its own containing block, so a bar inside the draft would
have scrolled away the instant the history came into view — the §12/F65 reachability
failure, in the other column.

So the two are wrapped in one flex column, **`.editor-column`**, with the Checkpoint
bar as its last child at `position: sticky; bottom: 0`. The wrapper is the grid item
now and carries `grid-column: 1`, which is where the chunk-08 guarantee attaches:
nothing on this side may spread under the sticky rail. It is the same trick the rail
uses with `grid-row: 1 / -1`, done with a wrapper because these two are stacked
rather than spanning.

The bar is a full-width band with the paper background and a hairline top border
rather than a floating pill, so text it passes over is covered cleanly instead of
showing through. `margin-top: auto` puts it at the foot of the column when nothing
is scrolling at all.

**Measured in a real browser**, on the 19-turn local document (page height 11,441px,
viewport 900px):

| scroll position | scrollY | Checkpoint on screen | clickable | overlaps the rail |
| --- | --- | --- | --- | --- |
| top | 0 | yes (860–892) | yes | no |
| mid-history | 5,721 | yes (860–892) | yes | no |
| bottom | 10,541 | yes (753–785) | yes | no |

"Clickable" is `document.elementFromPoint` at the button's centre returning the
button — a control that is visible but covered would pass a bounding-box check and
fail this one.

The dirty signal was checked the same way: typing into the editor flipped the moved
button to `checkpoint-marked`, added the `•`, and changed its `aria-label` to
"Checkpoint — you have uncommitted hand edits".

### Verification

`npx vite build`, `npm test` **477 pass / 0 fail**, `node scripts/smoke-session.js`.

Twenty-one existing tests failed on the first run and every one was a label or a
location this pass deliberately changed; each was updated to assert the new home
rather than relaxed. The top-row test now also enforces Title Case as a RULE over
whatever controls are in the row, so a future control cannot arrive in sentence
case, and it asserts the history toggle is *not* in the top row.

Four mutations, three caught immediately:

| # | what I broke | what failed |
| --- | --- | --- |
| 15 | the toggle hides with the log it toggles | `the count is still legible while hidden` |
| 16 | the count comes off the toggle (F50 again) | `§4 the history is toggleable…` |
| 17 | `position: sticky` removed from the bar | **nothing** — see below |
| 18 | the dirty class and dot dropped from the moved button | `marked when hand edits are unratified` |

**Mutation 17 is the finding.** Removing the sticky broke the one constraint the
brief called load-bearing and the suite stayed green, because jsdom has no layout
and nothing asserted the rule. Fixed by pinning it against the stylesheet source in
the same form the rail's reachability is pinned (`§12 Checkpoint stays reachable at
any scroll depth in the editor column`): sticky, `bottom: 0`, an opaque background,
the wrapper's `grid-column: 1` and `display: flex`, and `not fixed`. Re-run under
the mutation it fails on `position: sticky`. The behaviour itself is browser-measured
above, as the rail's is.

### Findings

- **F50 is resolved** and should come off §13's open list at ratification. It is
  listed there as still open from chunk 10.
- **The sticky bar covers a band of the history while scrolling.** Unavoidable for
  a control that must be reachable at any depth without being a fixed overlay, and
  it is opaque by design so nothing shows through — but it is roughly 50px of the
  viewport bottom that content passes under. §12 forbids overlaying *the draft*
  with a modal; this is a bar at the column's foot, not over the draft, and it
  scrolls with the column's end.
- **Title Case was applied by hand, control by control.** There is no lint for it.
  The top-row test enforces the rule for that row only; the panel, history and
  landing labels are asserted as literals, so a new button elsewhere can still
  arrive in sentence case.

---

## 9. The commit group

A second look at the layout, after seeing it running. Three changes, one idea: the
bottom-right button of a surface is that surface's commit mechanism, and the three
of them should read as one group that is visibly not the lilac navigation.

### Checkpoint is no longer sticky

**Reversed on sight, one section after shipping it.** §8 pinned the bar to the
bottom of the viewport so it was reachable from anywhere in the column. Seen
running, that trade was wrong: it bought reachability for a control you meet once
per checkpoint by spending a band of the viewport for the whole session, held over
a record it has nothing to do with. Floating, it read as a page-level toolbar
rather than as the draft's own commit.

It now sits directly under the editor box, right-aligned, and **above the rule that
opens the history** — inside the draft's territory, which is itself part of saying
what it commits. `.draft-commit` is a plain flex row: no `position`, no z-index, no
background band. In the DOM it is the middle child of `.editor-column`, between the
draft and the history.

`.editor-column` stays, and is still what carries `grid-column: 1` — the chunk-08
guarantee that nothing on this side spreads under the sticky rail now attaches to
the wrapper. It is no longer load-bearing for stickiness, because nothing is sticky.

### One green, three buttons

| surface | control | what it commits |
| --- | --- | --- |
| Prompt box | Submit | the prompt |
| Standing Rules | **Add** — was white on a hairline border | a standing rule |
| the editor | **Checkpoint** — was lilac | the draft |

The treatment is **declared once**, in one grouped selector, rather than three times:

```css
.submit,
.rule-submit,
.checkpoint { … background: var(--accent); color: #fff; … }
```

The class names survive as identity hooks, so existing selectors and tests keep
working, but there is one place the green lives. Measured in the browser, all three
now report `rgb(47, 93, 80)`, white text, 13.6px, `6.4px 14.4px` padding, 4px
radius, and **37px tall** — identical.

Two consequences of Checkpoint changing colour, both handled:

- **The dirty marker is white now**, not `--lilac-deep`. It sits on the accent fill
  and has to be legible against whatever it sits on; it is the only thing on screen
  saying that what you typed is not yet a turn.
- **`.checkpoint-marked` is a bright edge on the same fill** rather than a
  different colour. The button's job has not changed — only whether something is
  waiting to be committed.

§12's Button semantics rule is widened to match: forest green is no longer "the
primary action inside a box (Submit)" but "the commit action of a surface, at that
surface's bottom-right", with the three named in a table and the one-selector rule
written down.

### Verification

`npx vite build`, `npm test` **478 pass / 0 fail**, `node scripts/smoke-session.js`.

The sticky test from §8 was **replaced, not relaxed** — it asserted a requirement
that no longer holds. The new pair asserts what does:

- `§12 Checkpoint sits under the editor, above the history, and does not float` —
  DOM order of `.editor-column`'s children (draft before commit before history),
  `justify-content: flex-end`, and no `position: sticky|fixed|absolute`.
- `§12 the three commit actions are one treatment, declared once` — the grouped
  selector exists and is green, neither `.rule-submit` nor `.checkpoint-marked`
  carries a divergent white fill, and `.top-button` is not green, which is the
  split holding in the other direction.

Four mutations, all caught:

| # | what I broke | what failed |
| --- | --- | --- |
| 19 | Checkpoint rendered below the history again | `and BEFORE the history — the separator that opens the record is below it` |
| 20 | `.checkpoint` dropped from the grouped selector | `the three share a single selector` |
| 21 | `position: sticky` put back on the bar | `it does not float` |
| 22 | Add given a white fill again | `.rule-submit has no white fill` |

### Findings

- **§8's sticky work is now dead weight in the report but not in the code.** The
  `.editor-column` wrapper it introduced is kept, because it is the grid item that
  carries the chunk-08 column pin. Nothing else survives from that attempt. §8 is
  left as written, with a pointer here, rather than rewritten — the sequence is
  the record.
- **Reachability was traded away deliberately.** Checkpoint is no longer reachable
  while reading deep in the history; committing after a long read means scrolling
  back up. That is the cost of the reversal and it was the human's call on seeing
  it. If it bites, the fix is not stickiness — it is that Checkpoint belongs where
  the draft is.
- **`.rule-submit` grew from 0.8rem to 0.85rem** joining the group. It shares a
  row with a text input in the 22rem rail; it fits, but the rules box is the
  densest surface and this is the control most likely to feel large there.

---

## 10. The history above the fold

One more pass, on the same complaint from the other side: with Checkpoint no longer
sticky, the History section sat below the fold at every viewport, so the record was
something you had to know about and go looking for. That is the wrong barrier in
front of the feature the product is for.

### What was wrong, measured

Before: the History heading landed at y=954 (800px viewport), 973 (900), 1033
(1000), 1093 (1100) — always about 150px below the fold. Consistently, and only
just: the worst case, since nothing on screen suggested there was anything under it.

The furniture above and below the editor is fixed at every viewport — masthead 260px,
toolbar 32, Checkpoint row 37, plus margins, about 433px in total — and does not
scale. So the editor was the only variable, and at `min-height: 60vh` it grew with
the screen at exactly the rate that kept the history out of sight.

### Why `min-height` alone could not fix it

The first attempt reduced the minimum. It changed nothing on the real document,
because **a draft with text in it is as tall as its text** — `min-height` is not
binding on any document anyone has actually written. Measured: the editor stayed at
520px across three viewport heights while the minimum moved underneath it.

So the editor is now **capped and scrolls inside itself**:

```css
min-height: max(18rem, calc(100vh - 36rem));
max-height: max(18rem, calc(100vh - 36rem));
overflow-y: auto;
```

`calc(100vh - <length>)` because the furniture is a length, not a fraction. The
`max()` floor keeps a usable writing surface on a short screen, where showing the
record would cost more than it is worth.

**The cost is a second scroll region on the page**, and that is a real change to how
the editor feels — taken deliberately, because it is the only mechanism that keeps
the promise for a long draft as well as a new one. The browser follows the caret
inside a scrolling box, verified: typing at the very end of the draft left the caret
at y=482 inside a box spanning 328–652.

### After, measured

| viewport | editor | History heading | first turn |
| --- | --- | --- | --- |
| 800 | 288 (floor) | 721 | 795 |
| 900 | 324 | 757 | 831 |
| 1000 | 424 | 857 | 931 |
| 1100 | 524 | 957 | 1031 |

At 900 and above the heading, the `Hide History (N)` control, the "N turns, newest
first" line, and the newest turn's whole header row — badge, turn number, timestamp,
Restore — are above the fold. At 800 the floor takes over and the heading plus its
count still show. The editor's bottom edge cuts a line of text mid-height, which is
the scroll cue.

### Verification

`npx vite build`, `npm test` **479 pass / 0 fail**, `node scripts/smoke-session.js`.

One test added, `the history is on screen at first paint, without scrolling`, pinned
against the stylesheet because jsdom has no layout: the cap and `overflow-y` exist,
the bounds are `calc(100vh - <rem>)` rather than a bare `Nvh`, and the floor is
there. Mutation 23 removed the cap — leaving the min-height that looks like it
should work — and it fails on `the editor is capped`, which is the exact mistake the
first attempt made.

### Findings

- **The masthead is 260px of the budget**, most of it the wordmark and the
  four-line capability paragraph. Every pixel of it comes out of either the writing
  surface or the record. §0.5 requires that paragraph on the surface and §12 pins
  it there, so it stays — but it is the largest single input to this arithmetic and
  worth knowing before anyone tunes the `36rem`.
- **`36rem` is measured, not derived.** It comes from the furniture at the current
  masthead height. If the masthead changes, this number is wrong and the symptom is
  the history drifting back under the fold — which nothing will catch automatically,
  since the test asserts the shape of the rule and not the outcome. A browser
  assertion would catch it; committed browser tests are still not in this repo.
- **Two scroll regions.** Scrolling over the editor scrolls the editor until it
  bottoms out, then the page. Standard behaviour, and the thing most likely to feel
  unfamiliar in this pass.

---

## 11. Pre-commit fixes

Three defects found by review of the uncommitted chunk. All three were in code
nothing had exercised end to end: the operator report had no tests, and the spec
references were written before the section was numbered.

### 1. The recovery link pointed at a document that does not exist

`scripts/users-report.js` built its link as `${SITE}/t/${token}/draft`. Claimed
namespaces have no document at `draft` — the seed lives at `SEED_SLUG`
(`welcome-doc`), decided in Part 2a — so every link in the operator's table opened
"there is no document called draft yet".

This is the failure that matters most in that file. The registry keeps whole tokens
for exactly one purpose: handing someone their link back when they have lost it, at
which point a link to a missing document is the worst available answer.

Now `${SITE}${documentAddress(row.token, SEED_SLUG)}` — composed through §0.5's own
address function rather than by hand, and imported from the module that decides the
slug rather than retyped. The sample output above is regenerated from the fixed
script, not hand-edited.

### 2. CSV formula injection from public-form data

`name` and `email` arrive from a form anyone on the internet can post to, and
`--csv` exists to be opened in Excel or Sheets. A value beginning `=`, `+`, `-` or
`@` is a **formula** to those programs. `field()` quoted and escaped, which does not
help at all: CSV quotes are syntax and are stripped before the cell is evaluated, so
a name of `=HYPERLINK("http://evil","click me")` became a live link in the
operator's spreadsheet.

`field()` now prefixes a single apostrophe when the value opens with a trigger,
**after any leading whitespace** — ` =CMD()` is evaluated exactly as `=CMD()` is.
Every field that can carry claim-supplied data goes through it.

The other half of the fix is what it must NOT do: `calls` and `usd` are emitted raw
and unquoted, so a negative figure stays a number a spreadsheet can sum, and dates
begin with a digit and are never armed. An `@` *inside* a value — every email
address — is untouched; only a leading one triggers.

### 3. Spec references said §14; the section landed as §12b

The code was written while the section was still expected to be `## 14`. It landed
as `## 12b`, following chunk 14's precedent of lettered insertions before Open
items, and the comments were never chased. Twenty-one references across twelve
files, all of them comments, corrected to §12b.

Client files are in that set. The brief fenced off client code and also asked for
"anywhere else §14 refers to the front door"; a comment is not code, and leaving
`client/src/Landing.js` pointing at a section that does not exist would half-do the
task. No client behaviour, markup or styling changed — `npx vite build` was not
needed and was not run for this pass.

### Verification

`npm test` **484 pass / 0 fail** (five added), `node scripts/smoke-session.js`.

`test/users-report.test.js` is new: the script has no exports, so it is run as a
subprocess against a temp documents root and asserted on its stdout — which is also
the right level, since the two defects are about what a person reads and what a
spreadsheet does.

| # | what I broke | what failed |
| --- | --- | --- |
| 24 | the link back to `/draft` | `the recovery link names the document a claimed namespace actually has` |
| 25 | `field()` back to quote-only | `neutralised, with the value preserved: =HYPERLINK("http://evil","click me")` |
| 26 | arming stopped skipping leading whitespace | `neutralised, with the value preserved:    =cmd\|' /c calc'!A1` |
| 27 | `calls` and `usd` passed through `field()` | `ordinary values are not mangled: numbers stay numbers, dates stay dates` |

The hostile-name test also sweeps **every** emitted field in the file for an unarmed
trigger, not only the ones it wrote, so a future column carrying claim data cannot
slip through.

### Findings

- **The operator report had no tests until now**, which is how both of its defects
  survived being written, read and sampled in a report. It was the one piece of this
  chunk with output nobody asserted.
- **The `-` trigger arms legitimate values too.** A name beginning with a hyphen
  gets an apostrophe in the CSV. That is the correct trade — a spreadsheet cannot
  distinguish them either — but it means the CSV is not a byte-faithful copy of the
  registry. The registry is.
- **`WORDWRIGHT_ORIGIN` still defaults to the production host.** Running the report
  against a local root prints `https://wordwright.ink` links for locally claimed
  namespaces, which are dead. Correct for the operator, confusing in development.
