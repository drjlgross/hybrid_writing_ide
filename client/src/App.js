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

  // §4: "a toggleable timeline". Off by default — the draft is what you came for.
  const [showHistory, setShowHistory] = useState(false);

  // Not null-until-loaded: the editor's mount point must be in the DOM before the
  // effect below can build the editor into it, so the layout renders from the
  // start and fills in. A placeholder first render would leave `mountRef` empty.
  const [state, setState] = useState(() => initialSessionState(slug));

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

  /** §4: the full ledger as JSON. Read off the state; nothing is fetched. */
  function exportTranscript() {
    if (state.history.length === 0) return;
    saveFile(transcriptFilename(state.slug ?? slug), buildTranscript(state.slug ?? slug, state.history));
  }

  const busy = state.pending !== null || state.locked;

  // §12: the top row. Global and navigation controls, lilac, in the spec's order.
  const topBar = h(TopBar, {
    key: 'top',
    token,
    slug,
    documents: state.documents,
    missing: state.missing,
    dirty: state.dirty,
    busy,
    turns: state.history.length,
    showHistory,
    onToggleHistory: () => setShowHistory((was) => !was),
    onCreate: createDocument,
    onExport: exportTranscript,
    onCheckpoint: () => sessionRef.current.checkpoint(),
  });

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
      h('h1', { key: 'title' }, 'One draft, two hands'),
      topBar,

      // §0.5's capability disclosure, ON THE SURFACE (F51, resolved chunk 11).
      // Chunk 10 moved it into the switcher drawer, where it was true but behind
      // a click. Step 14 is deploy and real people will be holding real links;
      // this sentence is what stops someone treating a capability URL as private,
      // and it can only do that if it is visible without being looked for.
      h('p', { key: 'capability', className: 'hint capability' }, [
        'Anyone with this link can read and edit every document in it. There is no login — the link ',
        h('em', { key: 'is' }, 'is'),
        ' the key. Share it the way you would share a key.',
      ]),
    ]),
    h('main', { key: 'workspace', className: 'workspace' }, [
      // The missing-slug screen appears BESIDE the draft pane, which is merely
      // hidden. The pane is keyed, so React keeps the same DOM node across the
      // change — the TipTap mount point survives, and the effect that built the
      // editor into it (keyed on token+slug) does not re-run and tear it down.
      state.missing ? missingPane : null,
      draftPane,

      // §12's right column: three boxes, same paper treatment, top to bottom.
      // Two of them are empty in this chunk and say so; see their own files.
      state.missing
        ? null
        : h('div', { key: 'rail', className: 'rail' }, [
            h(PromptBox, {
              key: 'prompt',
              state,
              onSubmit: (prompt) => sessionRef.current.submitPrompt(prompt),
            }),
            h(ModelResponse, {
              key: 'response',
              note: state.note,
              speechOnly: state.speechOnly,
              pending: state.pending === 'ai',
            }),
            h(StandingRules, { key: 'rules' }),
          ]),

      // §4: the timeline sits BELOW the draft, in the editor's own column. Not a
      // modal and not an overlay — the draft stays on screen and stays editable
      // while the history is open, which is what makes "copy a sentence out of
      // turn 3 into the live draft" a thing a person can actually do.
      showHistory && !state.missing
        ? h(History, {
            key: 'history',
            history: state.history,
            busy,
            onRestore: (turnId) => sessionRef.current.restoreTo(turnId),
          })
        : null,
    ]),
  ]);
}

export default App;
