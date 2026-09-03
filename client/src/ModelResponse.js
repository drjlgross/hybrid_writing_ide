/**
 * Box 2 of the right column (CLAUDE.md §12): the model's response.
 *
 * EMPTY BY DESIGN IN THIS CHUNK. §0.7 — every AI turn returns a note — lands in
 * step 11, and the §2.2 response has no `note` field until it does. So this box
 * holds its place in the layout and says what it is for, and nothing more.
 *
 * The empty state is written as a sentence rather than left blank on purpose:
 * §4's rule that a speech-only turn "must not look like a rendering failure"
 * applies to a box that has never been filled at all.
 *
 * Two rules from §12 that constrain whatever fills this later:
 *
 *   - A new prompt OVERWRITES it. Prior responses live in the ledger and are
 *     reached through the history view, which is the only scrollback (§4).
 *   - THE PANEL NEVER RESTATES THE DRAFT. Speech goes here; text goes in the
 *     draft (§0.7, §12). Pasting revised prose into this box would reintroduce
 *     the whole-draft paste the success metric exists to eliminate.
 */

import { h } from './h.js';

export function ModelResponse() {
  return h('section', { className: 'box box-response' }, [
    h('h2', { key: 'h' }, 'Model Response'),
    h(
      'p',
      { key: 'empty', className: 'hint box-empty' },
      'What the model says about the draft will appear here. It has nothing to say yet.',
    ),
  ]);
}

export default ModelResponse;
