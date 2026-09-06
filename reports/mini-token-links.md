# Mini-chunk: new-token.js prints ready-to-send links

**Status: complete.** `npm test` (422 pass, 0 fail) and
`node scripts/smoke-session.js` (6 turns, 38 assertions) both pass. Nothing
committed or pushed.

---

## 0. A correction to the brief, before anything else

**The brief's premise is wrong about the current state.** It says
`scripts/new-token.js` "currently prints a bare token". It has not done that
since chunk 13 — it already printed a token plus a `local` link and a `deployed`
link, and already had test coverage in group 6 of
`test/deploy-readiness.test.js`.

Named here rather than filed as a finding at the end, because it changes what
the work actually was. Not "add links to a script that has none", but three
specific edits to a script that already had them:

1. the deployed origin changes from
   `https://hybridwritingide-production.up.railway.app` to
   `https://wordwright.ink`,
2. that label changes from `deployed:` to `ink:` and gains an explicit
   send-this-one mark,
3. the two origins, which were two separate constants, become one list.

Every requirement in the brief is satisfied; the report just describes what
changed rather than repeating the premise. No §0 decision was touched, so this
did not meet the stop-and-report bar — §0.5 says a token is 32 hex characters
handed to one person as part of their URL, and that is exactly as true after
this as before.

---

## 1. What was built, file by file

### `scripts/new-token.js`

**The hostname list is now one constant**, replacing `DEPLOY_ORIGIN` and
`LOCAL_ORIGIN`:

```js
const HOSTS = [
  { label: 'local', origin: 'http://localhost:3000' },
  { label: 'ink', origin: 'https://wordwright.ink', send: true },
];
```

Three things about that shape, each of them load-bearing:

- **The label travels with the origin it names.** They were two constants and
  two `console.log` calls, which is two places for a label and a host to drift
  apart into a line that says `local` beside a deployed URL.
- **Array order IS output order**, so "ink last" is a property of the data, not
  of the sequence of print statements. Reordering the list reorders the output;
  there is no second place to keep in step.
- **`send: true` marks the sending link**, for the same reason. A mark applied
  by the printing loop cannot land on the wrong row, because it is read off the
  row it is printing.

The printing loop pads each label from the longest label in the list rather than
to a hardcoded width, so adding a longer host later realigns the block instead of
ragging it.

**The token line is untouched**, deliberately: `\ntoken: ${token}\n`, exactly the
bytes it has always been. Anything parsing this output looks for
`token: <32 hex>` and keeps working.

**`--base` is preserved.** It replaces the whole list with a single `link:` row
and prints no send-mark — there is nothing to disambiguate when there is one
link. Its label lost its old internal padding (`link    :` → `link:`) so it
follows the same label-then-pad rule as the other rows; that is the one
behavioural change here nobody asked for, and it is cosmetic.

### `test/deploy-readiness.test.js` (group 6 only)

The file's module-level `DEPLOY_ORIGIN` constant becomes `SEND_ORIGIN` and
`LOCAL_ORIGIN`, both still written as literals rather than imported from the
script — the comment now says why, which it did not before. The script has no
exports, but even if it did, importing the constant would only assert that the
script agrees with itself. A hostname is the one thing here a human has to type
correctly, so it is typed twice and the test fails when the two copies disagree.

One existing test rewritten, three added, one updated:

| test | what it pins |
| --- | --- |
| `§0.5 minting prints one full link per host, same token in every one` | rewritten: asserts each URL **whole** (`origin + /t/ + token + /draft`) instead of by `startsWith`, since a link is copied entire and a doubled slash or a missing slug is the same failure as a wrong host |
| `the token stands alone on its own line, ahead of every link` | **new**: `/^token: [0-9a-f]{32}$/` anchored at both ends, plus that it precedes the links |
| `the sending link is last and says so; the local one carries no such mark` | **new**: exactly two host rows, `local` first, `ink` last, the mark on ink and *not* on local |
| `the two links align, so a wrong one is visible as a ragged line` | **new**: both URLs start at the same column |
| `--base overrides the host list…` | updated for the new label, and now also asserts no send-mark appears |

Group 6 goes from 3 tests to 6.

---

## 2. Sample output

Verbatim, from `node scripts/new-token.js`:

```
token: ade0a1cbec2b68402f238dbf69ada743

local: http://localhost:3000/t/ade0a1cbec2b68402f238dbf69ada743/draft
ink:   https://wordwright.ink/t/ade0a1cbec2b68402f238dbf69ada743/draft   ← send this one

Anyone holding that link has full read and write access to every document
in that namespace, and there is no way to revoke it short of moving the
files. It is a filing system for people you know, not access control —
say so when you hand it over.
```

And the `--base` path, unchanged in spirit:

```
token: a95c2261ace234d50652eff3fd7bda9d

link: https://staging.example.app/t/a95c2261ace234d50652eff3fd7bda9d/draft
```

The §0.5 disclosure still rides along on both. That is not decoration: §0.5
requires a namespace "be described that way to anyone given a link", and the
person handing it over is the one who needs the words in front of them.

---

## 3. What was verified, and how

### Test groups

| group | tests | result |
| --- | --- | --- |
| `deploy-readiness` group 6 — the minted link | **6** | 6 pass |
| `deploy-readiness`, whole file (groups 1–6) | 26 | 26 pass |
| whole suite, `npm test` | 422 | **422 pass, 0 fail** |

422 is 419 + the three added here. No other test file was touched, and no
existing test needed changing beyond group 6 — nothing else in the repo reads
this script's output.

### `node scripts/smoke-session.js`
6 turns, 38 assertions, pass. Unrelated to this script; run as the regression
check the operating rules ask for after every chunk.

