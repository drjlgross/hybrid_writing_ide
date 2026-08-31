/**
 * The editing session: everything that decides WHEN the draft is serialized,
 * committed, locked, and replaced (CLAUDE.md §0.2, §0.6, §3).
 *
 * Deliberately free of React and of the DOM. The §0.2 editor lock is the one piece
 * of this app that can silently destroy work, and a rule that only exists inside a
 * component can only be tested by driving a browser. Here it is a state machine
 * over two injected interfaces:
 *
 *   api    — { load, checkpoint, aiEdit }, each returning a promise
 *   editor — { getMarkdown, setMarkdown, setEditable }
 *
 * React supplies the real ones; the tests supply fakes and assert the ordering.
 *
 * §0.6: serialization happens at commit boundaries only. `getMarkdown` is called
 * exactly twice in this file — once per commit path — and never on a keystroke.
 * Keystrokes only bump a counter.
 */

/** @typedef {'checkpoint'|'ai'|'create'|null} Pending */

/**
 * The shape of the session state before anything has happened.
 *
 * Exported because the editor mount point has to exist in the DOM before the
 * session can be created — the effect that builds the session needs somewhere to
 * put the editor — so the component renders its full layout from this on the
 * first pass rather than rendering a placeholder and moving the editor afterwards.
 */
export function initialSessionState(slug = null) {
  return { ...INITIAL, slug };
}

const INITIAL = {
  slug: null,
  draft: '',
  history: [],

  /** Every document in this namespace (§0.5), for the document list. */
  documents: [],
  /** The address names a slug that does not exist. Offer to create it (§0.5). */
  missing: false,

  /** What is in flight, if anything. Only one thing ever is. */
  pending: /** @type {Pending} */ (null),

  /** §0.2: read-only from the moment an AI turn is submitted until it commits or errors. */
  locked: false,

  loaded: false,
  /** Uncommitted hand edits exist. Not a serialization — just "something happened". */
  dirty: false,
  error: null,
  notice: null,
  /** Warnings carried by the most recent AI turn (§2.3). */
  warnings: [],
  stripped: null,
};

/**
 * @param {{api: object, editor: object, slug: string, onState?: (state: object) => void}} options
 */
