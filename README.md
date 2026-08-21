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

For a deployment, serve the built client from Express as one process:

    npm run build && npm start

## Addresses and tokens

A document lives at `/t/{token}/{slug}`. The token is a capability (§0.5): it is
the whole identity, there is no login, and **anyone holding the link has full
access to every document in that namespace**. This is a filing system for a small
group of known people, not access control, and whoever you hand a link to should
be told exactly that.

    npm run new-token                                    # mint one, print the link
    npm run new-token -- --base https://your-host        # with a real origin

The fixed token above is for local development and is guessable by construction.
Do not rely on it anywhere but localhost.

## Checking the real API

    ANTHROPIC_API_KEY=sk-ant-... npm run live-check

One real call against a two-sentence draft: prints the request shape, the
`stop_reason`, the response, and which §2.3 guards fired. Deliberately outside
`npm test`, which must keep running with no key and no network.
