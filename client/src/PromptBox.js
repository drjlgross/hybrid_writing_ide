/**
 * Box 1 of the right column (CLAUDE.md §12): the prompt.
 *
 *   textarea · attached-file chips · `+` bottom-left · Submit bottom-right
 *
 * It also owns the visible half of the §0.2 lock. The editor going read-only is
 * invisible on its own — the human types and nothing appears — so the pending
 * indicator here is what makes the lock legible rather than a bug. §12: an
 * indicator in the panel, the editor locked, the draft fully visible. No modal,
 * no overlay, no full-screen graphic.
 *
 * The turn's outcome — error, notice, §2.3 warnings — is reported here too,
 * beneath the controls that caused it. It is NOT in the Model Response box: that
 * box is the model's speech (§0.7), which does not exist until step 11, and
 * putting a validation warning in it now would make an empty box look populated.
 *
 * WHAT IS DELIBERATELY NOT HERE: the `+` attaches nothing yet. Context files are
 * §8 and arrive in step 12. The control occupies its §12 position, disabled and
 * saying why, so the box is the frame the next chunk builds into rather than a
 * layout that has to be rearranged to accept it.
 */

import { useState } from 'react';

import { h } from './h.js';

export function PromptBox({ state, onSubmit }) {
  const [prompt, setPrompt] = useState('');
  const busy = state.pending !== null;

  async function submit(event) {
    event.preventDefault();
    const result = await onSubmit(prompt);
    // Keep the prompt on failure: it is the thing the human just wrote, and
    // clearing it would make them type it again to retry.
    if (result) setPrompt('');
  }

  const status = [];

  if (state.pending === 'ai') {
    status.push(
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
    status.push(
      h('div', { key: 'error', className: 'status error', role: 'alert' }, [
        h('strong', { key: 's' }, 'That turn did not commit.'),
        h('p', { key: 'p' }, state.error),
      ]),
    );
  }

  if (state.notice && !state.error) {
    status.push(h('div', { key: 'notice', className: 'status notice', role: 'status' }, state.notice));
  }

  // §2.3: a stripped heading renders in the diff as an ordinary paragraph and a
  // stripped table as run-together text, so the warning is the only place that
  // loss is legible.
  if (state.warnings.length > 0) {
    status.push(
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

  return h('section', { className: 'box box-prompt' }, [
    h('h2', { key: 'h' }, 'Prompt'),

    h('form', { key: 'form', onSubmit: submit }, [
      h('textarea', {
        key: 'prompt',
        value: prompt,
        disabled: busy,
        rows: 6,
        'aria-label': 'Editing instruction',
        placeholder: 'tighten the second paragraph\nmake the tone more formal\nwhat is this draft actually arguing?',
        onChange: (event) => setPrompt(event.target.value),
        onKeyDown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit(event);
        },
      }),

      // §12: `+` bottom-left, Submit bottom-right.
      h('div', { key: 'actions', className: 'box-actions' }, [
        h(
          'button',
          {
            key: 'attach',
            type: 'button',
            className: 'attach',
            disabled: true,
            'aria-label': 'Attach a file (not yet built)',
            title: 'Attaching context files arrives with §8. Nothing is attached yet.',
          },
          '+',
        ),
        h(
          'button',
          {
            key: 'send',
            type: 'submit',
            className: 'submit',
            disabled: busy || prompt.trim() === '',
          },
          state.pending === 'ai' ? 'Working…' : 'Submit',
        ),
      ]),

      h('p', { key: 'hint', className: 'hint' }, '⌘/Ctrl + Enter submits.'),
    ]),

    ...status,
  ]);
}

export default PromptBox;
