# CoWrite — backlog

Not instructions. Nothing here is scheduled, and Claude Code does not need to read this
file to build a chunk. It lives outside CLAUDE.md because a session-start file should
carry only what every session needs.

Anything here that becomes real gets written into CLAUDE.md as a numbered section and
placed in the Build order, like everything else.

---

## Measurement

- **Session metrics.** Restore-and-redo cycles per thousand words, and
  accepted-vs-rejected candidate ratio, so "does a shared draft reduce churn versus
  chat" is answerable from data rather than impression.

  The per-turn verdict field this used to ask for is no longer a backlog item — §0.9
  records dispositions natively, which is the same signal collected as a byproduct of
  use rather than as bookkeeping.

- **Session close marker** — "unreviewed under fatigue," pointing the next session at
  what needs fresh eyes. See F45; the anti-bookkeeping rule argues against any version
  requiring effort, so an automatic signal derived from timestamps and disposition
  patterns is the only shape likely to survive.

## Editor

- Drag-to-reorder paragraph blocks.
- Rendered rich-text diffs in the history view (Markdown-source diffs are fine for now;
  `**` may appear).

## Access

- **Bring-your-own-key.** Accept an API key from the client and use it in place of the
  server's. Small on its own. Does not make the app multi-user, because §0.5's
  namespaces are capability tokens rather than accounts.
- Real accounts replacing capability tokens. §0.5 already constrains this: it must be a
  change to the one namespace-resolving function and nothing else.
- Per-user standing rules layered under per-document ones. §0.11 leaves the seam.
