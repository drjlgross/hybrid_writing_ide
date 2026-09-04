/**
 * The thin Express backend (CLAUDE.md §5), namespaced by capability token (§0.5).
 *
 * Every API route lives under `/api/t/:token/…` and every page under `/t/{token}/{slug}`.
 * The token reaches exactly one function — `withNamespace` below — and no handler
 * ever reads it. The API key stays here and never reaches the browser (§0.6).
 *
 * `createServer` takes the model caller as an argument, so the whole suite runs
 * with no API key and no network — tests pass a stub, `startServer` passes the
 * real one.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { AiResponseError } from './ai-response.js';
import { runAiEdit } from './ai-edit.js';
import { ModelApiError, createModelCaller } from './anthropic-client.js';
import { DEFAULT_SLUG, DEFAULT_TOKEN, documentAddress, resolveSlug } from './addressing.js';
import { DEFAULT_TOKEN_REFUSED, allowsDefaultToken } from './binding.js';
import {
  ContextError,
  addContextFile,
  clearContext,
  describeContextFile,
  listContext,
  removeContextFile,
} from './context-store.js';
import { DOCUMENTS_ROOT, InvalidTokenError, resolveNamespaceFiles } from './namespace.js';
import { RuleError, addRule, removeRule, resolveRules, updateRule } from './rules-store.js';
import {
  LedgerInvariantError,
  SlugCollisionError,
  createDocument,
  documentExists,
  listDocuments,
  loadDocument,
  saveDocument,
} from './storage.js';
import { checkpoint, commitHumanTurn, getTurn, restoreToTurn } from './turns.js';
import { recordUsage } from './usage-ledger.js';
import { APP_VERSION } from './version.js';

const CLIENT_DIST = fileURLToPath(new URL('../client/dist/', import.meta.url));

/**
 * @param {{callModel: Function, root?: string, host?: string}} options
 *   `root` is the directory holding all namespaces; tests point it at a temp dir,
 *   and a deployment points it at a mounted volume via DOCUMENTS_ROOT.
 *   `host` is the address the server is (or will be) bound to. It decides one
 *   thing: whether §0.5's fixed default token is served at all (F37). Defaulting
 *   to loopback means a caller who says nothing gets the permissive local
 *   behaviour, and a deployment has to bind 0.0.0.0 to be reachable, which is
 *   exactly the act that turns the refusal on.
 * @returns {import('express').Express}
 */
