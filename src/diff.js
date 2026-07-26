/**
 * Word-level diffs between snapshots (CLAUDE.md §5).
 *
 * Diffs are computed on demand and never stored — a snapshot pair is the source
 * of truth, and a stored diff is one more thing that can drift from the text.
 *
 * §2.1 item 2 is what this exists for: the model receives the current draft on
 * every call regardless, but it cannot see WHAT the human just changed unless the
 * diff is sent. Without it, "don't undo my edits" is an instruction the model has
 * no way to follow.
 */

import { diffWords } from 'diff';

/**
 * Word-level diff between two snapshots.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{added?: boolean, removed?: boolean, value: string}[]}
 */
export function wordDiff(before, after) {
  return diffWords(before ?? '', after ?? '');
}

/** True when the two snapshots differ at all. */
export function hasChanges(before, after) {
  return wordDiff(before, after).some((part) => part.added || part.removed);
}

/**
 * Render a diff for the API payload (§2.1 item 2).
 *
 * Plain text rather than a patch format: the model reads prose better than it
 * reads unified diff hunks, and the goal is for it to understand which words are
 * the human's, not to apply the patch.
 *
 * @param {string} before
 * @param {string} after
 * @returns {string|null} null when nothing changed
 */
export function formatDiffForPrompt(before, after) {
  const parts = wordDiff(before, after);
  if (!parts.some((part) => part.added || part.removed)) return null;

  const lines = [];
  for (const part of parts) {
    const value = part.value.trim();
    if (value === '') continue;
    if (part.added) lines.push(`ADDED BY THE HUMAN: ${JSON.stringify(value)}`);
    else if (part.removed) lines.push(`REMOVED BY THE HUMAN: ${JSON.stringify(value)}`);
  }

  return lines.length === 0 ? null : lines.join('\n');
}
