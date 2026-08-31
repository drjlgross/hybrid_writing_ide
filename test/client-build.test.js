/**
 * The serve-time staleness gate (chunk 7 item 2).
 *
 * Every case runs against a real temp directory with real mtimes rather than a
 * mocked clock: the thing being tested is a filesystem comparison, and a stubbed
 * `statSync` would only prove the stub works.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BUILD_INPUTS, checkClientBuild, newestMtime } from '../src/client-build.js';

const roots = [];

function freshRoot() {
  const root = mkdtempSync(join(process.cwd(), '.tmp-test', 'build-'));
  roots.push(root);
  return root;
}

process.on('exit', () => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Write a file, creating parents, and stamp it at `seconds` past the epoch. */
function writeAt(root, relative, seconds, contents = 'x') {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
  utimesSync(path, seconds, seconds);
  return path;
}

const T0 = 1_700_000_000; // any fixed epoch second; only the ordering matters

test('a fresh clone with no dist is not stale — the no-build path still serves', () => {
  const root = freshRoot();
  writeAt(root, 'client/src/App.js', T0 + 500);
  writeAt(root, 'vite.config.js', T0 + 500);

  const result = checkClientBuild({ root });

  assert.equal(result.state, 'no-build');
  assert.equal(result.message, null, 'no-build must not produce a refusal message');
});

test('dist newer than every input is fresh', () => {
  const root = freshRoot();
  writeAt(root, 'client/src/App.js', T0);
  writeAt(root, 'client/src/styles.css', T0 + 10);
  writeAt(root, 'client/index.html', T0 + 10);
  writeAt(root, 'vite.config.js', T0 + 5);
  writeAt(root, 'client/dist/index.html', T0 + 100);
  writeAt(root, 'client/dist/assets/index-abc.js', T0 + 100);

  const result = checkClientBuild({ root });

  assert.equal(result.state, 'fresh');
  assert.equal(result.message, null);
});

test('the watched input set is exactly the one this chunk pinned', () => {
  // Asserted as a literal, not read from the module and compared to itself. The
  // loop below walks the same literal: iterating BUILD_INPUTS would shrink with
  // the list, so deleting an input would delete its own test and pass.
  assert.deepEqual(BUILD_INPUTS, ['client/src', 'client/index.html', 'vite.config.js']);
});

test('each build input can independently make the build stale', () => {
  // Walked one input at a time: a check that only watched client/src would pass
  // the suite while leaving a vite.config.js edit silently unserved.
  for (const input of ['client/src', 'client/index.html', 'vite.config.js']) {
    const root = freshRoot();
    writeAt(root, 'client/src/App.js', T0);
    writeAt(root, 'client/index.html', T0);
    writeAt(root, 'vite.config.js', T0);
    writeAt(root, 'client/dist/index.html', T0 + 100);

    // Touch this input, and only this one, after the build.
    const touched = input === 'client/src' ? 'client/src/App.js' : input;
    writeAt(root, touched, T0 + 200);

    const result = checkClientBuild({ root });
    assert.equal(result.state, 'stale', `${input} changed after the build must be stale`);
    assert.match(result.message, /npx vite build/, 'the message must name the command to run');
    assert.ok(
      result.newestInput.path.endsWith(touched.split('/').pop()),
      `the message must name ${touched}, not just "something"`,
    );
  }
});

test('a nested file deep under client/src counts', () => {
  const root = freshRoot();
  writeAt(root, 'client/dist/index.html', T0 + 100);
  writeAt(root, 'client/src/App.js', T0);
  writeAt(root, 'client/src/deep/deeper/thing.js', T0 + 300);

  assert.equal(checkClientBuild({ root }).state, 'stale');
});

test('a dotfile or .DS_Store beside the sources does not fake staleness', () => {
  const root = freshRoot();
  writeAt(root, 'client/src/App.js', T0);
  writeAt(root, 'client/dist/index.html', T0 + 100);
  writeAt(root, 'client/src/.DS_Store', T0 + 900);
  writeAt(root, 'client/src/.eslintrc', T0 + 900);

  assert.equal(
    checkClientBuild({ root }).state,
    'fresh',
    'opening the folder in Finder must not refuse to serve',
  );
});

test('equal mtimes are fresh, not stale', () => {
  // A build that writes dist in the same second as the source edit is the normal
  // case, not a failure. Strictly-newer is what makes the gate usable.
  const root = freshRoot();
  writeAt(root, 'client/src/App.js', T0 + 100);
  writeAt(root, 'client/dist/index.html', T0 + 100);

  assert.equal(checkClientBuild({ root }).state, 'fresh');
});

test('newestMtime returns null for an absent path and the newest entry for a tree', () => {
  const root = freshRoot();
  assert.equal(newestMtime(join(root, 'nope')), null);

  writeAt(root, 'tree/a.js', T0 + 1);
  writeAt(root, 'tree/b/c.js', T0 + 50);
  writeAt(root, 'tree/d.js', T0 + 2);

  assert.match(newestMtime(join(root, 'tree')).path, /c\.js$/);
});
