/**
 * Installs jsdom as the global DOM, AS A SIDE EFFECT OF BEING IMPORTED.
 *
 * The import-time part is not incidental. `react-dom` decides at module-evaluation
 * time whether a DOM exists (`canUseDOM`), and from that whether the browser
 * supports `input` events. Installed too late, react-dom concludes it is on IE and
 * falls back to a keypress/selectionchange polyfill, so `onChange` never fires and
 * every controlled input in a test appears frozen. So: import this module before
 * anything that reaches react-dom, and let the import do the work.
 *
 * jsdom is the test-only dependency approved in chunk 1. Nothing in src/ or
 * client/ imports it.
 */

import { JSDOM } from 'jsdom';

let installed = false;

export function installDom() {
  if (installed) return;

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

  // TipTap's `focus()` command defers through the global requestAnimationFrame,
  // which Node does not have. Without these, every toolbar command throws inside
  // the chain and the document is silently left unchanged — which is exactly how
  // the toolbar test first failed.
  globalThis.requestAnimationFrame ??= (callback) => window.requestAnimationFrame(callback);
  globalThis.cancelAnimationFrame ??= (handle) => window.cancelAnimationFrame(handle);

  installed = true;
}

installDom();