### The link actually resolves
`curl https://wordwright.ink/health` → **HTTP 200 in 0.07s**, body
`{"status":"ok","version":"0.1.0"}`.

Worth the one request: the whole point of this change is that the printed link
gets handed to a person, and a script that confidently prints a dead hostname is
worse than one that prints nothing. `/health` is the right probe — it is
unauthenticated by design (F93) and carries no token, so nothing about a
namespace was exposed to check it. It confirms the domain is wired to the
deployment and that the deployment is the app at 0.1.0.

### Old host string
`grep` across the repo for `hybridwritingide-production` and `railway`: the URL
survives only in `reports/`, which is history and correctly frozen. `CLAUDE.md`
and `CHANGELOG.md` name Railway as the *platform*, which is still accurate — the
custom domain fronts it. No stale copy of the old URL remains in any code path.

---

## 4. Mutation checks

Six mutations, each applied to `scripts/new-token.js`, run, and reverted. All six
were caught. The full file was restored and re-run at the end: 26/26.

| # | what I broke | what failed | exact message |
| --- | --- | --- | --- |
| 1 | swapped the list so `ink` is first | `the sending link is last and says so…` | `AssertionError [ERR_ASSERTION]: local first` |
| 2 | moved `send: true` onto the local row | same test | `AssertionError [ERR_ASSERTION]: the ink link is marked as the one to send` |
| 3 | typo'd the host: `wordwright.inc` | `§0.5 minting prints one full link per host…` | `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` (actual `https://wordwright.inc/t/…`) |
| 4 | appended the ink link to the `token:` line | `the token stands alone…` **and** `§0.5 every mint is a different token…` | `AssertionError [ERR_ASSERTION]: the token line carries the token and nothing else` |
| 5 | dropped `${DEFAULT_SLUG}` from the composed URL | `§0.5 minting prints one full link per host…` **and** `--base overrides the host list…` | `AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^link: https:\/\/staging\.example\.app\/t\/[0-9a-f]{32}\/draft$/m` |
| 6 | padded each label to its own length, ragging the columns | `the two links align…` | `AssertionError [ERR_ASSERTION]: the URLs start at the same column` |

Two of these are worth calling out.

**Mutation 4 caught by two tests** is the good kind of redundancy: the new
anchored token-line test caught it directly, and the pre-existing
different-token-every-mint test caught it as collateral, because its
`/^token: ([0-9a-f]{32})$/m` stopped matching. The old suite would have caught a
polluted token line by accident. It now fails by design, with a message that
says what is wrong.

**Mutation 5 was NOT caught by the `local`/`ink` shape assertions alone** — it was
caught by the whole-URL equality and by the `--base` regex. This is the mutation
that justifies rewriting the first test from `startsWith` to full equality: the
old prefix check would have passed a link missing its slug, which is a link that
404s for the recipient.

---

## 5. Changes to shared artifacts

**None.** No §5 fixture was read or written. `src/`, `client/`, `scripts/serve.js`
and `CLAUDE.md` are untouched, as the brief required — verified by `git status`:

    M scripts/new-token.js
    M test/deploy-readiness.test.js
    ?? reports/mini-token-links.md

(The working tree also carries the separate, still-uncommitted WordWright header
mini-chunk — `client/index.html`, `client/src/App.js`, `client/src/styles.css`,
`client/src/fonts/`, `reports/mini-header.md`. Nothing here touched any of them.)

No dependency added.

---

## 6. Findings

- **N1 — the brief's premise was wrong about the current state.** Section 0
  above. The script already printed links; this changed the host, the label and
  the shape of the constant. Recorded because a brief written from a stale
  picture of a file is worth noticing once, and because "add links" and "change
  the host these links point at" have different risks — the second one silently
  invalidates every link minted before it.

- **N2 — the Railway origin is now unreachable from the script.** `--base` is
  the only way to mint a link at `hybridwritingide-production.up.railway.app`.
  That is correct if `wordwright.ink` is the permanent front door and Railway is
  an implementation detail underneath it, which the 200 from `/health` is
  consistent with — but if the custom domain ever lapses, tokens minted in the
  meantime name a host that no longer answers, while the namespace itself is
  perfectly fine on disk. The token is the durable thing; the hostname is not.

- **N3 — the send-mark is a Unicode arrow.** `← send this one`. Fine in every
  terminal this will realistically run in, and the tests match on the arrow, so
  a terminal that cannot render it would still pass a suite while showing the
  human a mojibake line. Convenience, not spec conformance; noted rather than
  fixed.

- **N4 — `--base`'s label padding changed** from `link    :` to `link:`. Nobody
  asked for it; it follows from applying one padding rule to all rows instead of
  hand-spacing each one. The test was updated to match, which means the test was
  updated to match a change I made rather than a requirement — said plainly here
  because that is the shape of a test rewritten into agreement with a bug, and
  the only defence against it is saying so.

---

## 7. What was NOT verified

- **That a minted token actually opens a document on `wordwright.ink`.** The
  health probe proves the host answers and is running this app. It does not prove
  the link shape resolves there, which would mean fetching a real capability URL
  against the live deployment. Not done: it would create a namespace on the
  deployed volume as a side effect of a test, and §0.5's first-visit behaviour is
  already covered against a local server in group 6's neighbour test.
- **The output in a terminal that is not this one.** Column alignment is asserted
  in characters, not in rendered width, so a proportional-font terminal would ruin
  the alignment without failing anything. Not worth solving; noted.
- **Anything about `serve.js`, `src/`, or the client.** Untouched by instruction,
  and the whole suite passing is the evidence they stayed that way.
