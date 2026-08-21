/**
 * `createElement`, shortened.
 *
 * There is no JSX in this client, on purpose. Node cannot load a `.jsx` file, so
 * JSX would mean a transform step that exists only to let the tests import a
 * component — a build tool in the test path, standing between the test and the
 * thing it is testing. Every component here is plain JS that Node, Vite, and
 * `node --test` all read identically.
 *
 *     h('button', { className: 'tool', onClick: run }, label)
 */
export { createElement as h, Fragment } from 'react';
