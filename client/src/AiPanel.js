/**
 * The AI side panel (CLAUDE.md §2): a prompt box beside the draft.
 *
 * It also owns the visible half of the §0.2 lock. The editor going read-only is
 * invisible on its own — the human types and nothing appears — so the pending
 * indicator here is what makes the lock legible rather than a bug.
 */

import { useState } from 'react';

import { h } from './h.js';

export function AiPanel({ state, onSubmit, onCheckpoint, rawUrl }) {
  const [prompt, setPrompt] = useState('');
  const busy = state.pending !== null;

  async function submit(event) {
    event.preventDefault();
    const result = await onSubmit(prompt);
    // Keep the prompt on failure: it is the thing the human just wrote, and
    // clearing it would make them type it again to retry.
    if (result) setPrompt('');
  }

  const blocks = [
    h('h2', { key: 'h' }, 'Ask for an edit'),

    h('form', { key: 'form', onSubmit: submit }, [
      h('textarea', {
        key: 'prompt',
        value: prompt,
        disabled: busy,
        rows: 5,
        'aria-label': 'Editing instruction',
        placeholder: 'tighten the second paragraph\nmake the tone more formal',
        onChange: (event) => setPrompt(event.target.value),
        onKeyDown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(event);
        },
      }),
      h('div', { key: 'actions', className: 'panel-actions' }, [
        h(
          'button',
          {
            key: 'send',
            type: 'submit',
            className: 'primary',
            disabled: busy || prompt.trim() === '',
          },
          state.pending === 'ai' ? 'Working…' : 'Send to the model',
        ),
        h(
          'button',
          { key: 'checkpoint', type: 'button', onClick: onCheckpoint, disabled: busy },
          'Checkpoint',
        ),
      ]),
      h(
        'p',
        { key: 'hint', className: 'hint' },
        '⌘/Ctrl + Enter sends. Checkpoint commits your hand edits as their own turn.',
      ),
    ]),
  ];

  if (state.pending === 'ai') {
    blocks.push(
      h('div', { key: 'pending', className: 'status pending', role: 'status' }, [
        h('span', { key: 'spinner', className: 'spinner', 'aria-hidden': 'true' }),
        h('div', { key: 'text' }, [
          h('strong', { key: 's' }, 'The model has the draft.'),
          h(
            'p',
            { key: 'p' },
            'The editor is read-only until this lands. Anything typed now would be overwritten ' +
              'by the response and would never appear in the history, so it is locked instead of lost.',
          ),
        ]),
      ]),
    );
  }

  if (state.error) {
    blocks.push(
      h('div', { key: 'error', className: 'status error', role: 'alert' }, [
        h('strong', { key: 's' }, 'That turn did not commit.'),
        h('p', { key: 'p' }, state.error),
      ]),
    );
  }

  if (state.notice && !state.error) {
    blocks.push(h('div', { key: 'notice', className: 'status notice', role: 'status' }, state.notice));
  }

  // §2.3: a stripped heading renders in the diff as an ordinary paragraph and a
  // stripped table as run-together text, so the warning is the only place that
  // loss is legible.
  if (state.warnings.length > 0) {
    blocks.push(
      h('div', { key: 'warnings', className: 'status warning' }, [
        h('strong', { key: 's' }, 'Committed, with warnings'),
        h(
          'ul',
          { key: 'list' },
          state.warnings.map((warning) => h('li', { key: warning }, warning)),
        ),
      ]),
    );
  }

  const stat = (label, value) =>
    h('div', { key: label }, [h('dt', { key: 'k' }, label), h('dd', { key: 'v' }, value)]);

  blocks.push(
    h('dl', { key: 'meta', className: 'meta' }, [
      stat('Document', state.slug),
      stat('Turns', String(state.history.length)),
      stat('Uncommitted edits', state.dirty ? 'yes' : 'no'),
      // The stored document exactly as the server returns it — the same
      // GET the app itself loads from, no new endpoint and nothing to keep in
      // sync. Read-only by construction: it is a GET, and it opens in its own
      // tab so the draft is never navigated away from.
      rawUrl
        ? stat(
            'Stored file',
            h(
              'a',
              { className: 'raw-json', href: rawUrl, target: '_blank', rel: 'noopener noreferrer' },
              'raw JSON',
            ),
          )
        : null,
    ]),
    h(
      'p',
      { key: 'later', className: 'hint' },
      'Every turn, its diff, and Restore are in the history — the toggle is up in the header.',
    ),
  );

  return h('aside', { className: 'panel' }, blocks);
}

export default AiPanel;
