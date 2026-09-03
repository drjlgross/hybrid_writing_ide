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
 *    them (§0.7, §4, §9 S12). A turn now carries THREE separable records and each
 *    one is its own labelled region:
 *
 *      .turn-speech    the model's `note` — what it SAID (§0.7)
 *      .turn-reported  the §2.3 warnings and stripped counts — what the SYSTEM
 *                      observed about the response
 *      .turn-changes   the diff — what the turn DID
 *
 *    Chunk 8 put the warnings in `.turn-speech` because it was the only non-diff
 *    record a turn had. It is not speech: a validation warning is the system
 *    reporting, not the model talking (chunk 10's F52), and now that real speech
 *    exists the two cannot share a box without blending exactly what §9's S12
 *    forbids. So `.turn-speech` is the note, and the warnings moved out into
 *    `.turn-reported`. Named in the chunk-11 report.
 *
 *    The human's instruction is none of the three: it is the turn's provenance,
 *    and it sits in the record header with the author and the timestamp.
 */

import { useMemo, useState } from 'react';

import { groupDiffRegions, wordDiff } from '../../src/diff.js';
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
function inlineElements(parts, keyPrefix = 'p') {
  return parts.map((part, index) => {
    const key = `${keyPrefix}${index}`;
    if (part.added) return h('ins', { key, className: 'ins' }, part.value);
    if (part.removed) return h('del', { key, className: 'del' }, part.value);
    return h('span', { key, className: 'same' }, part.value);
  });
}

/**
 * The diff, region by region (§4).
 *
 * A region whose changed fraction is over the threshold renders as a DELETION
 * BLOCK followed by an ADDITION BLOCK rather than as interleaved word-level
 * marks. `groupDiffRegions` decides which; this only renders the decision.
 *
 * The failure it fixes is in the ledger. Turn 10 → 11 of the first live session
 * replaced a trailing paragraph, and because old and new shared "a", "is", "."
 * and "-", the word diff stitched ten alternating delete/add pairs through the
 * new prose. The data was right and the rendering was unreadable.
 *
 * Nothing is summarized: a replacement region's two strings reconstruct that
 * region's before-text and after-text exactly, so this changes how a change is
 * shown and never whether it is shown.
 */
function diffElements(regions) {
  return regions.map((region, index) => {
    const key = `r${index}`;
    if (region.type === 'inline') return inlineElements(region.parts, `${key}-`);

    return h('div', { key, className: 'diff-replacement' }, [
      // An empty side is skipped rather than rendered as an empty box: a region
      // only blocks when it has both, but the markup should not depend on that.
      region.removed === ''
        ? null
        : h('del', { key: 'was', className: 'del diff-block' }, region.removed),
      region.added === ''
        ? null
        : h('ins', { key: 'now', className: 'ins diff-block' }, region.added),
    ]);
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
  // Grouped separately from the diff itself so the memo keys stay honest: the
  // regions are a pure function of the parts, and the parts of the snapshot pair.
  const regions = useMemo(() => groupDiffRegions(parts), [parts]);
  // §0.9's degenerate case: an AI turn that spoke and touched no text.
  const isSpeechOnly = isAi && !changed && typeof turn.note === 'string' && turn.note !== '';

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

  // ── MODEL SPEECH (§0.7) ───────────────────────────────────────────────────────
  // The model's note: what it SAID, as opposed to what it did to the text. §4
  // requires it render "as speech, visually distinct from any text change. Never
  // blended." It is rendered as text, `white-space: pre-wrap` — the same treatment
  // the Model Response box gives it, for the same reason (see ModelResponse.js).
  // Gated on `isAi` as well as on the field: §3 gives `note` to AI turns only, and
  // a human turn rendering one would mean the view had started attributing speech
  // to whoever's record happened to carry the key.
  const speech =
    isAi && typeof turn.note === 'string' && turn.note !== ''
      ? h(
          'div',
          { key: 'speech', className: 'turn-speech', 'aria-label': `What the model said on turn ${turn.turn_id}` },
          [
            h('span', { key: 'k', className: 'record-label' }, 'Note'),
            h('div', { key: 'note', className: 'box-surface' }, turn.note),
          ],
        )
      : null;

  // ── WHAT THE SYSTEM OBSERVED (§2.3) ──────────────────────────────────────────
  // Warnings and stripped counts. NOT the model talking — see the header note.
  const warnings = turn.warnings ?? [];
  const stripped = turn.stripped ?? null;
  const reported =
    warnings.length > 0 || stripped
      ? h(
          'div',
          { key: 'reported', className: 'turn-reported', 'aria-label': `What was reported about turn ${turn.turn_id}` },
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
        // A <div>, not a <p>: a replacement region renders block-level children,
        // and a <p> may not contain them.
        ? h('div', { key: 'diff', className: 'diff' }, diffElements(regions))
        : h(
            'p',
            { key: 'nochange', className: `diff diff-empty${isAi ? ' diff-unchanged' : ''}` },
            // §4: "A speech-only turn renders as a note with an explicit 'no change
            // to the draft' marker. It must not look like a rendering failure."
            // §0.9 is why the wording is a positive assertion rather than an
            // apology: an unchanged snapshot is the model stating that it touched
            // nothing, which is stronger than the absence of a record.
            //
            // The other AI case — the model returned text that happened to be
            // identical — reads the same from the ledger and says the same thing.
            // §3 keeps both, because the prompt is provenance either way.
            isAi
              ? isSpeechOnly
                ? 'No change to the draft. The model answered without proposing a revision, and the turn is kept because the question and the answer are facts about the session.'
                : 'No change to the draft. The model returned the draft unchanged, and the turn is kept because the instruction is a fact about the session.'
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
      reported,
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
