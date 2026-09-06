# Mini-chunk: site header rebrand to WordWright

**Status: complete.** `npx vite build`, `npm test` (419 pass, 0 fail) and
`node scripts/smoke-session.js` (6 turns, 38 assertions) all pass. Nothing
committed or pushed.

---

## 1. What was built, file by file

### `client/index.html`
`<title>Co-writing draft</title>` → `<title>WordWright</title>`. One line. The
favicon data URI, the `noindex` and `no-referrer` metas are untouched — none of
them carries the product name.

### `client/src/App.js`
Two edits, both inside the page shell:

- **The masthead.** `h('h1', …, 'One draft, two hands')` becomes
  `h('h1', …, 'WordWright')` followed by
  `h('p', {className: 'wordmark-subtitle'}, 'Enabling Human Judgment')`. Two
  elements rather than one, so the two faces are declared separately and the
  subtitle is a thing a screen reader reads on its own rather than a styled
  fragment of the heading. It sits above `topBar`, where the old `h1` sat; §0.5's
  capability disclosure is still the paragraph below the top row, unmoved and
  unedited (F51 stays resolved).
- **The version line.** `version ${version}` → `WordWright v${version}`, and the
  failure string `version unavailable` → `WordWright — version unavailable`. The
  number itself is unchanged in provenance: still `useState(null)` filled from
  `/health`, which returns `APP_VERSION` from `src/version.js`, which reads
  `package.json`. Nothing is hardcoded, and the client still reports the version
  of the *running deployment* rather than of the bundle it was built from.

### `client/src/styles.css`
- Two `@font-face` blocks at the top of the file, pointing at
  `./fonts/*.woff2` relatively so Vite fingerprints them into `dist/assets/`.
  Both `font-display: swap`.
- Two new `:root` tokens, so the fallback stacks are declared once and cannot
  drift between the subtitle and the version line:
  - `--wordmark-font: 'Allison', 'Snell Roundhand', 'Brush Script MT', cursive`
  - `--mono-font: 'Courier Prime', ui-monospace, 'Courier New', monospace`
- `.masthead h1`: `font-size: clamp(3rem, 9vw, 4.5rem)` — 72px at the desktop
  layout, floored at 48px — `font-family: var(--wordmark-font)`, `line-height: 1`,
  `margin: 0`, `text-align: center`.
- `.masthead .wordmark-subtitle`: new. `var(--mono-font)`, weight 400,
  **1.125rem (18px)**, `letter-spacing: 0.06em`, `--muted`, `text-align: center`.

  **18px is a second revision**, from the human: it shipped at 13px and had to
  be squinted at. Three steps up a modest scale. It stops there because the body
  serif is 16px — past 18px the strapline stops reading as subordinate to the
  wordmark and starts reading as a heading — and it is still a quarter of the
  wordmark's 72px.

  **Centring was added after the first pass, at the human's request.** It is on
  the two elements individually rather than on `.masthead`, so the top row and
  the capability disclosure below keep their left alignment — the wordmark is a
  masthead and the controls are a toolbar, and centring the whole block would
  have moved five buttons nobody asked to move. The masthead's left and right
  padding are equal (`2rem` each), so this centres on the viewport rather than
  inside a lopsided box.
- `.colophon`: one line added, `font-family: var(--mono-font)`. Its padding,
  size, colour and `tabular-nums` are unchanged.

### `client/src/fonts/` (new)
| file | bytes |
| --- | --- |
| `allison-latin-400.woff2` | 25,628 |
| `courier-prime-latin-400.woff2` | 11,192 |
| `allison-OFL.txt` | 4,480 |
| `courier-prime-OFL.txt` | 4,403 |
| `README.md` | — |

Both faces are the **latin subset** from the Google Fonts `css2` API (Allison
v13, Courier Prime v11), downloaded once at build-authoring time. Both are
OFL 1.1; the licenses ship beside the binaries as the OFL requires, taken from
`google/fonts` `ofl/allison/OFL.txt` and `ofl/courierprime/OFL.txt`. The README
records which subset each file is and why.

