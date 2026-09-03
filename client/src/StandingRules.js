/**
 * Box 3 of the right column (CLAUDE.md §12): standing rules.
 *
 * EMPTY BY DESIGN IN THIS CHUNK. §10's human-written rules are step 12 and the
 * model-proposed half is step 16; the store they both write to does not exist
 * yet. This box holds its place and says what it is for.
 *
 * §0.11 when it does get built: the store is resolved in exactly one function,
 * rules are per-document, and every rule carries a scope. Editing this list must
 * never trigger a turn (§0.10) — supplying an instruction and asking for an edit
 * are different acts, and conflating them produces the unrequested rewrite that
 * the evidence says most reliably destroys trust.
 *
 * The white `.box-surface` is here from now, though, and it is not decoration:
 * §12 makes the surface structural rather than conditional, so all three boxes in
 * the rail read as three parallel boxes at first paint. The empty sentence sits
 * INSIDE it. When step 12 fills this box, the editable list replaces the sentence
 * on the surface that is already there — a change of content, not of anatomy.
 */

import { h } from './h.js';

export function StandingRules() {
  return h('section', { className: 'box box-rules' }, [
    h('h2', { key: 'h' }, 'Standing Rules'),
    h('div', { key: 'surface', className: 'box-surface' }, [
      h(
        'p',
        { key: 'empty', className: 'box-empty' },
        'Corrections you want to hold across every turn will live here. There are none yet.',
      ),
    ]),
  ]);
}

export default StandingRules;
