/**
 * The history view (CLAUDE.md §4, §9 step 8): the turn log, a diff per turn, the
 * read-only view of any turn, and Restore.
 *
 * Three rules shape the markup here, and none of them is cosmetic.
 *
 * 1. THE LEDGER IS READ, NEVER WRITTEN. This component takes `history` and calls
 *    `onRestore`. It has no api, no session, and no way to mutate a turn. The §0.3
 *    invariant is asserted at every commit; nothing here is a commit.
 *
 * 2. DIFFS ARE COMPUTED AT DISPLAY TIME, from the two full snapshots (§0.4). A turn
 *    carries no diff field and must not grow one — a stored diff is a second
 *    representation of the same fact, free to drift from the text it describes.
 *
 * 3. MODEL SPEECH AND MODEL EDITS ARE DISTINCT RECORDS, and this UI never blends
 *    them. `.turn-speech` holds what the model SAID about the turn — today that is
 *    the §2.3 warnings, tomorrow it is a conversation channel — and `.turn-changes`
 *    holds what it DID. They are sibling regions with their own labels, so adding a
 *    reply channel is a new child of `.turn-speech` and not a rearrangement. The
 *    human's instruction is neither: it is the turn's provenance, and it sits in the
 *    record header with the author and the timestamp.
 */

import { useMemo, useState } from 'react';

import { wordDiff } from '../../src/diff.js';
import { h } from './h.js';

/** `2026-08-21T03:45:05.000Z` → something a person can read, in their own zone. */
function readableTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso ?? '';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A word-level diff as elements: insertions in `<ins>`, deletions in `<del>`,
 * everything else as plain text (§4).
 *
 * `<ins>` and `<del>` rather than styled spans, because the meaning has to survive
 * the stylesheet — colour alone is not a difference a screen reader or a colour-blind
 * reader can act on. The stylesheet adds green and red strikethrough on top.
 *
 * Nothing is elided. A long unchanged run makes for a long diff, and the alternative
 * — collapsing runs — is a rendering rule that can hide a change, which is the one
 * thing this view exists to prevent.
 */
function diffElements(parts) {
  return parts.map((part, index) => {
    const key = `p${index}`;
    if (part.added) return h('ins', { key, className: 'ins' }, part.value);
    if (part.removed) return h('del', { key, className: 'del' }, part.value);
    return h('span', { key, className: 'same' }, part.value);
  });
}

/**
 * One turn: the record header, the model's speech, the model's edits, and the
 * read-only snapshot.
 *
 * @param {{turn: object, previous: string, isCurrent: boolean, open: boolean,
 *   busy: boolean, onToggle: () => void, onRestore: (id: number) => void}} props
 */