**Nothing loads from a CDN at runtime.** That is the point of self-hosting here
and not only a preference: a `fonts.gstatic.com` request is a request every
reader of a capability link makes to a third party, and `index.html` already
goes out of its way not to leak that link in a referrer header.

Latin-only is a deliberate narrowing, recorded as a finding below.

---

## 2. What was verified, and how

### Test groups — `npm test`, 419 pass / 0 fail
The suite is unchanged by this work; it is reported as a **regression** check,
not as coverage of the header. No test file was added or edited, and no test
asserted the old title or the old `h1` string, so nothing had to be updated to
keep it green. The one group that could plausibly have been touched:

- `test/deploy-readiness.test.js`, group 3 (`/health` and the version): 2 tests,
  both pass. `APP_VERSION === pkg.version` and the store carries no
  `APP_VERSION` — both still true, because the version *mechanism* was not
  touched, only the string the client wraps around it.
- `test/client-build.test.js`, the staleness gate: 8 tests, all pass. Relevant
  because `BUILD_INPUTS` watches `client/src` recursively and the new fonts live
  under it — the `.woff2` files now participate in the freshness comparison,
  correctly, and `npx vite build` was run after they landed.

### `node scripts/smoke-session.js`
6 turns, 38 assertions, pass. Unchanged by this work and reported for the same
regression reason.

### Rendered reality — headless Chromium
jsdom has no layout, so every sizing claim above would otherwise be measured
against a stub. Verified under the Sandbox rules' standing headless-browser
capability: `PLAYWRIGHT_BROWSERS_PATH=0`, browsers from
`node_modules/playwright-core/.local-browsers`, the repo's own server on an
ephemeral `127.0.0.1` port with a dummy `callModel` and a scratch document root
under `.tmp-test/`, never the real `documents/`. Throwaway script, deleted after;
no committed artifact and no `test:browser` script — that arrives with a chunk
that names it.

Computed values, at five viewport widths (the centring measurements below were
taken in a second pass, against the same setup):

| viewport | h1 font-size | h1 family (computed) | subtitle | version line | h-overflow |
| --- | --- | --- | --- | --- | --- |
| 1280 | **72px** | `Allison, "Snell Roundhand", "Brush Script MT", cursive` | 18px Courier Prime | 12px Courier Prime | no |
| 900 | **72px** | same | same | same | no |
| 600 | **54px** | same | same | same | no |
| 375 | **48px** | same | same | same | no |
| 320 | **48px** | same | same | same | no |

- The ≥48px desktop requirement holds at 72px, and the ~40px floor holds at 48px
  — the clamp's lower bound, so it cannot be violated at any width without
  editing that number.
- `document.fonts` reported `Allison: loaded` and `Courier Prime: loaded` at
  every width, from the same origin. Both faces are actually painting; neither
  is silently on its fallback.
- `document.title` was `WordWright` at every width.
- The version line rendered `WordWright v0.1.0` — the live `package.json`
  version arriving through `/health`, not a literal.
- `scrollWidth > clientWidth` was false at every width including 320. The
  wordmark measures 256px inside a 256px content box at 320 — it fits, with
  nothing to spare, which is what the clamp floor is buying.

**Centring, measured after the change.** Measured on the glyphs — a `Range` over
each element's text content — not on the block box, which would have been
centred-looking whatever `text-align` said:

| viewport | wordmark text centre | subtitle text centre | viewport centre | top row left edge |
| --- | --- | --- | --- | --- |
| 1280 | 640px | 640px | 640px | 32px |
| 375 | 187px | 187px | 188px | 32px |

The 1px gap at 375 is sub-pixel rounding on an odd viewport width. The top row's
left edge is unmoved at both widths, which is the check that the centring did not
leak down the masthead.

Re-measured after the 18px bump: still centred at 640 (1280), 187 (375) and 160
(320), no horizontal overflow at any of the three, and the subtitle is one line
at 1280 and 375. **At 320 it wraps to two centred lines** — 273px of text into a
256px content box — which is a finding below rather than a defect: nothing
overflows and the wrap is centred and legible.

Screenshots taken at 1280 and read: the wordmark's descenders clear the
subtitle (`line-height: 1` is doing what it was set for, not colliding), the
subtitle reads as a strapline rather than as body prose, and the footer line is
legible at 12px.

