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

/** @typedef {'checkpoint'|'ai'|null} Pending */

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
    try {
      const doc = await api.load(state.slug);
      editor.setMarkdown(doc.draft);
      set({
        draft: doc.draft,
        history: doc.history,
        loaded: true,
        dirty: false,
        error: null,
      });
      return doc;
    } catch (error) {
      set({ error: describe(error), loaded: false });
      throw error;
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
          : 'a checkpoint is already in flight',
    });
    return null;
  }

  return {
    load,
    noteEdit,
    checkpoint: checkpointNow,
    submitPrompt,
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