export function createDraftSession({ api, editor, slug, onState }) {
  let state = { ...INITIAL, slug };

  // Bumped on every editor update. Used to decide whether a commit that started
  // before some typing may still call the draft clean — it may not.
  let generation = 0;

  const emit = () => onState?.(state);
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  /** The editor is editable exactly when nothing is locking it (§0.2). */
  const applyLock = (locked) => {
    editor.setEditable(!locked);
  };

  /**
   * Load the document and put its draft in the editor.
   *
   * This is the only place the editor's content is set from stored text other than
   * a committed AI turn — §0.6's "the editor is only ever loaded from a canonical
   * snapshot".
   */
  async function load() {
    // The list is refreshed either way. On the missing-slug screen it is the
    // more useful half of the answer: "no document called that — here are the
    // ones there are."
    refreshLibrary();

    try {
      const doc = await api.load(state.slug);
      editor.setMarkdown(doc.draft);
      set({
        draft: doc.draft,
        history: doc.history,
        loaded: true,
        dirty: false,
        missing: false,
        error: null,
      });
      return doc;
    } catch (error) {
      // A 404 is not a failure to report — it is a document that does not exist
      // yet, which §0.5 says the human may create deliberately. A bare error
      // would leave them at a dead end holding a link they were given.
      const missing = error?.status === 404;
      set({ error: missing ? null : describe(error), missing, loaded: false });
      if (missing) return null;
      throw error;
    }
  }

  /**
   * Refresh the document list. Never rejects and never sets `error`: a failed
   * listing must not look like a failed draft load, because only one of those
   * means the human's text is in doubt.
   */
  function refreshLibrary() {
    return Promise.resolve()
      .then(() => api.list())
      .then((result) => set({ documents: result.documents ?? [] }))
      .catch(() => set({ documents: [] }));
  }

  /**
   * Create a document in this namespace (§0.5). The server sanitizes the slug and
   * refuses collisions, so the slug that comes back may not be the one typed —
   * hence everything downstream reads `doc.slug`, never the argument.
   *
   * Returns the created document. When it is the one the current address names,
   * it is loaded in place; otherwise the caller navigates to it.
   */
  async function createDocumentHere(rawSlug) {
    if (state.pending) return refuse();

    set({ pending: 'create', error: null, notice: null });
    try {
      const doc = await api.create(rawSlug);
      set({ pending: null });
      await refreshLibrary();

      if (doc.slug === state.slug) {
        await load();
        set({ notice: `created ${doc.slug}` });
      }
      return doc;
    } catch (error) {
      set({ pending: null, error: describe(error) });
      return null;
    }
  }

  /**
   * The human typed. Not a commit boundary — nothing is serialized here.
   * Clearing the notice is the point: a stale "no changes to checkpoint" sitting
   * above text the human is actively editing is a lie.
   */
  function noteEdit() {
    generation += 1;
    if (!state.dirty || state.notice) set({ dirty: true, notice: null });
  }

  /**
   * Turn boundary (a): the human clicked Checkpoint (§3).
   *
   * The editor is NOT locked and its content is NOT replaced afterwards. A
   * checkpoint does not change the text — the server stores the canonical form of
   * what is already on screen — so re-setting the content would do nothing except
   * throw the caret back to the top of the document mid-sentence. Anything typed
   * while the request is in flight simply belongs to the next turn.
   */
  async function checkpointNow() {
    if (state.pending) return refuse();

    const at = generation;
    const markdown = editor.getMarkdown(); // commit boundary — §0.6
    set({ pending: 'checkpoint', error: null, notice: null });

    try {
      const result = await api.checkpoint(state.slug, markdown);

      set({
        pending: null,
        draft: result.draft,
        history: result.history,
        // §3 / §4: no turn was created because nothing changed. Say exactly that
        // rather than reporting a checkpoint that did not happen.
        notice: result.turn
          ? `checkpointed as turn ${result.turn.turn_id}`
          : 'nothing to checkpoint — the draft is unchanged since the last turn',
        dirty: generation !== at,
      });
      return result;
    } catch (error) {
      set({ pending: null, error: describe(error) });
      throw error;
    }
  }

  /**
   * The §2.4 sequence, from the client's side.
   *
   *   1. Lock the editor            ← here, synchronously, before anything awaits
   *   2-7. the server's job
   *   8. Unlock the editor          ← here, on success or on failure
   *
   * §0.2: the request carries draft-at-T and the response replaces the working
   * draft seconds later, so anything typed in between would be destroyed silently
   * and would not even appear in the history, never having been committed. The
   * lock is the whole answer. Do not build the race.
   */
  async function submitPrompt(prompt) {
    if (state.pending) return refuse();
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      set({ error: 'type an instruction first' });
      return null;
    }

    const markdown = editor.getMarkdown(); // commit boundary — §0.6

    // Step 1, before any await: from this instant the editor is read-only.
    applyLock(true);
    set({ pending: 'ai', locked: true, error: null, notice: null, warnings: [], stripped: null });

    try {
      const result = await api.aiEdit(state.slug, prompt, markdown);

      // The AI turn committed: the working draft is now the model's text.
      editor.setMarkdown(result.draft);
      applyLock(false);
      set({
        pending: null,
        locked: false,
        draft: result.draft,
        history: result.history,
        dirty: false,
        warnings: result.ai_turn?.warnings ?? [],
        stripped: result.ai_turn?.stripped ?? null,
        notice: notifyOf(result),
      });
      return result;
    } catch (error) {
      // §2.4: any failure between steps 4 and 6 leaves the draft where step 2 left
      // it and unlocks the editor. The editor's content is untouched — it still
      // holds exactly the text that was sent.
      applyLock(false);
      set({ pending: null, locked: false, error: describe(error) });

      // The human turn from step 2 stays committed, so the stored history moved
      // even though the text did not. Refresh it without touching the editor.
      // A failure here must not replace the error the human actually needs.
      try {
        const doc = await api.load(state.slug);
        set({ history: doc.history, draft: doc.draft });
      } catch {
        /* keep the original error */
      }
      return null;
    }
  }

  function refuse() {
    set({
      notice:
        state.pending === 'ai'
          ? 'an AI turn is already in flight — the editor stays locked until it lands'
          : `a ${state.pending} is already in flight`,
    });
    return null;
  }

  return {
    load,
    noteEdit,
    checkpoint: checkpointNow,
    submitPrompt,
    createDocument: createDocumentHere,
    refreshLibrary,
    getState: () => state,
  };
}

/** What to say after a turn that committed but carried warnings (§2.3). */
function notifyOf(result) {
  const turn = result.ai_turn;
  const human = result.human_turn;
  const parts = [];
  if (human) parts.push(`your hand edits committed as turn ${human.turn_id}`);
  parts.push(`AI turn ${turn?.turn_id ?? '?'} committed`);
  return parts.join('; ');
}

/**
 * Turn anything thrown into a sentence a writer can act on.
 *
 * The §2.3 failures all mean the same thing to the human — your text is still
 * there — and that has to be said out loud, because the visible symptom is an AI
 * turn that did nothing.
 */
function describe(error) {
  if (error?.draft_unchanged) {
    return `${error.message} Your draft is exactly as you left it.`;
  }
  return error?.message ?? String(error);
}
