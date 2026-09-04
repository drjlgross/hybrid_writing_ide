# hybrid_writing_ide

A co-writing prototype: one shared draft, edited by both a human and an LLM, with every change attributed and the full history reviewable.

Spec: CLAUDE.md. Build reports: reports/.

## Running it

    npm install
    npm test                 # no API key, no network
    npm run smoke            # the provenance model, headless

    export ANTHROPIC_API_KEY=sk-ant-...
    npm start                # API on :3000, plus the built client if there is one
    npm run dev              # in another shell: Vite on :5173, proxying /api to :3000

Then open the local development namespace:

    http://localhost:3000/t/00000000000000000000000000000000/draft

## Running it in production

One process: Express serves the API and the built client together.

    npm ci                   # NOT --omit=dev — vite is a devDependency and the build needs it
    npm run build            # writes client/dist, which is gitignored and absent from a clone
    npm start

`client/dist` is not in the repository, so **a fresh clone serves the API and no
UI until something runs the build.** The server says so at startup rather than
handing the browser a blank page. A host that runs `npm run build` before
`npm start` — the default for most Node buildpacks — needs nothing else.

Three environment variables, all read at startup:

| variable | default | why it cannot stay baked in |
| --- | --- | --- |
| `PORT` | `3000` | the platform assigns one |
| `HOST` | `127.0.0.1` | must be `0.0.0.0` to be reachable at all |
| `DOCUMENTS_ROOT` | `./documents` | point it at a mounted volume, or a redeploy deletes every draft |

**`HOST` is also the security switch.** Bound to loopback, the fixed development
token works as it always has. Bound to anything else, the server refuses that
token with a 403 (§0.5, F37): it is guessable by construction, so on a reachable
host its namespace would be world-writable. A deployment therefore has to hand out
generated links — `npm run new-token` — and there is no way to forget, because the
same setting that makes the server reachable is the one that turns the refusal on.

    GET /health   →   {"status":"ok","version":"0.1.0"}

Liveness plus the running version, with no token needed. The version in the UI
footer is read from here, so it is the version of the server actually serving you.

## What it is costing

    npm run spend-report
    DOCUMENTS_ROOT=/data npm run spend-report

Every live model call appends a row to `{DOCUMENTS_ROOT}/usage.jsonl` — namespace
prefix, timestamp, tokens, model, computed cost. The report prints a total, a
per-namespace table, and a seven-day trend.

It measures and never enforces: nothing in `src/` can refuse a call on a cost
ground, and the enforcement layer is the spend limit set in the Console. Do not
confuse it with `npm run budget`, which is the *development* key's ceiling and
lives in `scripts/spend-guard.js`.

## Addresses and tokens

A document lives at `/t/{token}/{slug}`. The token is a capability (§0.5): it is
the whole identity, there is no login, and **anyone holding the link has full
access to every document in that namespace**. This is a filing system for a small
group of known people, not access control, and whoever you hand a link to should
be told exactly that.

    npm run new-token                                    # mint one, print the link
    npm run new-token -- --base https://your-host        # with a real origin

The fixed token above is for local development and is guessable by construction.
It is refused outright once the server is bound to anything but loopback; see
`HOST` in the table above.

Two people on one link editing the same document at the same time is **last
Checkpoint wins** (§0.5, F43). The history keeps both parties' turns and either
draft can be restored from it; what is lost is whatever was typed and not
checkpointed in the losing tab. Accepted for v1, and the disclosure in the app
header says so.

## Checking the real API

    ANTHROPIC_API_KEY=sk-ant-... npm run live-check

One real call against a two-sentence draft: prints the request shape, the
`stop_reason`, the response, and which §2.3 guards fired. Deliberately outside
`npm test`, which must keep running with no key and no network.
