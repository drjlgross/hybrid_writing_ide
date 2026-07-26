/**
 * The thin Express backend (CLAUDE.md §5).
 *
 * One endpoint: POST /ai-edit {slug, prompt} → runs the §2.4 sequence and returns
 * the new draft plus turn metadata. The API key stays here and never reaches the
 * browser (§0.6).
 *
 * `createServer` takes the model caller as an argument, so the whole suite runs
 * with no API key and no network — tests pass a stub, `startServer` passes the
 * real one.
 */

import express from 'express';

import { AiResponseError } from './ai-response.js';
import { runAiEdit } from './ai-edit.js';
import { createModelCaller } from './anthropic-client.js';
import { LedgerInvariantError, SlugCollisionError, createDocument, loadDocument } from './storage.js';

/**
 * @param {{callModel: Function, dir?: string}} options
 * @returns {import('express').Express}
 */
export function createServer({ callModel, dir } = {}) {
  if (typeof callModel !== 'function') {
    throw new TypeError('createServer needs a callModel function');
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const dirOption = dir ? { dir } : undefined;

  app.post('/documents', (req, res) => {
    try {
      const doc = createDocument({ slug: req.body?.slug, ...(dir ? { dir } : {}) });
      res.status(201).json(doc);
    } catch (error) {
      if (error instanceof SlugCollisionError) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/documents/:slug', (req, res) => {
    try {
      res.json(loadDocument(req.params.slug, dirOption));
    } catch (error) {
      res.status(error.code === 'ENOENT' ? 404 : 500).json({ error: error.message });
    }
  });

  /**
   * POST /ai-edit {slug, prompt, pendingDraft?}
   *
   * `pendingDraft` is the editor's current text — the human edits that have not
   * been checkpointed. §2.4 step 2 commits them as their own turn before the
   * model runs, which is what keeps the human's work attributable to the human.
   */
  app.post('/ai-edit', async (req, res) => {
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
      const result = await runAiEdit({ slug, prompt, pendingDraft, dir, callModel });
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

  return app;
}

/** Start the server with the real model caller. Only called from a CLI entry. */
export function startServer({ port = process.env.PORT ?? 3000, dir } = {}) {
  const app = createServer({ callModel: createModelCaller(), dir });
  return app.listen(port, () => {
    console.log(`co-writing server on http://localhost:${port}`);
  });
}
