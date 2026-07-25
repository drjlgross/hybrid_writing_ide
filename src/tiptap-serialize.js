/**
 * TipTap → Markdown at a commit boundary (CLAUDE.md §0.6, §1).
 *
 * tiptap-markdown returns the document with no trailing newline; canonicalize()
 * always emits exactly one. That tail is the one part of the §0.1 fixed-point
 * mismatch that is ours to fix on the TipTap side, so it is fixed here.
 */

/**
 * @param {{ storage: { markdown: { serializer: { serialize: (doc: unknown) => string } } }, state: { doc: unknown } }} editor
 * @returns {string} Markdown in TipTap's dialect, newline-terminated (or '')
 */
export function serializeEditorMarkdown(editor) {
  const out = editor.storage.markdown.serializer.serialize(editor.state.doc);
  const trimmed = out.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return trimmed === '' ? '' : `${trimmed}\n`;
}

export default serializeEditorMarkdown;
