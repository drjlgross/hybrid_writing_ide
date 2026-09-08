# Mini: the UI decisions inside chunk 15

**Status: built, tested, uncommitted.** `npx vite build`, `npm test` (479 pass, 0
fail) and `node scripts/smoke-session.js` all pass.

This is a **narrative record**, not a second verification record. Chunk 15 shipped a
public front door, and then a dozen interface decisions accumulated around it over
an afternoon of walking the flow — each one asked for after seeing the last one
running, none of them planned in advance. That is a good way to arrive at a UI and a
bad way to remember why it looks like it does, so this file is the why.

**The evidence lives in `reports/chunk-15.md`** — sections 2a, 8, 9 and 10 — which
carries the measurements, the test counts and the mutation checks. Nothing here
repeats them. Where the two disagree, chunk-15 is the record and this is the story.

Per the Operating rules' Report naming rule, this is a `mini-` report because it is
not a step in the Build order: step 15 is the front door, and this is a companion to
its report rather than work of its own.

---

## The changes, in the order they were decided

### 1. A landing page at `/`, and a success view

The front door itself (chunk 15 Part B). `/` was a plain-text explainer; it is now
the page a stranger reads and signs up on, and the success view that hands over the
link.

**`/` stopped redirecting into the development namespace on localhost.** That was a
convenience worth removing: a front door that only appears in production is a front
door nobody looks at, and I could not otherwise have verified the page in the place
it was built. `/` now behaves identically on every binding; the development link is
printed at server start instead.

**The success view's entire job is the link.** Full URL large and monospace, a copy
button, §0.5's key disclosure beside it rather than below the fold, and Start
Writing. There is no login and no recovery, so this is the one screen where a person
receives something they cannot get back.

### 2. Allison for the product name in copy

Every rendered "WordWright" on the landing and success pages is set in the masthead
face, including mid-sentence. The mechanism splits the string and changes no
character, so ratified copy stays ratified.

**Not applied to the seed document**, which is stored editor content in the §1
dialect — a wordmark span there would be markup outside the dialect and would
round-trip to nothing. **Not applied to button labels either**: a script face inside
a 0.85rem control costs legibility for a consistency nobody asked for.

### 3. "Welcome to WordWright." cut from the landing copy

Seen on the built page, the greeting was the reader's third look at the same name
before the page had said anything — the lockup sits two inches above it. The rest of
the sentence is untouched.

**The seed document still opens with it.** Inside the tool it is the first thing
said, rather than a caption under the sign. The divergence is noted in both files so
nobody later "fixes" one to match the other.

### 4. The seed document: bold labels, and its own name

Hand-marked bold on the five section labels — `**Working Together:**` and the rest,
colon inside. Bold is in the §1 dialect and §1 has no heading node, so this is what a
scannable label looks like here.

Its slug became **`welcome-doc`**, not §0.5's `draft`. It is a welcome page, not the
visitor's first draft: calling it `draft` invites writing over instructions not yet
read, and its own name is what makes it findable in the switcher afterwards — which
is what the seed text promises when it says the welcome page stays in your namespace.

*Consequence, named rather than discovered:* a claimed namespace has no document at
the default slug, so trimming the URL to `/t/{token}` reaches the ordinary
missing-document screen. Nothing routes anyone there; a person editing their own URL
will meet it.

### 5. View WordWright Doc, in the top row

A control to reach the transcript viewer from the working surface — it existed and
nothing linked to it.

**It opens a new tab**, which is the load-bearing part: hand edits are uncommitted
until Checkpoint, so a same-tab navigation would silently discard whatever was typed
and not yet ratified. It is an anchor rather than a button because it goes somewhere,
and it carries `rel="noopener noreferrer"` because the capability token is in the
referring page's URL and a leaked token cannot be revoked.

### 6. The top row emptied out

Two controls left it, each to sit beside the thing it acts on rather than in a row of
everything:

**Show/Hide History → the History section's own heading.** Two consequences follow.
The heading always renders and only the log collapses, because a toggle inside the
thing it toggles would vanish with it. And the count went back onto the control —
`Hide History (19)` — which **resolves F50**, open since chunk 10; it has to be on the
button because the "N turns, newest first" line is part of what collapses.

