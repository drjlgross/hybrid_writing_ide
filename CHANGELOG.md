# Changelog

One line per ratified commit, per the Versioning rule in `CLAUDE.md`. The version
is `package.json`'s and moves only inside a ratification. `(behavior change)` marks
a release where a user will notice the tool acting differently — the reason this
file exists, now that the tool is deployed and someone else may be holding a link.

Entries are newest first.

## 0.1.4 — 2026-09-08 (behavior change)

Raised the AI-turn output budget and the request timeout (§2.3), after a live
`max_tokens` failure on memo-length work. Thinking shares that budget, and the flat
term reserved for it was too lean: headroom 1.6 → 2.0, the flat term 2048 → 6144,
the floor 4096 → 16000. The 32000 ceiling is unchanged and deliberate. The request
timeout goes 120s → 480s with it, so the larger budget cannot turn `max_tokens`
failures into abort failures.

Users will notice two things: analysis-heavy turns that were cut off mid-response
now complete, and a hung request takes eight minutes rather than two to give up —
during which the editor stays locked (§0.2). §2.3 now states the formula and the
constants, which it never did; they had lived only in the code, which is how they
went unexamined until something broke.

## 0.1.3 — 2026-09-08 (behavior change)

Chunk 15: a public front door. The bare domain is now a landing page where anyone can
sign up with a name and an email and receive their own namespace, seeded with a
welcome document, without an operator in the loop — `POST /api/public/claim`, a
per-address rate limit, and a `claims.jsonl` registry read by the new
`npm run users-report`. `/` no longer redirects into the development namespace on a
loopback binding; it is the same page everywhere.

The working surface was rearranged with it. Show/Hide History moved to the History
heading and carries the turn count again; Checkpoint moved to the editor's
bottom-right and joined Submit and Add as one green group — three commit actions, one
per surface, at each surface's own corner. A View WordWright Doc control opens the
transcript viewer in a new tab. Button labels are Title Case. The editor is capped so
the history is on screen at first paint, which is the point of the whole tool being
visible without going looking for it.

## 0.1.2 — 2026-09-08 (behavior change)

Chunk 14. A read-only export viewer at `/view`: it renders a transcript JSON entirely
in the visitor's own browser — no upload, no storage, no namespace access — leading
with a Current Draft card holding the last turn's snapshot, then the full turn log
with diffs, notes, segments and resolved context and rule references. And the history
view now renders open by default in the app; the Show/hide control becomes primarily
a hide toggle. Both are visible to anyone already holding a link.

## 0.1.1 — 2026-09-06 (behavior change)

The product has a name: WordWright. The masthead is the wordmark in Allison over
the subtitle "Enabling Human Judgment" in Courier Prime, both centred, both fonts
self-hosted with their OFL licenses rather than fetched from a CDN; the browser
tab and the version line follow. Anyone holding a link will see a different page
header than they did yesterday, which is what the tag is for.

Also in this commit: `scripts/new-token.js` mints links at `wordwright.ink`
instead of the Railway hostname, labelled `local:` and `ink:` with the sending
link last and marked.

## 0.1.0 — 2026-09-05

First deploy. The tool is hosted on Railway with a persistent volume and reachable
by capability link, so the version leaves `0.0.0` per the Versioning rule. No
behavior change: nothing about the app differs from the commit before it, and there
was no prior deployed version for a user to notice a difference against.

Also in this commit: `scripts/new-token.js` prints the deployed link beside the
local one, and §4's export wrapper is corrected to name `context` and `rules`.