function Turn({ turn, previous, isCurrent, open, busy, onToggle, onRestore }) {
  const isAi = turn.author === 'ai';
  // The diff itself, from the two full snapshots and nothing else. Memoized on the
  // snapshot pair, so opening a turn or re-rendering the panel does not re-diff.
  const parts = useMemo(() => wordDiff(previous, turn.snapshot), [previous, turn.snapshot]);
  const changed = parts.some((part) => part.added || part.removed);

  // ── the record header: who, when, and what they were asked ────────────────────
  const header = h('div', { key: 'head', className: 'turn-head' }, [
    h(
      'span',
      { key: 'badge', className: `badge badge-${turn.author}` },
      isAi ? 'AI' : 'Human',
    ),
    h('span', { key: 'id', className: 'turn-id' }, `Turn ${turn.turn_id}`),
    h('time', { key: 'time', className: 'turn-time', dateTime: turn.timestamp }, readableTime(turn.timestamp)),
    isCurrent
      ? h('span', { key: 'current', className: 'turn-current' }, 'the live draft')
      : null,
    h(
      'button',
      {
        key: 'restore',
        type: 'button',
        className: 'tool turn-restore',
        disabled: busy,
        // §4: one action, no confirmation. Restoring appends a turn; it destroys
        // nothing, so there is nothing to warn about — and a restore that is a
        // no-op says so afterwards rather than being blocked beforehand.
        onClick: () => onRestore(turn.turn_id),
      },
      'Restore to this turn',
    ),
  ]);

  // The instruction that caused the turn. Provenance, not commentary — it is the
  // human's words, and §3 stores it byte-for-byte as typed.
  const instruction = isAi
    ? h('p', { key: 'prompt', className: 'turn-prompt' }, [
        h('span', { key: 'k', className: 'record-label' }, 'Instruction'),
        h('q', { key: 'v', className: 'prompt-text' }, turn.prompt ?? ''),
      ])
    : null;

  // ── MODEL SPEECH ──────────────────────────────────────────────────────────────
  // What the model said about this turn, as opposed to what it did to the text.
  // Today: the §2.3 warnings and the structured stripped counts. A conversation
  // channel would be another child of this region and nothing else would move.
  const warnings = turn.warnings ?? [];
  const stripped = turn.stripped ?? null;
  const speech =
    warnings.length > 0 || stripped
      ? h(
          'div',
          { key: 'speech', className: 'turn-speech', 'aria-label': `What the model reported about turn ${turn.turn_id}` },
          [
            h('span', { key: 'k', className: 'record-label' }, 'Reported'),
            warnings.length > 0
              ? h(
                  'ul',
                  { key: 'warnings', className: 'turn-warnings' },
                  warnings.map((warning, index) => h('li', { key: `w${index}` }, warning)),
                )
              : null,
            // §2.3 requires the counts as structured data on the turn so the history
            // view can render them. Rendered from that field, not parsed back out of
            // the warning string.
            stripped
              ? h(
                  'dl',
                  { key: 'stripped', className: 'turn-stripped' },
                  Object.entries(stripped).flatMap(([construct, count]) => [
                    h('dt', { key: `k-${construct}` }, construct),
                    h('dd', { key: `v-${construct}` }, String(count)),
                  ]),
                )
              : null,
          ],
        )
      : null;

  // ── APPLIED CHANGES ───────────────────────────────────────────────────────────
  const changes = h(
    'div',
    { key: 'changes', className: 'turn-changes', 'aria-label': `What turn ${turn.turn_id} changed` },
    [
      h('span', { key: 'k', className: 'record-label' }, 'Changed'),
      changed
        ? h('p', { key: 'diff', className: 'diff' }, diffElements(parts))
        : h(
            'p',
            { key: 'nochange', className: 'diff diff-empty' },
            // §3: an AI turn commits even when the model returned identical text,
            // because the prompt is provenance. Saying so beats an empty box.
            isAi
              ? 'The model returned the draft unchanged. The turn is kept because the instruction is a fact about the session.'
              : 'No change to the text.',
          ),
    ],
  );

  // ── the read-only snapshot (§4) ───────────────────────────────────────────────
  // A <pre>, never an editor. §4 requires the text be selectable and copyable, and a
  // reader must never mistake it for the live draft — so it is plain, labelled, and
  // has nothing that takes a caret.
  const snapshot = open
    ? h('div', { key: 'snap', className: 'turn-snapshot' }, [
        h(
          'p',
          { key: 'label', className: 'snapshot-label' },
          `The whole draft as it stood at turn ${turn.turn_id}. Read-only — select and copy from here into the live draft above, where it commits as an ordinary human turn.`,
        ),
        h('pre', { key: 'text', className: 'snapshot-text', 'aria-readonly': 'true', tabIndex: 0 }, turn.snapshot),
      ])
    : null;

  return h(
    'li',
    { className: `turn turn-${turn.author}${isCurrent ? ' turn-live' : ''}` },
    [
      header,
      instruction,
      speech,
      changes,
      h(
        'button',
        {
          key: 'open',
          type: 'button',
          className: 'tool turn-open',
          'aria-expanded': open,
          onClick: onToggle,
        },
        open ? `Hide turn ${turn.turn_id}` : `Open turn ${turn.turn_id} read-only`,
      ),
      snapshot,
    ],
  );
}

/**
 * The timeline (§4). Newest first — the interesting end of a writing session is the
 * one you just made.
 *
 * @param {{history: object[], onRestore: (id: number) => void, busy?: boolean}} props
 */
export function History({ history = [], onRestore, busy = false }) {
  const [openTurn, setOpenTurn] = useState(null);

  const liveTurnId = history.length > 0 ? history[history.length - 1].turn_id : null;

  // Newest first for display; the PREVIOUS snapshot for each turn still comes from
  // its position in the real order, which is the only order the ledger has.
  const rows = history
    .map((turn, index) => ({ turn, previous: history[index - 1]?.snapshot ?? '' }))
    .reverse();

  return h('section', { className: 'history', 'aria-label': 'Turn history' }, [
    h('div', { key: 'head', className: 'history-head' }, [
      h('h2', { key: 'h' }, 'History'),
      h(
        'p',
        { key: 'note', className: 'hint' },
        `${history.length} turn${history.length === 1 ? '' : 's'}, newest first. ` +
          'Diffs are computed from the snapshots each time you look; they are never stored.',
      ),
    ]),

    history.length === 0
      ? h('p', { key: 'none', className: 'hint' }, 'No turns yet. Checkpoint, or send an instruction, and this fills in.')
      : h(
          'ol',
          { key: 'list', className: 'turn-list' },
          rows.map(({ turn, previous }) =>
            h(Turn, {
              key: turn.turn_id,
              turn,
              previous,
              isCurrent: turn.turn_id === liveTurnId,
              open: openTurn === turn.turn_id,
              busy,
              onToggle: () => setOpenTurn((was) => (was === turn.turn_id ? null : turn.turn_id)),
              onRestore,
            }),
          ),
        ),
  ]);
}

export default History;