export function createServer({ callModel, root = DOCUMENTS_ROOT, host = '127.0.0.1' } = {}) {
  if (typeof callModel !== 'function') {
    throw new TypeError('createServer needs a callModel function');
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Whether this binding may serve the guessable development namespace (§0.5,
  // F37). Computed once: it is a property of how the process was started, and
  // recomputing it per request would invite it becoming per-request state.
  const defaultTokenAllowed = allowsDefaultToken(host);

  // ── health ────────────────────────────────────────────────────────────────
  /**
   * GET /health — liveness plus the running version.
   *
   * Deliberately OUTSIDE the namespaced router: a health check that needs a
   * capability token is not a health check, and the platform probing it has no
   * token to give. It therefore says nothing namespace-specific — no document
   * counts, no namespace list (§0.5 forbids the latter outright).
   *
   * The version is here because the § Versioning rule requires a bug reporter be
   * able to find it, and this is the one address that answers without a link.
   * The UI footer reads it from here, so what the footer shows is what the server
   * is actually running rather than what some bundle was built from.
   */
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: APP_VERSION });
  });

  // ── namespace resolution ──────────────────────────────────────────────────────
  /**
   * THE ONE FUNCTION (§0.5). The only code in the server that touches the token.
   *
   * It puts the resolved namespace on the request and nothing else; every handler
   * below reads `req.namespace.dir` and has no idea a token exists. Replacing
   * capability tokens with real accounts is a change to this function — swap the
   * token lookup for a session lookup — and to nothing else.
   */
  function withNamespace(req, res, next) {
    try {
      // F37 (§0.5, resolved 2026-09-04). The fixed development token is guessable
      // by construction, so off a loopback binding its namespace is world-
      // writable. Refused here, in the one function that touches the token, which
      // is why no handler had to learn about it.
      //
      // Refused rather than redirected to a generated namespace: a request that
      // quietly became a different namespace is worse than one that failed, and
      // it is the same rule the invalid-token branch below already follows.
      if (!defaultTokenAllowed && req.params.token === DEFAULT_TOKEN) {
        res.status(403).json({ error: DEFAULT_TOKEN_REFUSED, default_token_refused: true });
        return;
      }

      // The one function (§0.5). It now also answers where this namespace's
      // context file CONTENT lives; handlers still never see the token.
      req.namespace = resolveNamespaceFiles(req.params.token, { root });
      next();
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        res.status(400).json({ error: error.message, invalid_token: true });
        return;
      }
      next(error);
    }
  }

  const api = express.Router({ mergeParams: true });
  api.use(withNamespace);

  // ── documents ─────────────────────────────────────────────────────────────────
  api.post('/documents', (req, res) => {
    try {
      const doc = createDocument({ slug: req.body?.slug, dir: req.namespace.dir });
      res.status(201).json(doc);
    } catch (error) {
      if (error instanceof SlugCollisionError) {
        // Slugs collide only within a namespace (§0.5), so this says nothing about
        // any other namespace's contents.
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  });

  /**
   * The default document (§0.5: "A missing slug resolves to a default document").
   *
   * It is created on demand, and ONLY it: a fresh link has to open onto something
   * writable, but any other slug the human names still has to be created
   * deliberately, or a typo would silently start a second document instead of
   * failing to find the first.
   */
  function readDocument(dir, rawSlug, res) {
    const slug = resolveSlug(rawSlug);
    try {
      if (slug === DEFAULT_SLUG && !documentExists(slug, { dir })) {
        res.json(createDocument({ slug, dir }));
        return;
      }
      res.json(loadDocument(slug, { dir }));
    } catch (error) {
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  }

  /**
   * Everything in THIS namespace and nothing else (§0.5).
   *
   * Not `GET /documents`: that address already means "the default document",
   * which is §0.5's missing-slug rule and is load-bearing — a fresh link has to
   * open onto something writable. Hence a separate name rather than a breaking
   * change to a rule the spec pins. Reported as a finding.
   *
   * There is deliberately no route above this one — nothing enumerates
   * namespaces, and the handler cannot: it is given a directory by
   * `withNamespace` and never sees a token.
   */
  api.get('/library', (req, res) => {
    res.json({ documents: listDocuments({ dir: req.namespace.dir }) });
  });

  api.get('/documents', (req, res) => readDocument(req.namespace.dir, undefined, res));
  api.get('/documents/:slug', (req, res) => readDocument(req.namespace.dir, req.params.slug, res));

  // ── checkpoint ────────────────────────────────────────────────────────────────
  /**
   * POST /checkpoint {slug, pendingDraft} — turn boundary (a) in §3.
   *
   * §5 names one endpoint, `/ai-edit`. Checkpoint needs a second one: the editor
   * holds the pending draft in the browser, so "the human clicked Checkpoint" can
   * only become a turn by being sent somewhere. Reported as a finding.
   *
   * `turn: null` when nothing changed — §3 forbids an empty turn, and §4 says the
   * UI must not report an edit that did not happen.
   */
  api.post('/checkpoint', (req, res) => {
    const { slug, pendingDraft } = req.body ?? {};

    if (typeof slug !== 'string' || slug === '') {
      res.status(400).json({ error: 'slug is required' });
      return;
    }
    if (typeof pendingDraft !== 'string') {
      res.status(400).json({ error: 'pendingDraft must be a string' });
      return;
    }

    const dir = req.namespace.dir;
    try {
      const doc = loadDocument(slug, { dir });
      const { doc: next, turn } = checkpoint(doc, pendingDraft);

      // Nothing changed: don't write, don't invent a turn, and say so plainly.
      if (!turn) {
        res.json({ draft: doc.draft, turn: null, history: doc.history });
        return;
      }

      const saved = saveDocument(next, { dir });
      res.json({ draft: saved.draft, turn, history: saved.history });
    } catch (error) {
      if (error instanceof LedgerInvariantError) {
        res.status(500).json({ error: error.message, ledger_invariant_violated: true });
        return;
      }
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  });

  // ── restore ───────────────────────────────────────────────────────────────────
  /**
   * POST /restore {slug, turn_id, pendingDraft?} — §4's "Restore to this turn".
   *
   * Appends a NEW human turn holding the chosen turn's snapshot. Nothing is
   * truncated and nothing is rewritten (§0.3); the turns after the restored one stay
   * exactly where they are, which is what makes a bad AI turn recoverable rather
   * than destructive. `restoreToTurn` does the work; this handler only addresses the
   * document and reports honestly.
   *
   * `pendingDraft` is committed FIRST, as its own human turn, using the same
   * mechanism as §2.4 step 2. §4 does not say what becomes of hand edits that were
   * never checkpointed, and the answer has to be something: replacing the draft
   * without committing them destroys real work and leaves no trace of it in the
   * ledger, which is the failure §0.3 and §0.2 both exist to prevent. Named as a
   * finding in the chunk-08 report.
   *
   * Two `null` turns is the §4 case "restoring to a turn the draft already matches":
   * nothing is written and the response says so, so the UI cannot report a restore
   * that did not happen.
   */
  api.post('/restore', (req, res) => {
    const { slug, turn_id: turnId, pendingDraft } = req.body ?? {};

    if (typeof slug !== 'string' || slug === '') {
      res.status(400).json({ error: 'slug is required' });
      return;
    }
    if (!Number.isInteger(turnId)) {
      res.status(400).json({ error: 'turn_id must be an integer turn id' });
      return;
    }
    if (pendingDraft !== undefined && typeof pendingDraft !== 'string') {
      res.status(400).json({ error: 'pendingDraft must be a string when present' });
      return;
    }

    const dir = req.namespace.dir;
    try {
      const doc = loadDocument(slug, { dir });

      // Checked before anything is committed: a typo in a turn id must not leave a
      // human turn behind as its only effect.
      if (!getTurn(doc, turnId)) {
        res.status(404).json({
          error: `no turn ${turnId} in ${JSON.stringify(slug)}. This document holds turns ` +
            `${doc.history.map((turn) => turn.turn_id).join(', ') || '(none)'}.`,
        });
        return;
      }

      const { doc: afterHuman, turn: humanTurn } = commitHumanTurn(doc, pendingDraft ?? doc.draft);
      const { doc: afterRestore, turn: restoreTurn } = restoreToTurn(afterHuman, turnId);

      // Nothing changed and nothing was pending: no write, no turn, and say so.
      if (!humanTurn && !restoreTurn) {
        res.json({
          draft: doc.draft,
          human_turn: null,
          turn: null,
          restored_from: turnId,
          history: doc.history,
        });
        return;
      }

      const saved = saveDocument(afterRestore, { dir });
      res.json({
        draft: saved.draft,
        human_turn: humanTurn,
        turn: restoreTurn,
        restored_from: turnId,
        history: saved.history,
      });
    } catch (error) {
      if (error instanceof LedgerInvariantError) {
        res.status(500).json({ error: error.message, ledger_invariant_violated: true });
        return;
      }
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  });

  // ── context files (§8) and standing rules (§10) ───────────────────────────────
  /**
   * §0.10 IS THE RULE THESE ROUTES EXIST TO OBEY: none of them commits a turn.
   *
   * Every handler below mutates `context` or `rules` and leaves `draft` and
   * `history` exactly as they were. Supplying context and asking for an edit are
   * different acts, and conflating them produces the unrequested rewrite the
   * evidence says most reliably destroys trust — so there is no path from any of
   * these to `commitHumanTurn`, by construction rather than by discipline.
   *
   * They are also deliberately NOT under `/ai-edit`: a separate address is what
   * makes "adding context did not run a turn" checkable from outside.
   */
  function mutateDocument(req, res, mutate) {
    const dir = req.namespace.dir;
    const slug = req.body?.slug ?? req.params.slug;

    if (typeof slug !== 'string' || slug === '') {
      res.status(400).json({ error: 'slug is required' });
      return;
    }

    try {
      const doc = loadDocument(slug, { dir });
      const before = { draft: doc.draft, turns: doc.history.length };

      const next = mutate(doc, req.namespace);
      const saved = saveDocument(next.doc ?? next, { dir });

      // Asserted, not assumed. §0.10 is a locked decision and this is the cheapest
      // place to prove it held: if a context write ever moves the draft or the
      // ledger, the request fails rather than the corruption shipping.
      if (saved.draft !== before.draft || saved.history.length !== before.turns) {
        res.status(500).json({
          error: 'a context or rules write changed the draft or the ledger (§0.10). Refused.',
          context_mutation_touched_draft: true,
        });
        return;
      }

      res.json({
        context: listContext(saved),
        rules: resolveRules(saved),
        ...(next.file ? { file: next.file } : {}),
        ...(next.rule ? { rule: next.rule } : {}),
        // Echoed so the client can assert the same thing the server just did.
        turns: saved.history.length,
      });
    } catch (error) {
      if (error instanceof ContextError || error instanceof RuleError) {
        res.status(400).json({ error: error.message, reason: error.reason });
        return;
      }
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  }

  api.get('/context/:slug', (req, res) => {
    const dir = req.namespace.dir;
    try {
      const doc = loadDocument(resolveSlug(req.params.slug), { dir });
      res.json({ context: listContext(doc), rules: resolveRules(doc) });
    } catch (error) {
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  });

  /**
   * POST /context {slug, filename, type, data, description}
   *
   * `data` is base64 on the wire and NEVER on disk in that form (§0.5 amended):
   * it is decoded here and written as bytes to `files/{id}`, and only metadata
   * reaches the document JSON.
   */
  api.post('/context', (req, res) => {
    const { filename, type, data, description } = req.body ?? {};
    if (typeof data !== 'string' || data === '') {
      res.status(400).json({ error: 'data must be a base64 string' });
      return;
    }
    mutateDocument(req, res, (doc, namespace) =>
      addContextFile(doc, {
        filename,
        type,
        description,
        bytes: Buffer.from(data, 'base64'),
        filesDir: namespace.filesDir,
      }),
    );
  });

  /** §8 C2: rewrite a description. Never a turn. */
  api.post('/context/:id/description', (req, res) => {
    mutateDocument(req, res, (doc) => describeContextFile(doc, req.params.id, req.body?.description));
  });

  /** §8 C5: discard one. */
  api.delete('/context/:id', (req, res) => {
    mutateDocument(req, res, (doc, namespace) =>
      removeContextFile(doc, req.params.id, { filesDir: namespace.filesDir }),
    );
  });

  /** §8 C5: discard all of it, in one action — a first-class operation. */
  api.post('/context/clear', (req, res) => {
    mutateDocument(req, res, (doc, namespace) => clearContext(doc, { filesDir: namespace.filesDir }));
  });

  api.post('/rules', (req, res) => {
    mutateDocument(req, res, (doc) => addRule(doc, { text: req.body?.text, scope: req.body?.scope }));
  });

  api.post('/rules/:id', (req, res) => {
    mutateDocument(req, res, (doc) => updateRule(doc, req.params.id, req.body ?? {}));
  });

  api.delete('/rules/:id', (req, res) => {
    mutateDocument(req, res, (doc) => removeRule(doc, req.params.id));
  });

  // ── the AI edit ───────────────────────────────────────────────────────────────
  /**
   * POST /ai-edit {slug, prompt, pendingDraft?}
   *
   * `pendingDraft` is the editor's current text — the human edits that have not
   * been checkpointed. §2.4 step 2 commits them as their own turn before the
   * model runs, which is what keeps the human's work attributable to the human.
   */
  api.post('/ai-edit', async (req, res) => {
    const { slug, prompt, pendingDraft } = req.body ?? {};

    if (typeof slug !== 'string' || slug === '') {
      res.status(400).json({ error: 'slug is required' });
      return;
    }
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    try {
      const result = await runAiEdit({
        slug,
        prompt,
        pendingDraft,
        dir: req.namespace.dir,
        filesDir: req.namespace.filesDir,
        // MEASURE, NEVER ENFORCE. The ledger wraps the call rather than living
        // inside it, so the model caller stays a model caller and nothing on this
        // path can refuse a request on a cost ground — the Console workspace limit
        // is the enforcement layer. `recordUsage` never throws (see its file): a
        // call that has already cost money must not fail on bookkeeping.
        callModel: async (input) => {
          const body = await callModel(input);
          recordUsage({
            // The token prefix, derived by the one namespace function. No handler
            // reads a token to produce it (§0.5).
            label: req.namespace.label,
            model: body?.model,
            usage: body?.usage,
            root,
          });
          return body;
        },
      });
      res.json({
        draft: result.draft,
        human_turn: result.humanTurn,
        ai_turn: result.aiTurn,
        history: result.doc.history,
        // Chips persist across submits (§12): context was not consumed by the turn.
        context: listContext(result.doc),
        rules: resolveRules(result.doc),
      });
    } catch (error) {
      // §2.3: on any of these the draft is unchanged and the editor unlocks. The
      // response says so explicitly, because the UI has to tell the human whether
      // their text is still there.
      if (error instanceof AiResponseError) {
        res.status(502).json({
          error: error.message,
          reason: error.reason,
          stop_reason: error.stopReason,
          draft_unchanged: true,
        });
        return;
      }
      if (error instanceof LedgerInvariantError) {
        res.status(500).json({ error: error.message, ledger_invariant_violated: true });
        return;
      }
      if (error?.code === 'ENOENT') {
        res.status(404).json({ error: `no document with slug ${JSON.stringify(slug)}` });
        return;
      }

      // Budget exhaustion is its own state, not a generic failure. "Something went
      // wrong, try again" is actively wrong here: retrying cannot work, and the
      // person reading it is a friend on a link who has no way to know the operator
      // has run out of credit. The client renders the sentence; the server only
      // says which kind of failure this was. See `classifyApiFailure` for the three
      // documented shapes and which of them are distinguishable.
      if (error instanceof ModelApiError && error.budgetExhausted) {
        res.status(502).json({
          error: error.message,
          budget_exhausted: true,
          budget_signal: error.budgetSignal,
          draft_unchanged: true,
        });
        return;
      }

      res.status(502).json({ error: error.message, draft_unchanged: true });
    }
  });

  app.use('/api/t/:token', api);

  // ── the client ────────────────────────────────────────────────────────────────
  // In development Vite serves the client and proxies /api here, so none of this
  // runs. In a deployment Express serves the built assets, which is what makes the
  // whole thing one process rather than two services (§9 step 9).
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false }));

    // Every /t/… address is the same single-page app; the token and slug are read
    // from the URL by the client. Written as a middleware rather than a route
    // pattern so no path-to-regexp dialect question arises about the optional slug.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !/^\/t\/[^/]+(\/[^/]*)?\/?$/.test(req.path)) {
        next();
        return;
      }
      res.sendFile('index.html', { root: CLIENT_DIST });
    });

  }

  /**
   * `/` is a signpost, and what it points at depends on the binding.
   *
   * Locally it redirects into the development namespace, which is the whole
   * convenience of a fixed default token. On a deployment that same redirect
   * would land on the 403 F37 exists to produce — a dead end reached by
   * following the app's own link, which is worse than no link at all. So there
   * it says what kind of thing this is and stops.
   *
   * MOUNTED WHETHER OR NOT THE CLIENT IS BUILT, deliberately, and this is not
   * tidiness. Inside the `existsSync` block above, the route's behaviour depended
   * on build state: a fresh clone, or a deploy whose build step failed, answered
   * `/` with Express's default "Cannot GET /" — the least informative page
   * available, served at the exact moment something needs explaining. The
   * explanation is true with or without a bundle. Found by the fresh-clone
   * rehearsal, where a test that passed in a developer's tree failed in a clone.
   */
  app.get('/', (req, res) => {
    if (defaultTokenAllowed) {
      res.redirect(documentAddress(DEFAULT_TOKEN));
      return;
    }
    res.status(404).type('text/plain').send(
      'This server hands out capability links.\n\n' +
        'A document lives at /t/{token}/{slug}, and the token in the link IS the\n' +
        'identity — there is no login. If you are meant to be here, someone has a\n' +
        'link for you; ask them for it. Nothing is listed from this address by\n' +
        'design.\n',
    );
  });

  return app;
}

