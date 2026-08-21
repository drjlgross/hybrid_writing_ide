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

import { buildExtensions } from '../../src/tiptap-config.js';
import { serializeEditorMarkdown } from '../../src/tiptap-serialize.js';
import { createApi } from './api.js';
import { createDraftSession, initialSessionState } from './draft-session.js';
import { AiPanel } from './AiPanel.js';
import { Toolbar } from './Toolbar.js';
import { h } from './h.js';

/**
 * @param {{token: string, slug: string, createApi?: Function, createEditor?: Function}} props
 *   The two factories are injected so the headless tests can supply a stub API and
 *   a jsdom-mounted editor. The app itself never passes them.
 */
export function App({ token, slug, createApi: makeApi = createApi, createEditor }) {
  const mountRef = useRef(null);
  const sessionRef = useRef(null);
  const [editor, setEditor] = useState(null);

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
        setMarkdown: (markdown) => instance.commands.setContent(markdown, { emitUpdate: false }),
        setEditable: (editable) => instance.setEditable(editable),
      },
    });

    // A keystroke bumps a counter and nothing else — no serialization here.
    const onUpdate = () => session.noteEdit();
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

  const draftPane = h('section', { key: 'draft', className: 'draft' }, [
    h(Toolbar, { key: 'toolbar', editor, disabled: state.locked }),
    h('div', { key: 'shell', className: 'editor-shell' }, [
      h('div', { key: 'mount', ref: mountRef, className: 'editor' }),
      state.locked
        ? h(
            'div',
            { key: 'veil', className: 'lock-veil', role: 'status' },
            'read-only while the model works',
          )
        : null,
    ]),
  ]);

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
      draftPane,
      h(AiPanel, {
        key: 'panel',
        state,
        onSubmit: (prompt) => sessionRef.current.submitPrompt(prompt),
        onCheckpoint: () => sessionRef.current.checkpoint(),
      }),
    ]),
  ]);
}

export default App;
