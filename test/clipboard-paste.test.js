/**
 * TipTap's paste filtering, against real clipboard HTML (CLAUDE.md §5, §9 step 7).
 *
 * §5: "a separate fixture holding real HTML copied from Word and from Google Docs
 * (including hyperlinks and the span/style noise both produce), fed through
 * TipTap's clipboardTextParser, asserting everything outside the dialect is
 * stripped and the prose plus links survive."
 *
 * ONE DEPARTURE FROM THE LETTER OF §5, reported as a finding: the payload goes
 * through `view.pasteHTML`, not `clipboardTextParser`. `clipboardTextParser` is
 * the hook for the PLAIN-TEXT clipboard flavour; the HTML flavour — the one §5 is
 * actually about, and the only one that carries span/style noise — is parsed by
 * `parseFromClipboard`, which `pasteHTML` is the public way into. Testing through
 * `clipboardTextParser` would feed these files in as literal text and assert
 * nothing about filtering.
 *
 * What this catches that the Markdown round-trip cannot: a heading, a table or a
 * `<b>` wrapper surviving the paste puts a construct into the editor that the
 * store's dialect has no name for. §2.3's stripper guards the model's output; this
 * is the same guarantee on the human's.
 */

// Before anything that reaches a DOM. See test/helpers/dom.js.
import './helpers/dom.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalize } from '../src/canonicalize.js';
import { serializeEditorMarkdown } from '../src/tiptap-serialize.js';
import {
  CLIPBOARD_FIXTURES,
  DIALECT_MARKS,
  DIALECT_NODES,
} from './fixtures/clipboard/index.js';
import { createEditor, tiptapRoundTrip } from './helpers/headless-editor.js';

/**
 * Paste HTML into an empty editor the way a browser would.
 *
 * `pasteHTML` needs a paste event; jsdom has no ClipboardEvent, so a plain Event
 * stands in. ProseMirror only reads the event to decide whether to let the
 * default happen, and there is no default here.
 */
function pasteInto(html) {
  const editor = createEditor('');
  try {
    editor.view.pasteHTML(html, new globalThis.window.Event('paste'));
    const markdown = serializeEditorMarkdown(editor);

    const nodes = new Set();
    const marks = new Set();
    editor.state.doc.descendants((node) => {
      nodes.add(node.type.name);
      for (const mark of node.marks) marks.add(mark.type.name);
    });

    return { markdown, nodes, marks };
  } finally {
    editor.destroy();
  }
}

// ── the fixture is not empty ────────────────────────────────────────────────────

test('the clipboard fixtures contain what §5 requires of them', () => {
  // A passing paste test over an empty fixture proves nothing. Walked item by
  // item so a gutted fixture fails HERE, naming the construct that went missing.
  for (const fixture of CLIPBOARD_FIXTURES) {
    for (const [label, present] of fixture.required) {
      assert.equal(present(fixture.html), true, `${fixture.source} fixture is missing: ${label}`);
    }
  }
});

// ── everything outside the dialect is stripped ──────────────────────────────────