### Build
`npx vite build` succeeds. `client/dist/assets/` now contains
`allison-latin-400-BTQ712zR.woff2` and
`courier-prime-latin-400-DYmqI_fg.woff2`, and the built CSS references them by
those fingerprinted paths — verified by grepping the built file, not inferred
from the build log. The pre-existing "chunks larger than 500 kB" warning is
unchanged and unrelated.

---

## 3. Mutation checks

Each mutation was applied to the real files, rebuilt where the build mattered,
measured in the browser, and reverted. Final state re-verified afterwards:
`npm test` 419/419 and the smoke session pass on the reverted tree, and the
built CSS carries `clamp(3rem,9vw,4.5rem)` and both `woff2` URLs.

1. **Deleted the `@font-face` block for Allison**, rebuilt, re-measured.
   `document.fonts` dropped to `["Courier Prime:loaded"]` at both widths.
   The computed `font-family` string was **unchanged** —
   `Allison, "Snell Roundhand", …` computes identically whether or not the first
   family resolves — and so was the 72px/48px sizing. **This is the finding that
   changed how section 2 is verified:** a `getComputedStyle(...).fontFamily`
   assertion cannot tell a loaded face from a missing one, so the load claim
   rests on `document.fonts` and on reading the screenshot, and only the family
   *declaration* rests on computed style. Reverted.

2. **Changed the clamp to `clamp(2rem, 9vw, 4.5rem)`**, rebuilt, re-measured.
   1280 stayed at 72px; **375 fell to 33.75px** — 9vw of 375, the middle term
   winning once the floor was lowered under it — which is below the ~40px floor
   the brief sets. Confirms the size table is measuring the clamp rather than
   reporting a constant, and confirms which term is actually binding at 375.
   Reverted.

3. **Version sourcing, in two parts.**
   - **3a, the positive check:** set `package.json` to `9.9.9` and re-measured
     **without rebuilding the client**. The footer read `WordWright v9.9.9` at
     both widths. Since the bundle on disk was untouched, the number can only
     have come through `/health` → `APP_VERSION` → `package.json` at runtime.
     This is the evidence that it is sourced rather than baked in, and the
     no-rebuild condition is the whole of what makes it evidence.
   - **3b, the negative check:** replaced the template literal with a hardcoded
     `'WordWright v0.1.0'`, rebuilt, and re-measured with `package.json` still at
     `9.9.9`. The footer read `WordWright v0.1.0` while the server was running
     9.9.9 — the hardcode is detectable, and 3a would have caught it.
   Both reverted; `package.json` is back at `0.1.0`, verified by re-reading it.

4. **Removed `font-family: var(--mono-font)` from `.colophon`**, rebuilt,
   re-measured. The version line's computed family became
   `ui-serif, Georgia, "Times New Roman", serif` — the body serif — at both
   widths, while the subtitle stayed on Courier Prime. Confirms the version line
   gets the mono face from that one declaration and not by inheritance from
   somewhere else. Reverted.

5. **Removed `text-align: center` from `.masthead h1`**, rebuilt, re-measured.
   The wordmark computed `text-align: start`, its text left edge sat at the
   masthead's 32px padding and its centre at **161px**, while the subtitle stayed
   centred at 640. The two are centred by their own declarations; neither
   inherits it from the other or from a wrapper, which is what keeps the top row
   left-aligned. Reverted.

