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
 * beneath the controls that caused it. It is NOT in the Model Response box, and
 * now that the model's speech is real (§0.7, step 11) that separation is doing
 * work rather than waiting for it: a validation warning is THE SYSTEM REPORTING,
 * not the model talking, and Model Response holds speech only. Putting "stripped:
 * 2 headings" beside the model's own words would blend the two records §9's S12
 * says the UI never blends. Recorded as F52 in chunk 10 and kept in chunk 11.
 *
 * That includes the speech-only notice. "AI turn 4 committed — no change to the
 * draft" is a fact the app observed about the turn, so it belongs here; the
 * model's account of WHY it changed nothing is speech, and belongs there.
 *
 * §8 lands here in step 12, resolving F48: the `+` attaches a real file, chips
 * carry their editable descriptions, and both persist across submits so it is
 * evident context was not consumed by the last turn (§12).
 *
 * TWO RULES FROM §0.10 SHAPE THE CONTROLS. Attaching or describing context never
 * triggers a turn, so none of this goes near `onSubmit`. And the editor is not
 * locked while a file uploads — `state.busyContext` is a different flag from
 * `state.pending` for exactly that reason: treating "she gave me a file" as
 * "she asked for an edit" is the failure §0.10 exists to prevent.
 */

import { useRef, useState } from 'react';

import { h } from './h.js';

/**
 * §8 C2a: the description is pre-populated from the prompt where she stated it
 * inline, because that is how it actually arrives — "look to these for length and
 * tone, not content". A blank field per file is a tax that will not be paid.
 *
 * Deliberately crude, and it should stay crude: it seeds an editable field, and
 * being wrong costs her one edit. Anything cleverer would be inferring what the
 * file IS, which §8 C2 says cannot be done from the file.
 */
export function seedDescription(prompt) {
  const text = String(prompt ?? '').trim();
  if (text === '') return '';

  // The sentence that mentions the attachment is the one she wrote about it.
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const about = sentences.find((sentence) =>
    /\b(attach|attached|attaching|here is|here's|these|this file|screenshot|look to|for (?:tone|colou?r|length|reference))\b/i.test(
      sentence,
    ),
  );
  return (about ?? sentences[0] ?? '').trim().slice(0, 200);
}

export function PromptBox({
  state,
  onSubmit,
  onAttach = null,
  onDescribe = null,
  onRemove = null,
  onClearContext = null,
}) {
  const [prompt, setPrompt] = useState('');
  const fileInput = useRef(null);
  const busy = state.pending !== null;
  const context = state.context ?? [];

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

  // ── §8: the chips ─────────────────────────────────────────────────────────
  const chips =
    context.length === 0
      ? null
      : h('div', { key: 'chips', className: 'chips' }, [
          ...context.map((file) =>
            h('div', { key: file.id, className: `chip chip-${file.kind}${file.extraction === 'failed' ? ' chip-failed' : ''}` }, [
              h('div', { key: 'head', className: 'chip-head' }, [
                h('span', { key: 'name', className: 'chip-name', title: `${file.type}, ${Math.ceil(file.bytes / 1024)}KB` }, file.filename),
                h(
                  'button',
                  {
                    key: 'x',
                    type: 'button',
                    className: 'chip-remove',
                    'aria-label': `Remove ${file.filename}`,
                    disabled: state.busyContext,
                    onClick: () => onRemove?.(file.id),
                  },
                  '×',
                ),
              ]),

              // §8 C3: extraction failure surfaces ON THE CHIP, never as a silent
              // degradation to an unread attachment.
              file.extraction === 'failed'
                ? h('p', { key: 'bad', className: 'chip-error' }, `Could not read this: ${file.extraction_error}`)
                : null,

              // §8 C2: freeform, editable in place. Not a taxonomy, not a dropdown.
              h('input', {
                key: 'desc',
                type: 'text',
                className: 'chip-description',
                value: file.description ?? '',
                placeholder: 'what is it, and why is it here?',
                'aria-label': `What ${file.filename} is for`,
                disabled: state.busyContext,
                onChange: (event) => onDescribe?.(file.id, event.target.value),
              }),
            ]),
          ),

          // §8 C5: wholesale discard, as a first-class operation rather than a
          // session restart. Two of the three records the spec came from destroy
          // context on purpose to get their best output.
          h(
            'button',
            {
              key: 'clear',
              type: 'button',
              className: 'chip-clear',
              disabled: state.busyContext,
              onClick: () => onClearContext?.(),
            },
            `Discard all ${context.length} context file${context.length === 1 ? '' : 's'}`,
          ),
        ]);

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
        h('input', {
          key: 'file',
          ref: fileInput,
          type: 'file',
          className: 'attach-input',
          hidden: true,
          'aria-hidden': 'true',
          tabIndex: -1,
          onChange: async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file && onAttach) await onAttach(file, seedDescription(prompt));
          },
        }),
        h(
          'button',
          {
            key: 'attach',
            type: 'button',
            className: 'attach',
            disabled: state.busyContext || !onAttach,
            'aria-label': 'Attach a context file',
            title: 'Attach a text file or an image as context for this document (§8).',
            onClick: () => fileInput.current?.click(),
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

    chips,
    ...status,
  ]);
}

export default PromptBox;
