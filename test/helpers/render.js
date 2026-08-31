/**
 * Render a React component into jsdom, headlessly.
 *
 * Reuses the DOM the §0.1 fixed-point test already installs — the same jsdom
 * approved in chunk 1 — so no new dependency appears here. React 19's own `act`
 * is used; there is no testing library.
 *
 * The components are written with `createElement` rather than JSX precisely so
 * that this file can import them with no transform in the way.
 */

// FIRST, and deliberately so: react-dom decides at import time whether a DOM
// exists. See the note in ./dom.js — installed after react-dom, `onChange` never
// fires and every controlled input in these tests looks frozen.
import './dom.js';

import { act } from 'react';
import { createRoot } from 'react-dom/client';

// React refuses to batch updates outside an act() scope without this, and warns.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * @param {import('react').ReactElement} element
 * @returns {Promise<{container: HTMLElement, rerender: Function, unmount: Function,
 *   text: () => string, find: Function, findAll: Function, click: Function,
 *   flush: Function}>}
 */
export async function render(element) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });

  /** Let pending promises settle and React re-render. */
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const findAll = (selector) => [...container.querySelectorAll(selector)];

  const find = (selector) => container.querySelector(selector);

  /** The first element whose trimmed text equals `label`. */
  const findByText = (selector, label) =>
    findAll(selector).find((node) => node.textContent.trim() === label);

  const click = async (node) => {
    if (!node) throw new Error('click: no such element');
    await act(async () => {
      node.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true }));
    });
  };

  /**
   * Type into a controlled input or textarea.
   *
   * Assigning `.value` directly is not enough: React keeps its own value tracker
   * on the node and skips the change event when the new value matches what it
   * last wrote, so a plain assignment silently does nothing. Going through the
   * prototype's native setter is what the tracker watches for.
   */
  const type = async (node, value) => {
    if (!node) throw new Error('type: no such element');
    const prototype =
      node.tagName === 'TEXTAREA'
        ? globalThis.window.HTMLTextAreaElement.prototype
        : globalThis.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);

    await act(async () => {
      node.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));
    });
  };

  /**
   * Run something that mutates state OUTSIDE React — a TipTap command, say —
   * inside an act() scope.
   *
   * Toolbar subscribes to the editor's `selectionUpdate` and `transaction`
   * events and calls setState from them, so any direct editor command in a test
   * is a React state update React cannot see coming. Without this the suite
   * passes while printing "an update was not wrapped in act(...)", and the
   * render it warns about is genuinely not flushed before the next assertion.
   */
  const actIn = async (fn) => {
    await act(async () => {
      await fn();
    });
  };

  return {
    container,
    act: actIn,
    flush,
    find,
    findAll,
    findByText,
    click,
    type,
    text: () => container.textContent,
    async rerender(next) {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