Not mutated: the `<title>`, the subtitle markup, and the OFL files. The first
two are asserted directly from the rendered DOM (`document.title` and the
element's `textContent`), where there is no fallback path to be fooled by; the
third is a licensing obligation, not a behaviour.

## 4. Changes to shared artifacts

**None.** No §5 fixture was read, written, or touched — not the Markdown
fixture, not the HTML clipboard fixture, not the context bundle. No test file
was edited. `src/version.js`, `src/server.js` and every other server module are
byte-identical.

The complete change set is four paths:

    M client/index.html
    M client/src/App.js
    M client/src/styles.css
    ?? client/src/fonts/

---

## 5. Findings

- **N1 — the latin subset is the whole download, and that is a narrowing.**
  Google serves Allison in three subsets and Courier Prime in two; this takes
  `latin` only for each. Everything either face renders is fixed ASCII — the
  wordmark, the subtitle, and `WordWright v0.1.2` — and the latin subset's
  `unicode-range` covers `U+0000-00FF` besides. If either face is ever pointed at
  human-supplied text (a document slug, say), characters outside that range will
  fall through to the fallback stack mid-word, which looks like a bug. Convenience,
  not spec conformance: 37KB instead of ~60KB. Recorded so the next person to
  reuse `--mono-font` knows what they are inheriting.

- **N2 — `src/server.js:607` still logs `co-writing server v…` at startup.**
  Left alone deliberately: it is server code and a console line, not a visible
  in-app product-name string in the page shell, and the brief fenced the server
  off. It is the last stale name in the tree, and it is one word.

- **N3 — the version display is not the version bump.** Per the Versioning rule
  the patch bump and the `CHANGELOG.md` line belong inside the ratifying commit,
  and this mini-chunk does not commit. `package.json` still reads `0.1.0` and
  `CHANGELOG.md` is untouched; both are the human's to move. If this is ratified
  it is a `(behavior change)` line by any reasonable reading — the tool now
  greets its user under a different name.

- **N4 — CLAUDE.md is unamended, and the name is now inconsistent with it.**
  The spec calls this the "Co-Writing Prototype" throughout, §12 enumerates the
  masthead without a wordmark or a subtitle, and the Versioning rule says only
  that the UI "surfaces the current version somewhere a bug reporter can find
  it" — which `WordWright v{version}` still satisfies. The brief said not to
  touch §0 and I have touched no part of the spec at all. Flagged rather than
  fixed: the product now has a name the document that specifies it does not use.

- **N5 — no automated test asserts any of this.** Every claim in section 2 and
  every mutation in section 3 rests on throwaway browser scripts that are now
  deleted. A `test:browser` assertion pinning the 48px floor and the two loaded
  faces is exactly the class of fact the Sandbox rules say a browser test pins
  permanently — mutation 2 shows the floor is a one-character edit away from
  breaking silently — but committed browser artifacts "arrive only in chunks
  that name them", and this one does not. So the floor is currently protected by
  a comment in the stylesheet and nothing else.

- **N6 — the subtitle wraps to two lines below about 337px.** At 18px with
  `letter-spacing: 0.06em`, "Enabling Human Judgment" needs 273px and a 320px
  viewport offers 256px — so the single line survives down to roughly 337px
  (273 plus the masthead's 2×32px padding) and gives way beneath it.
  Screenshotted at 320 and read: two centred lines under the wordmark, nothing
  clipped, nothing overflowing. Accepted rather than fixed,
  because every fix is a breakpoint tuned to one device width — dropping the
  letter-spacing under ~21rem would buy the single line, at the cost of a number
  in the stylesheet that means nothing except "an iPhone SE". Named here so the
  choice is visible if a narrow viewport ever matters.

---

## 6. What was NOT verified

- **That the fonts load on the deployed instance.** Verified against
  `client/dist` served locally by this repo's own server. Railway serves the same
  directory, so the fingerprinted asset paths should behave identically, but that
  is an inference from the build output and not an observation of the deployment.
- **Any browser but Chromium.** No Safari or Firefox check, so the `woff2` and
  `clamp()` support claims are the specs' rather than measured. Both are
  universally supported; this is noted for completeness, not as a doubt.
- **Contrast of the wordmark and subtitle.** `--ink` on `--paper` and `--muted`
  on `--paper` are pre-existing pairings used elsewhere in the shell and were not
  re-measured here. §12's contrast obligation is specifically about lilac, which
  is unchanged.
- **How the subtitle wraps below 320px.** 320 is the narrowest width measured;
  the subtitle is 311px of Courier Prime at 375 and fits on one line down to 320,
  but nothing was checked below that.
- **The `disposition`/candidate surface (§0.8) and every other §12 box.** Not
  built yet and not touched. The rail, the editor and the AI panel were left
  alone entirely, and were verified only to the extent that the full-page
  screenshot shows them rendering.
