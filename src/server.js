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
import { createModelCaller } from './anthropic-client.js';
import { DEFAULT_SLUG, DEFAULT_TOKEN, documentAddress, resolveSlug } from './addressing.js';
import { DOCUMENTS_ROOT, InvalidTokenError, resolveNamespace } from './namespace.js';
import {
  LedgerInvariantError,
  SlugCollisionError,
  createDocument,
  documentExists,
  loadDocument,
  saveDocument,
} from './storage.js';
import { checkpoint } from './turns.js';

const CLIENT_DIST = fileURLToPath(new URL('../client/dist/', import.meta.url));

/**
 * @param {{callModel: Function, root?: string}} options
 *   `root` is the directory holding all namespaces; tests point it at a temp dir.
 * @returns {import('express').Express}
 */
export function createServer({ callModel, root = DOCUMENTS_ROOT } = {}) {
  if (typeof callModel !== 'function') {
    throw new TypeError('createServer needs a callModel function');
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

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
      req.namespace = resolveNamespace(req.params.token, { root });
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
      const result = await runAiEdit({ slug, prompt, pendingDraft, dir: req.namespace.dir, callModel });
      res.json({
        draft: result.draft,
        human_turn: result.humanTurn,
        ai_turn: result.aiTurn,
        history: result.doc.history,
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

    app.get('/', (req, res) => res.redirect(documentAddress(DEFAULT_TOKEN)));
  }

  return app;
}

/** Start the server with the real model caller. Only called from a CLI entry. */
export function startServer({ port = process.env.PORT ?? 3000, root } = {}) {
  const app = createServer({ callModel: createModelCaller(), root });
  return app.listen(port, () => {
    console.log(`co-writing server on http://localhost:${port}`);
    console.log(`local namespace:   http://localhost:${port}${documentAddress(DEFAULT_TOKEN)}`);
    console.log(
      'the default token is fixed and guessable by design (§0.5, local development).\n' +
        'Hand out generated tokens before putting this anywhere but localhost.',
    );
  });
}