for (const fixture of CLIPBOARD_FIXTURES) {
  test(`${fixture.source}: a paste lands in the dialect and nothing else`, () => {
    const { nodes, marks } = pasteInto(fixture.html);

    for (const node of nodes) {
      assert.equal(DIALECT_NODES.has(node), true, `${node} is outside the v1 dialect (§1)`);
    }
    for (const mark of marks) {
      assert.equal(DIALECT_MARKS.has(mark), true, `${mark} is outside the v1 dialect (§1)`);
    }

    // Named individually as well as by the set membership above: these are the
    // constructs both applications put in the payload, and "no heading node"
    // is the claim worth reading in a failure message.
    for (const forbidden of ['heading', 'table', 'tableRow', 'tableCell', 'image', 'codeBlock', 'hardBreak', 'orderedList', 'blockquote']) {
      assert.equal(nodes.has(forbidden), false, `${forbidden} must not survive a paste`);
    }
    for (const forbidden of ['strike', 'code', 'underline', 'textStyle', 'highlight']) {
      assert.equal(marks.has(forbidden), false, `the ${forbidden} mark must not survive a paste`);
    }
  });

  test(`${fixture.source}: the prose and the links survive`, () => {
    const { markdown } = pasteInto(fixture.html);

    // Prose, in order. Stripping a heading must keep its words as a paragraph —
    // the §2.3 rule that loss is visible rather than silent, applied here.
    let cursor = 0;
    for (const phrase of fixture.prose) {
      const at = markdown.indexOf(phrase, cursor);
      assert.notEqual(at, -1, `"${phrase}" did not survive the paste`);
      cursor = at;
    }

    for (const [text, href] of fixture.links) {
      assert.ok(
        markdown.includes(`[${text}](${href}`),
        `the link "${text}" → ${href} did not survive as [text](url)`,
      );
    }

    assert.match(markdown, new RegExp(`\\*\\*${fixture.bold}\\*\\*`), 'bold must survive');
    assert.match(markdown, new RegExp(`(^|[^*])\\*${fixture.italic}\\*`), 'italic must survive');
  });

  test(`${fixture.source}: what a paste produces is safe for the store`, () => {
    // The paste is only harmless if its Markdown behaves like every other draft:
    // canonical, idempotent, and round-trip identical. Otherwise a paste writes a
    // snapshot that produces a phantom diff on the next turn (§0.1).
    const { markdown } = pasteInto(fixture.html);
    const canonical = canonicalize(markdown);

    assert.equal(canonicalize(canonical), canonical, 'canonicalize must be idempotent on a paste');
    assert.equal(
      canonicalize(tiptapRoundTrip(canonical)),
      canonical,
      'a pasted draft must round-trip byte-identically (§0.1)',
    );
    assert.equal(canonical.includes('+ '), false, 'no + bullet may reach the store');
  });
}

// ── the two payload-specific traps, named ───────────────────────────────────────

test('Google Docs: the <b> wrapper does not bold the entire paste', () => {
  // Google Docs wraps every payload in <b style="font-weight:normal">. A parser
  // that reads the tag and ignores the style turns every pasted document into one
  // bold block, and the human then hand-unbolds text they never bolded. This is
  // the single most consequential thing in this file.
  //
  // The assertion is on the OUTCOME, not on a mechanism. Probing during chunk 7
  // showed the wrapper is harmless even when its font-weight:normal is removed,
  // so it is the paste pipeline rather than Bold's font-weight guard that saves
  // us here — but which one does the work is not what has to stay true.
  const fixture = CLIPBOARD_FIXTURES.find((f) => f.source === 'Google Docs');
  const { markdown } = pasteInto(fixture.html);

  assert.ok(markdown.includes('**bold text**'), 'the genuinely bold run stays bold');
  assert.equal(
    markdown.includes('**A Heading Google Docs Insists On**'),
    false,
    'and nothing else is bolded by the wrapper',
  );
  assert.equal(
    (markdown.match(/\*\*/g) ?? []).length,
    2,
    'exactly one bold run in the whole paste — the one that was actually bold',
  );
});

test('Google Docs: a real <ul> survives as a real bullet list, tight in the store', () => {
  const fixture = CLIPBOARD_FIXTURES.find((f) => f.source === 'Google Docs');
  const { markdown, nodes } = pasteInto(fixture.html);

  assert.equal(nodes.has('bulletList'), true);
  assert.equal(nodes.has('listItem'), true);

  // TipTap serializes the pasted list LOOSE (a blank line between items);
  // canonicalize makes it tight, which is §0.1's rule and the reason a paste
  // cannot introduce a phantom diff on the next turn.
  assert.match(markdown, /- First Docs bullet.*\n\n- Second Docs bullet/);
  assert.match(
    canonicalize(markdown),
    /- First Docs bullet, a real list item\n- Second Docs bullet/,
    'the canonical form is tight',
  );
});

test('Word: mso-list bullets arrive as paragraphs, glyph and all', () => {
  // Word does not use <ul>. Its bullets are paragraphs with a Symbol-font
  // character and non-breaking spaces faking the indent, so what lands is prose
  // beginning with "·". Nothing is lost, but nothing becomes a list either.
  // Asserted rather than left to be discovered mid-sentence; named as a finding.
  const fixture = CLIPBOARD_FIXTURES.find((f) => f.source === 'Word');
  const { markdown, nodes } = pasteInto(fixture.html);

  assert.equal(nodes.has('bulletList'), false, 'Word bullets are not lists — this is the fact');
  assert.match(markdown, /·\s+First Word bullet/);
  assert.ok(
    markdown.includes('[bulleted link](https://example.com/bulleted)'),
    'the link inside the fake bullet still survives',
  );
});
