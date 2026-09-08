/**
 * The §12 surface: a top row, the editor on the left, three boxes on the right,
 * and the history below the editor.
 *
 * TipTap is a view; the Markdown string is authoritative (§0.6). This component
 * mounts the editor from `src/tiptap-config.js` — the SAME extension list the
 * round-trip tests run against, so the dialect the human writes in is the dialect
 * the store was proven to hold.
 *
 * The rules that can lose work do not live here. Locking, serialization timing and
 * turn reporting are all in draft-session.js, which is testable without a browser;
 * this component wires a real TipTap editor into it and renders the result.
 *
 * §12's division is the thing to preserve when editing this file: SPEECH LIVES IN
 * THE PANEL, EDITS LIVE IN THE DRAFT. The right column never restates the draft,
 * and nothing that proposes a change to the text is described in prose there
 * instead of being shown in the editor.
 */

import { useEffect, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';

import { documentAddress } from '../../src/addressing.js';
import { buildExtensions } from '../../src/tiptap-config.js';
import { serializeEditorMarkdown } from '../../src/tiptap-serialize.js';
import { createApi } from './api.js';
import { Colophon, Wordmark } from './Chrome.js';
import { createDraftSession, initialSessionState } from './draft-session.js';
import { History } from './History.js';
import { ModelResponse } from './ModelResponse.js';
import { PromptBox } from './PromptBox.js';
import { StandingRules } from './StandingRules.js';
import { Toolbar } from './Toolbar.js';
import { TopBar } from './TopBar.js';
import { buildTranscript, saveJson, transcriptFilename } from './transcript.js';
import { h } from './h.js';

/**
 * @param {{token: string, slug: string, createApi?: Function, createEditor?: Function}} props
 *   The factories are injected so the headless tests can supply a stub API, a
 *   jsdom-mounted editor, and a fake file saver. The app itself never passes them.
 */
export function App({
  token,
  slug,
  createApi: makeApi = createApi,
  createEditor,
  // Creating a document that is NOT the one this address names means going to
  // it. Injected so the headless tests can watch where it went instead of
  // driving a browser.
  navigate = (href) => {
    globalThis.window.location.href = href;
  },
  // §4's Export transcript. Injected for the same reason: jsdom implements
  // neither an object URL nor a download.
  saveFile = saveJson,
}) {
  const mountRef = useRef(null);
  const sessionRef = useRef(null);
  const [editor, setEditor] = useState(null);

  // An empty draft and a failed mount look identical: nothing on screen. This
  // says which one it is. Tracked as state rather than derived from
  // `state.draft`, because the editor's live content is what the human is
  // looking at and the stored draft lags it by a turn.
  const [empty, setEmpty] = useState(true);

  /**
   * §4: "a toggleable timeline", and since chunk 14 it renders OPEN.
   *
   * The record is the product. A ledger nobody opens cannot do the job §4 gives
   * it — catching the model quietly rewording a passage it was not asked to
   * touch — and the toggle made looking at it a thing you had to decide to do.
   * Open by default, the diff of the turn that just happened is simply there.
   *
   * The control is unchanged and still says "Hide history"; it is now primarily a
   * hide toggle. PER SESSION ONLY: this is `useState`, so a reload opens it again.
   * Deliberately no localStorage and no per-document setting — a stored
   * preference is a second place the UI can be wrong, and §0.5 has no room for a
   * per-visitor setting that is not in the document JSON.
   */
  const [showHistory, setShowHistory] = useState(true);

  /**
   * The version the SERVER is running (§ Versioning), for the footer.
   *
   * Fetched rather than compiled in, on purpose: what a bug reporter needs is the
   * version of the thing that just misbehaved, and a number baked into this bundle
   * at build time would report the build, not the deployment. `null` until it
   * lands and stays null if the call fails — a footer is diagnostic and must never
   * be the reason a page does not render.
   */
  const [version, setVersion] = useState(null);

  // Not null-until-loaded: the editor's mount point must be in the DOM before the
  // effect below can build the editor into it, so the layout renders from the
  // start and fills in. A placeholder first render would leave `mountRef` empty.
  const [state, setState] = useState(() => initialSessionState(slug));

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => makeApi({ token }).health())
      .then((health) => {
        if (live && typeof health?.version === 'string') setVersion(health.version);
      })
      .catch(() => {
        /* no version in the footer; nothing else changes */
      });
    return () => {
      live = false;
    };
  }, [token]);

  useEffect(() => {
    const instance = createEditor
      ? createEditor(mountRef.current)
      : new Editor({ element: mountRef.current, extensions: buildExtensions(), content: '' });

    const session = createDraftSession({
      api: makeApi({ token }),
      slug,
      onState: setState,
      editor: {
        // §0.6: called at commit boundaries only. Never on a keystroke.
        getMarkdown: () => serializeEditorMarkdown(instance),
        setMarkdown: (markdown) => {
          instance.commands.setContent(markdown, { emitUpdate: false });
          // `emitUpdate: false` is deliberate — it keeps a load or an AI commit
          // from being mistaken for a hand edit — so no update event fires and
          // the emptiness has to be recomputed here. Both callers (the initial
          // load and a committed AI turn) go through this one function.
          setEmpty(instance.isEmpty);
        },
        setEditable: (editable) => instance.setEditable(editable),
      },
    });

    // A keystroke bumps a counter and nothing else — no serialization here.
    // `isEmpty` is a document-shape check, not a serialization (§0.6).
    const onUpdate = () => {
      session.noteEdit();
      setEmpty(instance.isEmpty);
    };
    instance.on('update', onUpdate);

    sessionRef.current = session;
    setEditor(instance);
    setState(session.getState());
    session.load().catch(() => {
      /* already surfaced on the session state */
    });

    return () => {
      instance.off('update', onUpdate);
      instance.destroy();
      sessionRef.current = null;
    };
  }, [token, slug]);

  /**
   * Create a document in this namespace. If it is the one the address already
   * names — the missing-slug case — the session loads it in place; otherwise the
   * new document is somewhere else and we go there.
   *
   * The server sanitizes the slug and refuses collisions, so what comes back may
   * not be what was typed. Everything downstream reads `doc.slug`.
   */
  async function createDocument(wanted) {
    const doc = await sessionRef.current?.createDocument(wanted);
    if (doc && doc.slug !== slug) navigate(documentAddress(token, doc.slug));
  }

  /**
   * §8 C1: read the file in the browser and hand the server its bytes.
   *
   * base64 on the wire, never on disk in that form — §0.5 (amended) stores the
   * content as a sibling file under the namespace and keeps only metadata in the
   * document JSON, so a listing never pays for a screenshot.
   *
   * `readAsDataURL` rather than a multipart upload: the API is JSON end to end
   * and one encoding is cheaper to reason about than two.
   */
  async function attachContext(file, seededDescription) {
    const data = await new Promise((resolve, reject) => {
      const reader = new globalThis.FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error ?? new Error('could not read that file'));
      reader.readAsDataURL(file);
    });

    return sessionRef.current?.attachContext({
      filename: file.name,
      type: file.type || 'text/plain',
      description: seededDescription,
      data,
    });
  }

  /** §4: the full ledger as JSON. Read off the state; nothing is fetched. */
  function exportTranscript() {
    if (state.history.length === 0) return;
    saveFile(
      transcriptFilename(state.slug ?? slug),
      buildTranscript(state.slug ?? slug, state.history, new Date(), {
        context: state.context,
        rules: state.rules,
      }),
    );
  }

  const busy = state.pending !== null || state.locked;

  // §12: the top row. Global and navigation controls, lilac, in the spec's order.
  const topBar = h(TopBar, {
    key: 'top',
    token,
    slug,
    documents: state.documents,
    missing: state.missing,
    busy,
    turns: state.history.length,
    onCreate: createDocument,
    onExport: exportTranscript,
  });

  /**
   * Checkpoint, at the editor's bottom-right (§12, chunk 15's layout pass).
   *
   * PARALLEL TO SUBMIT, and to the rules box's Add: three commit actions, one per
   * surface, each at its own surface's bottom-right and all three in the same
   * forest green. That shared treatment is what makes them one group rather than
   * three buttons that happen to be last in their box.
   *
   * It sits directly under the editor and ABOVE the rule that opens the history —
   * inside the draft's own territory, not floating over the record below it.
   *
   * IT CARRIES THE DIRTY SIGNAL, exactly as it did in the top row. §12 removed the
   * status row that used to say "Uncommitted edits: yes", so if this button did not
   * say it, nothing would. It is said twice on purpose — a marker a sighted reader
   * sees and an `aria-label` a screen reader hears — because a coloured dot alone is
   * not a fact anyone can act on. The signal travels with the button, which is why
   * this is one element and not a button plus a status line somewhere else.
   */
  const checkpointBar = h('div', { key: 'commit', className: 'draft-commit' }, [
    h(
      'button',
      {
        key: 'checkpoint',
        type: 'button',
        className: `checkpoint${state.dirty ? ' checkpoint-marked' : ''}`,
        disabled: busy,
        'aria-label': state.dirty ? 'Checkpoint — you have uncommitted hand edits' : 'Checkpoint',
        title: state.dirty
          ? 'Hand edits are not yet committed as a turn. Checkpoint commits them.'
          : 'Everything you have typed is already committed as a turn.',
        onClick: () => sessionRef.current.checkpoint(),
      },
      [
        'Checkpoint',
        state.dirty ? h('span', { key: 'dot', className: 'dirty-dot', 'aria-hidden': 'true' }, '•') : null,
      ],
    ),
  ]);

  // §0.5: an address naming a slug that does not exist is not an error page. The
  // human was handed a link; the useful answer is "that one is not here yet,
  // shall I make it" plus, in the top row's switcher, the documents that ARE here.
  const missingPane = h('section', { key: 'missing', className: 'missing' }, [
    h('h2', { key: 'h' }, ['There is no document called ', h('code', { key: 'c' }, slug), ' yet.']),
    h(
      'p',
      { key: 'p' },
      'Nothing was lost — no document by that name has ever been created in this ' +
        'namespace. You can create it now, or open one of the documents in the switcher above.',
    ),
    h(
      'button',
      {
        key: 'create',
        type: 'button',
        className: 'primary',
        disabled: state.pending !== null,
        onClick: () => createDocument(slug),
      },
      `Create ${slug}`,
    ),
  ]);

  const draftPane = h(
    'section',
    { key: 'draft', className: 'draft', hidden: state.missing },
    [
      h(Toolbar, { key: 'toolbar', editor, disabled: state.locked }),
      h('div', { key: 'shell', className: 'editor-shell' }, [
        h('div', { key: 'mount', ref: mountRef, className: 'editor' }),
        // A real element rather than CSS `::before` content, so it reaches a
        // screen reader and a headless test — the two places a pseudo-element is
        // invisible. `pointer-events: none` in the stylesheet keeps it from
        // swallowing the click that would put the caret in the editor beneath.
        empty && !state.locked
          ? h(
              'p',
              { key: 'placeholder', className: 'editor-placeholder' },
              'Start writing. Bold, italic, bullets and links are the whole vocabulary.',
            )
          : null,
        state.locked
          ? h(
              'div',
              { key: 'veil', className: 'lock-veil', role: 'status' },
              // A restore replaces the draft exactly as an AI turn does, so it
              // locks for the same §0.2 reason — but saying "the model works"
              // during a restore would be a lie about what is happening.
              state.pending === 'restore'
                ? 'read-only while the draft is restored'
                : 'read-only while the model works',
            )
          : null,
      ]),
    ],
  );

  return h('div', { className: `app${state.locked ? ' locked' : ''}` }, [
    h('header', { key: 'masthead', className: 'masthead' }, [
      // The product name and the line that says what it is for. Shared with
      // /view (see Chrome.js) so the lockup exists once — a wordmark that exists
      // twice is one that will eventually say two different things.
      h(Wordmark, { key: 'lockup' }),
      topBar,

      // §0.5's capability disclosure, ON THE SURFACE (F51, resolved chunk 11).
      // Chunk 10 moved it into the switcher drawer, where it was true but behind
      // a click. Step 14 is deploy and real people will be holding real links;
      // this sentence is what stops someone treating a capability URL as private,
      // and it can only do that if it is visible without being looked for.
      h('p', { key: 'capability', className: 'hint capability' }, [
        'Anyone with this link can read and edit every document in it. There is no login — the link ',
        h('em', { key: 'is' }, 'is'),
        ' the key. Share it the way you would share a key. If two of you have it open at ',
        'once, the last Checkpoint wins — the history keeps both, but unsaved typing in the ',
        'other tab is lost.',
      ]),
    ]),
    h('main', { key: 'workspace', className: 'workspace' }, [
      // THE EDITOR'S COLUMN, as one element. It was two grid items — the draft and
      // the history — until chunk 15's layout pass. Wrapping them makes the
      // column a single containing block, which is what the sticky Checkpoint bar
      // needs to stay reachable while the history is being read (§12's
      // reachability standard, the same one F65 imposed on the rail). It is the
      // same trick the rail uses with `grid-row: 1 / -1`, done with a wrapper
      // because these two are stacked rather than spanning.
      //
      // The missing-slug screen appears BESIDE the draft pane, which is merely
      // hidden. The pane is keyed, so React keeps the same DOM node across the
      // change — the TipTap mount point survives, and the effect that built the
      // editor into it (keyed on token+slug) does not re-run and tear it down.
      h('div', { key: 'column', className: 'editor-column' }, [
        state.missing ? missingPane : null,
        draftPane,

        // Under the editor and above the history's rule: the draft's own commit
        // action, inside the draft's own territory.
        state.missing ? null : checkpointBar,

        // §4: the timeline sits BELOW the draft, in the editor's own column. Not a
        // modal and not an overlay — the draft stays on screen and stays editable
        // while the history is open, which is what makes "copy a sentence out of
        // turn 3 into the live draft" a thing a person can actually do.
        //
        // Rendered whether or not it is open: its heading carries the toggle now,
        // and a control inside the thing it toggles would vanish with it.
        state.missing
          ? null
          : h(History, {
              key: 'history',
              history: state.history,
              busy,
              open: showHistory,
              onToggle: () => setShowHistory((was) => !was),
              onRestore: (turnId) => sessionRef.current.restoreTo(turnId),
            }),
      ]),

      // §12's right column: three boxes, same paper treatment, top to bottom.
      // Two of them are empty in this chunk and say so; see their own files.
      state.missing
        ? null
        : h('div', { key: 'rail', className: 'rail' }, [
            h(PromptBox, {
              key: 'prompt',
              state,
              onSubmit: (prompt) => sessionRef.current.submitPrompt(prompt),
              // §8. None of these commits a turn (§0.10) — they are a different
              // code path from submitPrompt and carry a different busy flag.
              onAttach: attachContext,
              onDescribe: (id, description) => sessionRef.current.describeContext(id, description),
              onRemove: (id) => sessionRef.current.removeContext(id),
              onClearContext: () => sessionRef.current.clearContext(),
            }),
            h(ModelResponse, {
              key: 'response',
              note: state.note,
              speechOnly: state.speechOnly,
              pending: state.pending === 'ai',
            }),
            h(StandingRules, {
              key: 'rules',
              state,
              onAdd: (text) => sessionRef.current.addRule(text),
              onUpdate: (id, patch) => sessionRef.current.updateRule(id, patch),
              onRemove: (id) => sessionRef.current.removeRule(id),
            }),
          ]),

    ]),

    // The § Versioning rule: "the deployed UI surfaces the current version
    // somewhere a bug reporter can find it". §12 enumerates the top row and the
    // three boxes and stops, so this is the one piece of chrome outside it — put
    // at the bottom, quiet, because it is for the moment something has gone wrong
    // and for no other moment. A report that cannot name the version it came from
    // costs a round trip to establish what was running.
    // Named, not a bare number: a version pasted into a bug report has to say what
    // it is the version OF. The number comes from /health — see the `version`
    // state above — so it reports the running deployment rather than whatever was
    // baked into this bundle at build time. Shared with /view.
    h(Colophon, { key: 'footer', version }),
  ]);
}

export default App;
