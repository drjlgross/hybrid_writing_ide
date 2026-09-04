/**
 * Pre-commit secret scanning (CLAUDE.md § Operating rules).
 *
 * TWO RULES SHAPE THIS FILE.
 *
 * 1. No test may touch the real repository's staging area, or leave `git status`
 *    different from how it found it. Every git-level test builds a throwaway
 *    repo under `.tmp-test/`, which is gitignored and disposable.
 *
 * 2. NO SYNTHETIC KEY APPEARS AS A LITERAL ANYWHERE IN THIS FILE. Every one is
 *    assembled at runtime from fragments. A test fixture written out in full
 *    would be a key-shaped string in a tracked file, which is precisely what the
 *    scanner exists to reject — the suite would fail on itself, and the obvious
 *    fix would be to weaken the pattern.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_KEY_CHARS,
  PATTERNS,
  formatReport,
  redact,
  scanRepository,
  scanText,
  scanTracked,
} from '../scripts/secret-scan.js';

const TMP_ROOT = fileURLToPath(new URL('../.tmp-test/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** A realistic key shape with entirely fake material, built at runtime. */
const syntheticKey = (variant = 'api03') =>
  ['sk', 'ant', variant].join('-') + '-' + 'A1b2C3d4E5'.repeat(9) + 'wXyZ';

