/**
 * The export viewer, at `/view` (CLAUDE.md § The export viewer, and §4).
 *
 * A read-only window onto a transcript this app exported. The person looking at
 * one is often not the person who wrote it — a transcript is the thing you send
 * to someone — and they may have no namespace, no token, and no reason to be
 * handed a capability link just to read a record.
 *
 * THE FILE NEVER LEAVES THE BROWSER, and that is the design rather than a
 * property it happens to have:
 *
 *   - There is no upload endpoint, and this module makes no request carrying the
 *     file. The only network call on the page is `/health`, for the version in
 *     the footer, which is a GET with no body.
 *   - The bytes come from a `File` the visitor chose, read with `file.text()`.
 *     Nothing is written to localStorage, sessionStorage, IndexedDB, or a cookie,
 *     so closing the tab is the whole of "delete it".
 *   - No token is read from the URL and no namespace is touched. `/view` is
 *     outside `/t/{token}/{slug}` entirely, so this page cannot reach a document
 *     even if the visitor holds a link to one.
 *
 * That claim is worth stating in the UI, not just in a comment, because the
 * visitor cannot check it — so the empty state says it in the first sentence.
 *
 * READ-ONLY means the absence of the machinery, not the disabling of it: there is
 * no editor, no session, no api beyond the version call, and no Restore, because
 * `History` renders that control only when handed an `onRestore` it is not given
 * here.
 */

import { useEffect, useState } from 'react';

import { createApi } from './api.js';
import { Colophon, Wordmark } from './Chrome.js';
import { DraftCard } from './DraftCard.js';
import { History } from './History.js';
import { h } from './h.js';
import { indexById, readExport } from './export-schema.js';

/** `2026-09-08T12:14:00.000Z` → something a person can read, in their own zone. */
function readableTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? String(iso ?? 'an unrecorded time')
    : date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/**
 * @param {{createApi?: Function, readFile?: (file: File) => Promise<string>}} props
 *   Both injected for the headless tests: jsdom has no `/health` to call and its
 *   `File` is not the browser's. The page itself passes neither.
 */
