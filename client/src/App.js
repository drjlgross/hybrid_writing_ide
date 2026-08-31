/**
 * The editor and the AI side panel (CLAUDE.md §9 step 6).
 *
 * TipTap is a view; the Markdown string is authoritative (§0.6). This component
 * mounts the editor from `src/tiptap-config.js` — the SAME extension list the
 * round-trip tests run against, so the dialect the human writes in is the dialect
 * the store was proven to hold.
 *
 * The rules that can lose work do not live here. Locking, serialization timing and
 * turn reporting are all in draft-session.js, which is testable without a browser;
 * this component wires a real TipTap editor into it and renders the result.
 */

import { useEffect, useRef, useState } from 'react';
import { Editor } from '@tiptap/core';

import { documentAddress } from '../../src/addressing.js';
import { buildExtensions } from '../../src/tiptap-config.js';
import { serializeEditorMarkdown } from '../../src/tiptap-serialize.js';
import { createApi } from './api.js';
import { createDraftSession, initialSessionState } from './draft-session.js';
import { AiPanel } from './AiPanel.js';
import { Library } from './Library.js';
import { Toolbar } from './Toolbar.js';
import { h } from './h.js';

/**
 * @param {{token: string, slug: string, createApi?: Function, createEditor?: Function}} props
 *   The two factories are injected so the headless tests can supply a stub API and
 *   a jsdom-mounted editor. The app itself never passes them.
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
}) {
  const mountRef = useRef(null);
  const sessionRef = useRef(null);
  const [editor, setEditor] = useState(null);

  // An empty draft and a failed mount look identical: nothing on screen. This
  // says which one it is. Tracked as state rather than derived from
  // `state.draft`, because the editor's live content is what the human is
  // looking at and the stored draft lags it by a turn.
  const [empty, setEmpty] = useState(true);

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

  const library = h(Library, {
    key: 'library',
    documents: state.documents,
    token,
    slug,
    busy: state.pending !== null || state.locked,
    onCreate: createDocument,
  });

  // §0.5: an address naming a slug that does not exist is not an error page. The
  // human was handed a link; the useful answer is "that one is not here yet,
  // shall I make it" plus the documents that ARE here.
  const missingPane = h('section', { key: 'missing', className: 'missing' }, [
    h('h2', { key: 'h' }, ['There is no document called ', h('code', { key: 'c' }, slug), ' yet.']),
    h(
      'p',
      { key: 'p' },
      'Nothing was lost — no document by that name has ever been created in this ' +
        'namespace. You can create it now, or open one of the documents listed here.',
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
              'read-only while the model works',
            )
          : null,
      ]),
    ],
  );

  return h('div', { className: `app${state.locked ? ' locked' : ''}` }, [
    h('header', { key: 'masthead', className: 'masthead' }, [
      h('h1', { key: 'title' }, 'One draft, two hands'),
      // §0.5: a capability token is not access control, and anyone handed a link
      // has to be told what the link actually gives them.
      h('p', { key: 'capability', className: 'capability' }, [
        'Anyone with this link can read and edit every document in this namespace. There is no ',
        'login — the link ',
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
      h('div', { key: 'rail', className: 'rail' }, [
        library,
        state.missing
          ? null
          : h(AiPanel, {
              key: 'panel',
              state,
              onSubmit: (prompt) => sessionRef.current.submitPrompt(prompt),
              onCheckpoint: () => sessionRef.current.checkpoint(),
            }),
      ]),
    ]),
  ]);
}

export default App;