/**
 * Start the server with the real model caller. Only called from a CLI entry.
 *
 * All three knobs come from the environment, because a host assigns them and none
 * of them can stay baked in:
 *
 *   PORT            the platform picks it and tells you.
 *   HOST            0.0.0.0 to be reachable at all. Defaulting to loopback means
 *                   a deployment must say so explicitly — and saying so is what
 *                   turns on F37's refusal of the default token. The safe value is
 *                   the one you get by not thinking about it.
 *   DOCUMENTS_ROOT  a mounted volume, so the drafts survive a redeploy. Read in
 *                   src/namespace.js, which is where the default lives.
 */
export function startServer({
  port = process.env.PORT ?? 3000,
  host = process.env.HOST ?? '127.0.0.1',
  root = DOCUMENTS_ROOT,
} = {}) {
  const app = createServer({ callModel: createModelCaller(), root, host });
  return app.listen(port, host, () => {
    console.log(`co-writing server v${APP_VERSION} on ${host}:${port}`);
    console.log(`documents root:    ${root}`);

    if (allowsDefaultToken(host)) {
      console.log(`local namespace:   http://localhost:${port}${documentAddress(DEFAULT_TOKEN)}`);
      console.log(
        'the default token is fixed and guessable by design (§0.5, local development).\n' +
          'Bound to loopback, so nothing outside this machine can reach it.',
      );
      return;
    }

    console.log(
      `bound to ${host}, which is reachable from outside this machine, so the fixed\n` +
        'development namespace is REFUSED (§0.5, F37). Mint links with:  npm run new-token',
    );
  });
}
