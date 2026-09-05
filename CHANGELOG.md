# Changelog

One line per ratified commit, per the Versioning rule in `CLAUDE.md`. The version
is `package.json`'s and moves only inside a ratification. `(behavior change)` marks
a release where a user will notice the tool acting differently — the reason this
file exists, now that the tool is deployed and someone else may be holding a link.

Entries are newest first.

## 0.1.0 — 2026-09-05

First deploy. The tool is hosted on Railway with a persistent volume and reachable
by capability link, so the version leaves `0.0.0` per the Versioning rule. No
behavior change: nothing about the app differs from the commit before it, and there
was no prior deployed version for a user to notice a difference against.

Also in this commit: `scripts/new-token.js` prints the deployed link beside the
local one, and §4's export wrapper is corrected to name `context` and `rules`.
