/**
 * The landing page's words (CLAUDE.md §12b).
 *
 * VERBATIM AND HUMAN-RATIFIED, including the punctuation. These are the sentences
 * a stranger reads before deciding whether to hand over an email address, and they
 * were written and approved word for word. Do not reword, resequence, or "tidy"
 * them. Kept in their own module so a change to them is a change to one file and
 * is visible as one line of a diff.
 *
 * Spelling is American throughout — *judgment*, matching the masthead's subtitle.
 *
 * `wordmarked()` below is the only transformation applied, and it is typographic
 * rather than editorial: it does not alter a character.
 */

import { h } from './h.js';

/** The pitch, above the form. */
export const LANDING_COPY = [
  // "Welcome to WordWright." opened this line in the ratified copy and was cut
  // 2026-09-08, on the human's read of the page as built: the lockup is two inches
  // above it, so the greeting was the reader's third look at the same name before
  // the page had said anything. The rest of the sentence is untouched. The seed
  // document still opens with the greeting — see src/seed-document.js — because
  // there it is the first thing said INSIDE the tool rather than beneath its sign.
  'This app exists to enable and enforce human judgment across all the writing you do with AI.',
  'WordWright is an environment where you and your AI agent work on one shared draft together. It automatically saves who changed what, turn by turn, in a history that lives alongside the document. You can write/hand-edit, prompt for edits, talk to the model without letting it touch the draft, save at will, restore to any earlier version, and export the whole process as a record you can share or inspect in the viewer.',
  'Sign up to try it free by entering your name and email:',
];

/**
 * What the visitor must understand about the link they have just been handed.
 *
 * It sits BESIDE the link on the success view, not below the fold and not behind a
 * dismissible notice, because §0.5 requires a namespace "be described that way to
 * anyone given a link" and this is the exact moment someone is given one.
 */
export const KEY_DISCLOSURE =
  "This link is your key and your storage unit. It's the only way back into your documents. " +
  'There is no login, and no automatic way to recover a lost link, so bookmark it now. ' +
  'And treat it like a key: anyone holding it can read and edit everything in it, so ' +
  "don't share it unless you want them to.";

/** The terms, at the foot of the landing page. */
export const DISCLAIMERS =
  'Disclaimers: WordWright is free during the beta period. We may change, limit, or ' +
  'discontinue features at any time without notice. The email address you provide will ' +
  'only be used to contact you about WordWright; we will not use it for any other ' +
  'purpose or share it with third parties. Your drafts and history are stored on our ' +
  'servers, but you should keep your own copies of anything important. AI-generated ' +
  'text may be inaccurate or unsuitable, so you are responsible for reviewing it before ' +
  'you rely on it.';

/** The product's name, as it is spelled everywhere. */
export const PRODUCT_NAME = 'WordWright';

/**
 * Set every occurrence of the product name in Allison, the masthead face.
 *
 * §12b: the name is the same object wherever it appears, so it wears the same face
 * in the lockup and in the middle of a sentence. Splitting the string is the whole
 * mechanism — no character is added, removed, or changed, so the ratified copy
 * stays ratified and a reader selecting the paragraph copies exactly what is
 * written above.
 *
 * NOT APPLIED TO THE SEED DOCUMENT. That is stored editor content in the canonical
 * Markdown dialect (§0.1, §1) and carries no font styling of any kind; see
 * src/seed-document.js.
 *
 * @param {string} text
 * @param {string} [keyPrefix] React keys, since this returns a fragment list
 * @returns {(string|object)[]}
 */
export function wordmarked(text, keyPrefix = 'w') {
  const parts = String(text ?? '').split(PRODUCT_NAME);
  const out = [];

  parts.forEach((part, index) => {
    if (part !== '') out.push(part);
    // One fewer name than parts, always: `a X b`.split('X') is `['a ', ' b']`.
    if (index < parts.length - 1) {
      out.push(
        h('span', { key: `${keyPrefix}${index}`, className: 'wordmark-inline' }, PRODUCT_NAME),
      );
    }
  });

  return out;
}
