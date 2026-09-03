/**
 * Box 2 of the right column (CLAUDE.md §12): the model's response.
 *
 * THIS BOX HOLDS SPEECH AND NOTHING ELSE (§0.7, §12). What the model SAID goes
 * here; what it DID goes in the draft. Three rules follow from that, and none of
 * them is cosmetic:
 *
 *   - THE PANEL NEVER RESTATES THE DRAFT. Pasting revised prose in here would
 *     reintroduce exactly the whole-draft paste the success metric exists to
 *     eliminate. The server-side guard is `validateNote`, which warns when a note
 *     runs long enough to be the draft in disguise; this component is the other
 *     half — it renders the note and has no access to the draft at all.
 *   - A NEW PROMPT OVERWRITES IT (§12). The session clears `note` on submit.
 *     Prior responses live in the ledger and are reached through the history
 *     view, which is the only scrollback (§4).
 *   - VALIDATION WARNINGS ARE NOT SPEECH. §2.3's warnings are the system
 *     reporting on a turn, not the model talking, so they stay in the Prompt box
 *     beside the control that caused them (chunk 10's F52, kept in chunk 11).
 *
 * The note is rendered as TEXT, in the white `.box-surface` the Prompt textarea
 * shares (§12). Its Markdown is not converted to rich text: there is no
 * Markdown-to-HTML renderer among the packages §5 names, and §7 already accepts
 * Markdown source on screen in the diff view. `white-space: pre-wrap` keeps the
 * model's own line breaks and bullets legible, which is most of what the
 * formatting was doing.
 *
 * THE SURFACE IS STRUCTURAL, NOT CONDITIONAL (§12). It is rendered on every one of
 * the states below, including before any turn has spoken, so the rail reads as
 * three parallel boxes at first paint. The empty-state sentence goes INSIDE it,
 * the way a textarea's placeholder sits inside the textarea — an empty box is a
 * box with nothing in it yet, not a box with no surface.
 */

import { h } from './h.js';

/**
 * @param {{note: string|null, speechOnly?: boolean, pending?: boolean}} props
 *   `note` is null before any turn has spoken and '' when a turn spoke and said
 *   nothing — a different fact, and rendered differently.
 */
export function ModelResponse({ note = null, speechOnly = false, pending = false }) {
  // What goes ON the surface. Exactly one of these, and the surface itself is not
  // one of the choices — it is always there.
  let content;
  if (pending) {
    // Not the pre-turn state while a turn is in flight: that is the state this box
    // was in before the turn started, so leaving it says nothing is happening.
    content = h('p', { key: 'pending', className: 'box-empty', role: 'status' }, 'Waiting for the model.');
  } else if (note === null) {
    content = h(
      'p',
      { key: 'empty', className: 'box-empty' },
      'What the model says about the draft will appear here. It has nothing to say yet.',
    );
  } else if (note === '') {
    // §0.7 says every AI turn returns a note, so an empty one is an anomaly rather
    // than a state. §4's rule that a speech-only turn must not look like a
    // rendering failure applies with more force here, not less.
    content = h('p', { key: 'silent', className: 'box-empty' }, 'The turn committed, but the model said nothing.');
  } else {
    content = note;
  }

  return h('section', { className: 'box box-response' }, [
    h('h2', { key: 'h' }, 'Model Response'),
    h('div', { key: 'surface', className: 'box-surface' }, content),

    // §0.9's degenerate case, stated positively: the model spoke and touched no
    // text. Below the surface, not on it — it is a fact about the turn, not part
    // of what the model said.
    !pending && note
      ? h(
          'p',
          { key: 'scope', className: 'hint note-scope' },
          speechOnly
            ? 'No change to the draft — this turn was speech only.'
            : 'The draft was changed by this turn; the change is in the editor, not here.',
        )
      : null,
  ]);
}

export default ModelResponse;