export function Viewer({
  createApi: makeApi = createApi,
  readFile = (file) => file.text(),
  // Passed straight through to the Current Draft card; the headless tests mount
  // TipTap into jsdom themselves. The page passes none. See DraftCard.js.
  createEditor,
}) {
  // Exactly one of these is non-null at a time, and both are cleared before a new
  // file is read — a stale error above a freshly loaded transcript would be a lie,
  // and a stale transcript below a fresh error would be worse.
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState(null);
  const [filename, setFilename] = useState('');
  // Drag feedback. Purely visual; the drop handler does not consult it.
  const [dragging, setDragging] = useState(false);

  // The running server's version, exactly as the app's footer gets it. The token
  // is a placeholder: `health()` is the one call that does not go through the
  // namespace base (see api.js), which is what makes this page usable by someone
  // holding no token at all.
  const [version, setVersion] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => makeApi({ token: 'none' }).health())
      .then((health) => {
        if (live && typeof health?.version === 'string') setVersion(health.version);
      })
      .catch(() => {
        /* no version in the footer; the page is otherwise unaffected */
      });
    return () => {
      live = false;
    };
  }, [makeApi]);

  /** Read one chosen file and either show it or say why it cannot be shown. */
  async function open(file) {
    if (!file) return;
    setFilename(file.name ?? '');
    setTranscript(null);
    setError(null);

    let text;
    try {
      text = await readFile(file);
    } catch (failure) {
      // A file that cannot be read at all — revoked permission, a directory
      // dropped instead of a file, a device that went away mid-read.
      setError(`That file could not be read: ${failure?.message ?? 'the browser gave no reason'}.`);
      return;
    }

    const result = readExport(text, file.name ?? '');
    if (result.ok) setTranscript(result.transcript);
    else setError(result.error);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    // `files[0]`: one transcript at a time. A multi-file drop reads the first
    // rather than silently ignoring the drop, which would look like a bug.
    open(event.dataTransfer?.files?.[0]);
  }

  // ── the control that opens a file ────────────────────────────────────────────
  // A real <input type="file"> inside a <label>, not a button driving a hidden
  // input by ref. The label is the click target and the keyboard target, so this
  // works from a keyboard with no handler of ours in the path.
  const picker = h('label', { key: 'pick', className: 'file-pick' }, [
    h('span', { key: 'label' }, transcript || error ? 'Open a different transcript' : 'Open a transcript'),
    h('input', {
      key: 'input',
      type: 'file',
      accept: 'application/json,.json',
      className: 'file-input',
      onChange: (event) => {
        open(event.target.files?.[0]);
        // Cleared so choosing the SAME file twice fires a change event the second
        // time. Without it, re-opening a file you just fixed appears to do nothing.
        event.target.value = '';
      },
    }),
  ]);

  // The picker and the words next to it. The DROP TARGET IS NOT THIS — it is the
  // whole page, wired on the outermost element below, because the copy says
  // "anywhere on this page" and a drop zone the size of a button would make that
  // sentence false.
  const opener = h('div', { key: 'open', className: 'viewer-open' }, [
    picker,
    h('p', { key: 'or', className: 'hint' }, 'or drop the file anywhere on this page'),
  ]);

  // ── the empty state ─────────────────────────────────────────────────────────
  // What this page is, and what it does not do. The privacy sentence is first
  // because it is the one thing a visitor cannot verify for themselves and the
  // one thing they would want to know before choosing a file.
  const emptyState =
    transcript || error
      ? null
      : h('div', { key: 'empty', className: 'viewer-empty box-surface' }, [
          h(
            'p',
            { key: 'p1' },
            'Nothing you open here is uploaded. The file is read inside your own browser, ' +
              'nothing is sent anywhere, and nothing is stored — close the tab and it is gone.',
          ),
          h(
            'p',
            { key: 'p2' },
            'A transcript is the JSON file the Export transcript button saves: the whole ' +
              'turn log of a session, with every snapshot, what the model said, and what ' +
              'each turn changed. Open one to read it back, turn by turn.',
          ),
          h(
            'p',
            { key: 'p3', className: 'hint' },
            'This is a reader, not an editor. Nothing here can change a draft, and this ' +
              'page reaches no document — a transcript is a file, not a link.',
          ),
        ]);

  // ── the calm inline error (never a blank page, never console-only) ──────────
  const errorPane = error
    ? h('div', { key: 'error', className: 'viewer-error box-surface', role: 'alert' }, [
        h('p', { key: 'what', className: 'viewer-error-what' }, error),
        h(
          'p',
          { key: 'how', className: 'hint' },
          'Nothing was sent anywhere and nothing was changed. Choose another file and try again.',
        ),
      ])
    : null;

  // ── the loaded transcript ───────────────────────────────────────────────────
  const turns = transcript?.turns ?? [];
  // §0.3: the last turn's snapshot IS the working draft at the moment of export.
  // Read, never recomputed — full snapshots (§0.4) exist so a reader never has to
  // replay anything to find out what the text is.
  const finalDraft = turns.length > 0 ? turns[turns.length - 1]?.snapshot ?? '' : '';
  const tables = transcript
    ? { context: indexById(transcript.context), rules: indexById(transcript.rules) }
    : null;

  const loaded = transcript
    ? h('div', { key: 'loaded', className: 'viewer-loaded' }, [
        h('div', { key: 'about', className: 'viewer-about box-surface' }, [
          h('h2', { key: 'h' }, transcript.slug ?? filename ?? 'a session'),
          h(
            'p',
            { key: 'meta', className: 'hint' },
            `${turns.length} turn${turns.length === 1 ? '' : 's'}, exported ${readableTime(
              transcript.exported_at,
            )}.` +
              // The two tables, counted, so a reader can tell "this session used
              // no context" from "the export did not carry the table".
              ` ${(transcript.context ?? []).length} context file${
                (transcript.context ?? []).length === 1 ? '' : 's'
              }, ${(transcript.rules ?? []).length} standing rule${
                (transcript.rules ?? []).length === 1 ? '' : 's'
              }.`,
          ),
          h(
            'p',
            { key: 'files', className: 'hint' },
            'Context files are listed by name and description only — an export never ' +
              'carries their contents.',
          ),
        ]),

        // THE BOTTOM LINE, UP FRONT. The last turn's snapshot, rendered as text
        // rather than as a record, above the history that produced it. §0.3 makes
        // that snapshot the draft as it stood at export, so nothing is
        // reconstructed here. See DraftCard.js.
        // No turns, no draft. A "Current Draft" heading over nothing would be
        // worse than its absence — and it is a different state from a session
        // that ran and ended with the draft empty, which the card DOES show.
        turns.length > 0 ? h(DraftCard, { key: 'draft', markdown: finalDraft, createEditor }) : null,

        // Then exactly what was here before: the same component the live app
        // renders, with no `onRestore` — read-only is the absence of the
        // callback. Diffs are computed here, in this browser, from the snapshots
        // the file carries (§0.4); a transcript stores no diffs and this page
        // invents none.
        h(History, {
          key: 'history',
          history: turns,
          tables,
          emptyMessage: 'This session recorded no turns.',
        }),
      ])
    : null;

  return h(
    'div',
    {
      className: `app viewer${dragging ? ' viewer-dragging' : ''}`,
      onDragOver: (event) => {
        // Both halves are required. Without preventDefault the browser navigates
        // AWAY to the dropped file — which would look like an upload, and is the
        // one behaviour this page must not appear to have.
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: (event) => {
        // Only when the pointer leaves the page itself; dragging across a child
        // element fires dragleave on the way past and would otherwise flicker.
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      },
      onDrop,
    },
    [
      h('header', { key: 'masthead', className: 'masthead' }, [
        h(Wordmark, { key: 'lockup', subtitle: 'Read the History' }),
        opener,
      ]),
      h('main', { key: 'main', className: 'viewer-main' }, [emptyState, errorPane, loaded]),
      h(Colophon, { key: 'footer', version }),
    ],
  );
}

export default Viewer;