**Checkpoint → the editor's bottom-right.** See 8.

What is left is document name · + New Document · Export Transcript · View WordWright
Doc.

### 7. Title Case on every button label

Top row, the history's per-turn controls, the link toolbar, the panel, the landing and
success pages, the viewer's picker. Labels only — no route, id or body copy changed.
The document-name button is exempt: it is a slug the human typed, which §0.5
lowercases.

### 8. Checkpoint: sticky, then not sticky

**This one was reversed on sight, one section after shipping it**, and the sequence is
the point.

It first landed as a bar pinned to the bottom of the viewport, reachable from anywhere
in the column — the same reachability standard F65 imposed on the rail. Seen running,
the trade was wrong: it spent a band of the screen for the whole session to buy
reachability for a control you meet once per checkpoint, and floating over the record
it read as a page-level toolbar rather than as the draft's own commit.

It now sits directly under the editor box, right-aligned, **above the rule that opens
the history** — inside the draft's territory, which is itself part of saying what it
commits.

**What was given up, deliberately:** Checkpoint is no longer reachable while reading
deep in the history. Committing after a long read means scrolling back up. If that
bites, the answer is probably not stickiness — it is that Checkpoint belongs where the
draft is and reading the record is a separate motion.

*What survived from the sticky attempt:* the `.editor-column` wrapper, which is now
the grid item carrying the chunk-08 column pin.

### 9. One green for three commit actions

| surface | control | what it commits |
| --- | --- | --- |
| Prompt box | Submit | the prompt |
| Standing Rules | Add — was white on a hairline border | a standing rule |
| the editor | Checkpoint — was lilac | the draft |

Each at its surface's bottom-right, all three the same forest green. That shared
treatment is the whole of what makes them read as one act repeated rather than three
buttons that happen to be last in their box — so it is **declared once, in one grouped
selector**, because three separate green declarations drift apart one edit at a time.

§12's rule widened with it: forest green is no longer "the primary action inside a box
(Submit)" but "the commit action of a surface, at that surface's bottom-right".

Two knock-ons: the uncommitted-edits dot went white, because it has to be legible on
whatever it sits on; and `checkpoint-marked` became a bright edge on the same fill
rather than a different colour, because the button's job has not changed — only whether
something is waiting.

### 10. The editor capped, so the history is on screen

With Checkpoint no longer sticky, the History heading sat about 150px below the fold at
every viewport — always just out of sight, which is the worst case. The record is the
feature nobody arrives knowing about; a layout that hides it makes discovery something
you have to already want.

**The first fix was wrong and is worth remembering.** Reducing the editor's
`min-height` changed nothing, because a draft with text in it is as tall as its text —
a minimum never binds on a document anyone has actually written. It would have worked
only on an empty draft, the one case that did not need it.

So the editor is **capped and scrolls inside itself**, sized against the fixed
furniture above and below it as a length rather than a fraction, under a floor that
keeps a usable writing surface on a short screen.

**The cost:** a second scroll region on the page. Accepted, because it is the only
mechanism that keeps the promise for a long draft as well as a new one.

---

## What this changed in the spec

§12 was amended four times over the afternoon, and it is now current: the top row's
contents and order, the history toggle's new home with its count, Checkpoint's
placement and its two constraints, the widened button-semantics rule with the three
commit actions named, Title Case, and the editor's sizing rule. §0 untouched
throughout.

## What is not solved

- **Title Case has no lint.** It was applied control by control. The top-row test
  enforces the rule for that row; every other label is asserted as a literal, so a new
  button elsewhere can still arrive in sentence case.
- **The editor's sizing constant is measured, not derived.** It comes from the current
  masthead height — 260px, most of it the wordmark and the four-line capability
  paragraph. If the masthead changes, the number is stale and the symptom is the
  history sliding back under the fold, which nothing catches automatically: the test
  asserts the shape of the rule, not the outcome. A committed browser assertion would;
  this repo still has none.
- **Reachability of Checkpoint from the history**, given up in 8 and named there.
- **F50 should come off §13's open list** at ratification. It is still listed as open
  from chunk 10.
