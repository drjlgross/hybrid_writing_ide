# Self-hosted fonts

Both faces are served from this repo, never from a third-party CDN at runtime:
a font request to `fonts.gstatic.com` is a request every reader of a capability
link makes to somebody else's server, and this app already refuses to leak the
link in a referrer header (`client/index.html`).

| file | face | source |
| --- | --- | --- |
| `allison-latin-400.woff2` | Allison, regular — the WordWright wordmark | Google Fonts `css2?family=Allison`, v13, **latin subset** |
| `courier-prime-latin-400.woff2` | Courier Prime, regular — the subtitle and the version line | Google Fonts `css2?family=Courier+Prime`, v11, **latin subset** |

The latin subset (`U+0000-00FF` plus the usual punctuation ranges) is the whole
download for each. Everything either face renders here is fixed ASCII — the
wordmark, `Enabling Human Judgment`, and `WordWright v0.1.2` — so the
latin-ext, vietnamese and other subsets would be bytes nobody ever paints.

Both are licensed under the SIL Open Font License 1.1. The licenses ship
alongside the binaries, as the OFL requires:

- `allison-OFL.txt`
- `courier-prime-OFL.txt`

`@font-face` declarations live in `client/src/styles.css`, which references these
files relatively so Vite fingerprints them into `dist/assets/`.