/** A throwaway git repo. Never the real one. */
function fixtureRepo() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'secret-scan-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '.');
  git('config', 'user.email', 'fixture@example.com');
  git('config', 'user.name', 'fixture');
  return {
    dir: `${dir}/`,
    path: (name) => join(dir, name),
    write: (name, text) => writeFileSync(join(dir, name), text),
    stage: () => git('add', '-A'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * A directory where git genuinely cannot run.
 *
 * A `.git` FILE pointing at nothing, rather than an empty directory: an empty
 * directory inside this repo would let git's discovery walk up and find the real
 * repository, so the fixture would silently test the wrong thing.
 */
function brokenRepo() {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'secret-scan-nogit-'));
  writeFileSync(join(dir, '.git'), 'gitdir: /nonexistent-path-for-this-fixture\n');
  return { dir: `${dir}/`, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── the pattern: what it catches ────────────────────────────────────────────────

test('a real-shaped key is caught, whatever it is wrapped in', () => {
  const key = syntheticKey();
  assert.equal(key.length, 107, 'the fixture is the length of a real key');

  for (const line of [
    `const KEY = "${key}";`,
    `ANTHROPIC_API_KEY=${key}`,
    `curl -H "x-api-key: ${key}"`,
    `  # leftover: ${key}`,
    `{"apiKey":"${key}"}`,
  ]) {
    const findings = scanText(line);
    assert.ok(findings.length > 0, `should have caught: ${line.replace(key, '<key>')}`);
  }

  // A variant tag this scanner has never seen is still a key.
  assert.ok(scanText(`KEY=${syntheticKey('admin01')}`).length > 0, 'an unknown variant tag');
  assert.ok(scanText(`KEY=${syntheticKey('future99')}`).length > 0, 'a future variant tag');
});

test('the line number and file reach the finding', () => {
  const findings = scanText(`clean\nclean\nleaked = "${syntheticKey()}"\n`, { file: 'a/b.js' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'a/b.js');
  assert.equal(findings[0].line, 3, 'the line the secret is actually on');
});

// ── the pattern: what it deliberately does NOT catch ────────────────────────────

test('documentation placeholders pass, and pass structurally', () => {
  // These three are the real ones in the tree — README twice, live-check once.
  const placeholders = [
    'export ANTHROPIC_API_KEY=sk-ant-...',
    'ANTHROPIC_API_KEY=sk-ant-... npm run live-check',
    "'    ANTHROPIC_API_KEY=sk-ant-... node scripts/live-check.js\\n\\n' +",
  ];
  for (const line of placeholders) assert.deepEqual(scanText(line), [], line);

  // They pass because `.` is not in the key charset, not because the exact
  // strings are allowlisted — so a placeholder somebody writes next year passes
  // for the same reason. No allowlist exists, deliberately: an allowlist is a
  // place to hide a real finding.
  for (const line of [
    'ANTHROPIC_API_KEY=sk-ant-<your key here>',
    'ANTHROPIC_API_KEY=sk-ant-YOUR-KEY',
    'ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY',
    'ANTHROPIC_API_KEY=${SECRET}',
    'set ANTHROPIC_API_KEY to the value from 1Password',
    'the key is sk-ant-api03-… (redacted)',
  ]) {
    assert.deepEqual(scanText(line), [], line);
  }

  const source = PATTERNS.map((p) => p.regex.source).join(' ');
  assert.doesNotMatch(source, /sk-ant-\.\.\./, 'placeholders are not enumerated in the pattern');
});

test('a fragment too short to be a credential passes', () => {
  // The prefix that leaked into a transcript was 18 characters. It is not
  // something anyone can authenticate with, and treating it as a finding would
  // train people to ignore findings.
  assert.deepEqual(scanText('saw sk-ant-api03-uOph5 in a screenshot'), []);
  assert.deepEqual(scanText(`KEY=sk-ant-api03-${'A'.repeat(MIN_KEY_CHARS - 20)}`), []);

  // But one character over the floor is a finding.
  assert.ok(scanText(`KEY=sk-ant-api03-${'A'.repeat(MIN_KEY_CHARS)}`).length > 0);
});

test('long non-secret identifiers do not trip it', () => {
  for (const line of [
    'const sha = "0adf03d7f55f612ab7cd67b57ea3f4b4055a66a3";',
    'https://example.com/a/very/long/path/that/goes/on/and/on/for/ages/indeed',
    `const hash = "${'a1b2c3d4'.repeat(8)}";`,
  ]) {
    assert.deepEqual(scanText(line), [], line);
  }
});

// ── redaction: the scanner must not become the leak ─────────────────────────────

test('no character of the secret survives into the report', () => {
  const key = syntheticKey();
  const report = formatReport({
    findings: scanText(`ANTHROPIC_API_KEY=${key}`, { file: '.env.example' }).map((f) => ({
      ...f,
      origin: 'staged',
    })),
    staged: { files: 1 },
    tracked: { files: 0 },
  });

  assert.doesNotMatch(report, new RegExp(key), 'the whole key');
  assert.doesNotMatch(report, /A1b2C3d4E5/, 'nor any run of its material');
  assert.doesNotMatch(report, /sk-ant-api03-A/, 'nor a prefix — "the first 11 characters" is how a key reaches a transcript');
  assert.match(report, /REDACTED \d+-char secret/, 'the shape is reported instead');
  assert.match(report, /ANTHROPIC_API_KEY=/, 'with enough context to find the line');

  // The redaction helper itself keeps nothing.
  assert.doesNotMatch(redact(key), new RegExp(key.slice(0, 12)));
});

// ── the two directions, at the git level ────────────────────────────────────────

test('DIRECTION A: the real repository scans clean', () => {
  // The tree as it stands, placeholders and all. This is the assertion that
  // would fail if someone committed a key, and the one that fails today if the
  // pattern is made too eager.
  const result = scanRepository({ cwd: REPO_ROOT });
  assert.deepEqual(
    result.findings.map((f) => `${f.file}:${f.line}`),
    [],
    'the tracked tree must contain no key material',
  );
  assert.ok(result.tracked.files > 50, `and the scan really looked: ${result.tracked.files} files`);
});

test('DIRECTION B: a staged synthetic key fails the scan, with a redacted report', () => {
  // A scanner only ever observed passing is a stub. This is the other direction,
  // in a throwaway repo — the real staging area is never touched.
  const repo = fixtureRepo();
  try {
    const key = syntheticKey();
    repo.write('config.js', `export const KEY = '${key}';\n`);
    repo.write('README.md', 'Set ANTHROPIC_API_KEY=sk-ant-... before running.\n');
    repo.stage();

    const result = scanRepository({ cwd: repo.dir });
    assert.equal(result.findings.length, 1, 'one secret, reported once — not once per scan');

    const [finding] = result.findings;
    assert.equal(finding.file, 'config.js');
    assert.equal(finding.line, 1);
    assert.equal(finding.origin, 'staged', 'the staged origin wins: it is the actionable one');
    assert.equal(finding.rule, 'anthropic-api-key');

    const report = formatReport(result);
    assert.match(report, /SECRET SCAN FAILED/);
    assert.match(report, /config\.js:1/);
    assert.doesNotMatch(report, new RegExp(key), 'and still no key material');
    assert.doesNotMatch(report, /README/, 'the placeholder beside it did not trip');
  } finally {
    repo.cleanup();
  }
});

test('the CLI exits non-zero on a finding and zero when clean', () => {
  const repo = fixtureRepo();
  try {
    repo.write('clean.js', 'export const KEY = process.env.ANTHROPIC_API_KEY;\n');
    repo.stage();
    assert.equal(scanRepository({ cwd: repo.dir }).findings.length, 0, 'clean → nothing to report');

    repo.write('leak.js', `const k = '${syntheticKey()}';\n`);
    repo.stage();
    assert.ok(scanRepository({ cwd: repo.dir }).findings.length > 0, 'dirty → a finding');
  } finally {
    repo.cleanup();
  }
});

// ── the boundary that matters most ──────────────────────────────────────────────

test('the scanner never reads .env', () => {
  // A scanner that opens the secret file to look for secrets has become one more
  // process holding the key. It scans TRACKED and STAGED content only, and .env
  // is gitignored, so it is in neither set. Asserted two ways.
  const listed = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.doesNotMatch(listed, /^\.env$/m, '.env is not tracked');

  const ignored = execFileSync('git', ['check-ignore', '.env'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.match(ignored, /\.env/, 'and it is ignored, so it cannot be staged either');

  // And the CODE contains no path that could reach it. Comments are stripped
  // first: the module's docblock discusses `.env` at length, which is the point,
  // and a check that could not tell prose from a file read would be checking
  // nothing useful.
  const source = execFileSync('cat', ['scripts/secret-scan.js'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');

  assert.doesNotMatch(code, /\.env/, 'no .env anywhere in the executable source');
  assert.match(source, /must never read\n \* `\.env`/, 'and the module says so, so the rule survives a rewrite');
});

test('a tracked binary file is skipped rather than scanned as text', () => {
  // reports/ holds PNGs. Decoding one as UTF-8 and regex-scanning it is waste at
  // best and a spurious finding at worst.
  const result = scanTracked({ cwd: REPO_ROOT });
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const pngs = tracked.filter((f) => f.endsWith('.png'));

  assert.ok(pngs.length > 0, 'the repo really does track binaries');
  assert.ok(result.files < tracked.length, 'so fewer files were scanned than are tracked');
  assert.deepEqual(result.findings, []);
});

// ── failing closed: a scan that could not run is not a pass ─────────────────────

test('git failing to run is a FAILURE, never a clean report', () => {
  // The audit finding. `available: false` was computed and nothing read it, so an
  // unavailable scan produced empty findings, printed "clean", and exited 0 —
  // reporting success at exactly the moment the scanner knew least.
  //
  // Same convention as spend-guard's unreadable ledger: unknown is not zero, and
  // unknown means stop.
  const repo = brokenRepo();
  try {
    const result = scanRepository({ cwd: repo.dir });

    assert.equal(result.staged.available, false, 'git really could not run');
    assert.equal(result.tracked.available, false);
    assert.deepEqual(result.findings, [], 'and so it found nothing — which proves nothing');

    assert.equal(result.ok, false, 'ok is what the CLI branches on, and it is false');
    assert.equal(result.blockers.length, 2, 'both scans are named as blocked');

    const report = formatReport(result);
    assert.match(report, /COULD NOT RUN/);
    assert.match(report, /NOT a pass/);
    assert.doesNotMatch(report, /secret-scan: clean/, 'the pass line must not be printed');
  } finally {
    repo.cleanup();
  }
});

test('the CLI exits non-zero when the scan could not run', () => {
  // Through the actual entry point, not the exported function: the exit code is
  // the whole interface, and it is what CLAUDE.md tells the reader to trust.
  const repo = brokenRepo();
  try {
    const scanner = fileURLToPath(new URL('../scripts/secret-scan.js', import.meta.url));
    let code = 0;
    let stdout = '';
    try {
      // `--root`, not cwd: the CLI deliberately scans the repo it lives in, so
      // pointing it elsewhere is the only way to reach the failure path without
      // breaking this repository.
      stdout = execFileSync('node', [scanner, '--root', repo.dir], { encoding: 'utf8' });
    } catch (error) {
      code = error.status;
      stdout = error.stdout ?? '';
    }
    assert.equal(code, 1, 'exit 1, not 0');
    assert.match(stdout, /COULD NOT RUN/);
  } finally {
    repo.cleanup();
  }
});

// ── unreadable files are counted, not silently skipped ─────────────────────────

test('a tracked file that cannot be opened fails the scan', () => {
  // The other audit finding. `catch { continue }` made "could not read" and
  // "scanned, clean" the same outcome — the exact hiding place a secret would
  // need.
  const repo = fixtureRepo();
  try {
    repo.write('readable.js', 'const ok = true;\n');
    repo.write('locked.js', 'const maybe = true;\n');
    repo.stage();
    chmodSync(repo.path('locked.js'), 0o000);

    const result = scanRepository({ cwd: repo.dir });

    assert.equal(result.unreadable.length, 1, 'the unreadable file is counted');
    assert.equal(result.unreadable[0].file, 'locked.js');
    assert.equal(result.ok, false, 'and that alone fails the scan');

    const report = formatReport(result);
    assert.match(report, /locked\.js could not be opened/);
    assert.match(report, /EACCES/, 'and says why, so it is actionable');
    assert.doesNotMatch(report, /secret-scan: clean/);
  } finally {
    try {
      chmodSync(repo.path('locked.js'), 0o644);
    } catch {
      /* already gone */
    }
    repo.cleanup();
  }
});

test('awkwardly named files are SCANNED, not skipped — a key in one is found', () => {
  // The URL-based path construction treated `#` as a fragment and `%` as an
  // escape, so these resolved to the wrong path or to nothing, and the silent
  // catch turned every one of them into "clean". A key hidden in a file called
  // `notes #2.js` would have shipped.
  const repo = fixtureRepo();
  try {
    const key = syntheticKey();
    repo.write('plain.js', 'const ok = true;\n');
    repo.write('notes #2.js', 'const ok = true;\n');
    repo.write('a b c.js', 'const ok = true;\n');
    repo.write('100%.js', `const leaked = '${key}';\n`);
    repo.stage();

    const result = scanRepository({ cwd: repo.dir });

    assert.deepEqual(result.unreadable, [], 'every one of them opened');
    assert.equal(result.tracked.files, 4, 'and all four were scanned as text');

    const found = result.findings.find((f) => f.file === '100%.js');
    assert.ok(found, 'the key in the percent-named file was found');
    assert.doesNotMatch(formatReport(result), new RegExp(key), 'and still redacted');
  } finally {
    repo.cleanup();
  }
});

// ── one line, two patterns, one finding ────────────────────────────────────────

test('a line matching both patterns reports once', () => {
  // `ANTHROPIC_API_KEY=sk-ant-…` is a key AND a key assignment. Two findings for
  // one secret makes the count untrustworthy, which is the last property a
  // scanner should give away.
  const key = syntheticKey();
  const line = `ANTHROPIC_API_KEY=${key}`;

  assert.equal(scanText(line).length, 2, 'both rules fire at the text level');

  const repo = fixtureRepo();
  try {
    repo.write('.env.example', `${line}\n`);
    repo.stage();

    const result = scanRepository({ cwd: repo.dir });
    assert.equal(result.findings.length, 1, 'and are deduplicated to one finding');
    assert.equal(result.findings[0].file, '.env.example');
    assert.equal(result.findings[0].line, 1);
  } finally {
    repo.cleanup();
  }
});

test('binary files are counted as a decision, not as a failure', () => {
  // The repo tracks PNGs and always will. Skipping them is policy; the count is
  // reported so "scanned" never quietly means "some of them".
  const result = scanRepository({ cwd: REPO_ROOT });
  assert.ok(result.tracked.binary > 0, 'binaries were skipped');
  assert.deepEqual(result.unreadable, [], 'but nothing was UNreadable');
  assert.equal(result.ok, true, 'so the scan still passes');
  assert.match(formatReport(result), /binary skipped/, 'and says how many');
});
