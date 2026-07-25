/**
 * Runs the real TipTap editor in Node so the §0.1 fixed-point test exercises
 * TipTap's actual serializer rather than a reimplementation of it.
 *
 * TipTap builds a ProseMirror EditorView, which needs a DOM; jsdom supplies one.
 * This lives in test/ only — nothing in src/ depends on it.
 */

import { JSDOM } from 'jsdom';
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../../src/tiptap-config.js';
import { serializeEditorMarkdown } from '../../src/tiptap-serialize.js';

let domInstalled = false;

function installDom() {
  if (domInstalled) return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.navigator ??= window.navigator;
  for (const name of [
    'Node',
    'Element',
    'HTMLElement',
    'DocumentFragment',
    'DOMParser',
    'XMLSerializer',
    'Range',
    'Selection',
    'getComputedStyle',
    'MutationObserver',
    'ClipboardEvent',
    'DragEvent',
  ]) {
    if (globalThis[name] === undefined && window[name] !== undefined) {
      globalThis[name] = window[name];
    }
  }
  domInstalled = true;
}

/**
 * Create a headless TipTap editor whose document is parsed from Markdown.
 * @param {string} markdown
 */
export function createEditor(markdown = '') {
  installDom();
  return new Editor({
    element: globalThis.document.createElement('div'),
    extensions: buildExtensions(),
    content: markdown,
  });
}

/**
 * TipTap's own Markdown serialization of a document, exactly as the app will do
 * it at a commit boundary.
 * @param {import('@tiptap/core').Editor} editor
 * @returns {string}
 */
export function tiptapSerialize(editor) {
  return serializeEditorMarkdown(editor);
}

/** Parse Markdown into a TipTap doc and serialize it straight back out. */
export function tiptapRoundTrip(markdown) {
  const editor = createEditor(markdown);
  try {
    return tiptapSerialize(editor);
  } finally {
    editor.destroy();
  }
}
