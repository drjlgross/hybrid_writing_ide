/**
 * Box 3 of the right column (CLAUDE.md §12): standing rules.
 *
 * §10's HUMAN-WRITTEN HALF, and only that half. A bullet list she edits directly,
 * persisted in the document JSON, injected into the §2.1 payload with its scope.
 * No detection logic of any kind — §10 is explicit that this is the whole feature
 * for a writer who already knows what her rules are ("no em-dashes", "open on the
 * biology, not the pipeline").
 *
 * §0.10: editing this list NEVER triggers a turn. Every control here calls a
 * context-write, which is a different code path from `submitPrompt` and carries a
 * different busy flag, so a rule edit cannot lock the editor or move the ledger.
 *
 * WHAT STEP 16 ADDS, and what it must not have to change: the store already
 * carries `source` on every rule (`human` now, `proposed` later), so a
 * model-proposed rule is an addition to this list rather than a second one. A
 * proposal will need an accept/dismiss affordance; the rendering below keys off
 * `rule.source` so that is a new branch, not a rewrite.
 */

import { useState } from 'react';

import { h } from './h.js';

export function StandingRules({ state, onAdd = null, onUpdate = null, onRemove = null }) {
  const [draft, setDraft] = useState('');
  const rules = state?.rules ?? [];
  const busy = state?.busyContext ?? false;

  async function submit(event) {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || !onAdd) return;
    // Cleared only on success: a rule she typed should not vanish because the
    // write failed.
    if (await onAdd(text)) setDraft('');
  }

  const list =
    rules.length === 0
      ? h(
          'p',
          { key: 'empty', className: 'box-empty' },
          'Corrections you want to hold across every turn will live here. There are none yet.',
        )
      : h(
          'ul',
          { key: 'list', className: 'rule-list' },
          rules.map((rule) =>
            h('li', { key: rule.id, className: `rule rule-${rule.source}` }, [
              // Editable in place (§10). A rule you cannot edit is a rule you
              // delete and retype, which is how a list stops being maintained.
              h('input', {
                key: 'text',
                type: 'text',
                className: 'rule-text',
                value: rule.text,
                'aria-label': `Rule: ${rule.text}`,
                disabled: busy,
                onChange: (event) => onUpdate?.(rule.id, { text: event.target.value }),
              }),
              // §10: individually revocable.
              h(
                'button',
                {
                  key: 'x',
                  type: 'button',
                  className: 'rule-remove',
                  'aria-label': `Remove rule: ${rule.text}`,
                  disabled: busy,
                  onClick: () => onRemove?.(rule.id),
                },
                '×',
              ),
            ]),
          ),
        );

  return h('section', { className: 'box box-rules' }, [
    h('h2', { key: 'h' }, 'Standing Rules'),
    h('div', { key: 'surface', className: 'box-surface' }, [list]),

    h('form', { key: 'add', className: 'rule-add', onSubmit: submit }, [
      h('input', {
        key: 'new',
        type: 'text',
        value: draft,
        placeholder: 'no em-dashes',
        'aria-label': 'New standing rule',
        disabled: busy || !onAdd,
        onChange: (event) => setDraft(event.target.value),
      }),
      h(
        'button',
        { key: 'go', type: 'submit', className: 'rule-submit', disabled: busy || draft.trim() === '' || !onAdd },
        'Add',
      ),
    ]),

    // Said out loud because it is the thing a writer will not otherwise believe:
    // §0.10's separation is invisible unless the UI states it.
    rules.length > 0
      ? h(
          'p',
          { key: 'note', className: 'hint note-scope' },
          `${rules.length} rule${rules.length === 1 ? '' : 's'} sent with every turn. Editing them never runs one.`,
        )
      : null,
  ]);
}

export default StandingRules;
