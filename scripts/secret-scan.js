/**
 * Pre-commit secret scanning (CLAUDE.md § Operating rules).
 *
 * The gap this closes: nothing mechanical stopped a real API key from being
 * committed. Catching one depended on somebody remembering to look, and the day
 * it mattered — a key pasted into a terminal that ended up in a screenshot — the
 * remembering happened after the fact rather than before it.
 *
 * WHAT IT LOOKS AT. Staged content (`git diff --cached`) and tracked files.
 * Nothing else, and that boundary is the point: **the scanner must never read
 * `.env`.** A scanner that opens the secret file to check for secrets has become
 * one more process holding the key. `.env` is gitignored, so it is neither
 * tracked nor stageable, and scanning only those two sets is what guarantees the
 * scanner cannot reach it. There is a test asserting exactly that.
 *
 * WHAT IT PRINTS. File, line, and an excerpt with the match REDACTED. Never the
 * matched string, not even a prefix — a scanner that prints the secret it found
 * has defeated itself, and printing "the first 11 characters" is how a key ends
 * up in a transcript while everyone believes it was redacted.
 *
 * The git calls here are read-only plumbing — `ls-files`, `diff --cached`, both
 * of which only report. That is the same class as spend-guard's HEAD read, not
 * the ratifying act the operating rule governs.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * The key-material charset and the length that separates a real key from a
 * placeholder.
 *
 * An Anthropic key is `sk-ant-` + a variant tag + `-` + ~95 characters drawn
 * from `[A-Za-z0-9_-]`. The documentation placeholders in README.md and
 * live-check's help text are `sk-ant-...` — literal dots, which are NOT in that
 * charset, so they cannot match at any length. That is why the pattern
 * discriminates by charset first and length second, rather than trying to
 * enumerate the placeholder spellings: a new placeholder someone writes next
 * year passes for the same structural reason this one does.
 *
 * MIN_KEY_CHARS = 40 is a floor well above every placeholder and well below a
 * real key. A truncated fragment shorter than this is not a usable credential —
 * the 18-character prefix that leaked into a transcript, for instance, is not
 * something anyone can authenticate with — so the floor buys precision without
 * giving up anything that matters.
 */
export const MIN_KEY_CHARS = 40;

/**
 * The patterns. Each is a named rule so a finding can say which one fired.
 *
 * `sk-ant-` is followed by an optional variant tag (`api03`, `admin01`, …) and a
 * hyphen; the tag is optional so a future variant is still caught.
 */
export const PATTERNS = [
  {
    name: 'anthropic-api-key',
    what: 'an Anthropic API key',
    // eslint-disable-next-line prefer-regex-literals -- built from the constant above
    regex: new RegExp(`sk-ant-(?:[A-Za-z0-9]{1,12}-)?[A-Za-z0-9_-]{${MIN_KEY_CHARS},}`, 'g'),
  },
  {
    name: 'anthropic-key-assignment',
    what: 'ANTHROPIC_API_KEY assigned real-looking material',
    // Catches a key that does not carry the `sk-ant-` prefix — a rotated format,
    // or a value pasted without it. Requires the same length floor, so
    // `ANTHROPIC_API_KEY=sk-ant-...` and `ANTHROPIC_API_KEY=$KEY` both pass.
    regex: new RegExp(`ANTHROPIC_API_KEY\\s*[=:]\\s*["']?([A-Za-z0-9_-]{${MIN_KEY_CHARS},})`, 'g'),
  },
];

/**
 * Replace a match with a description of its shape.
 *
 * Zero characters of the match survive. The length is reported because it is
 * useful for telling a real key from a long random identifier, and it is not
 * itself secret.
 */
export function redact(match) {
  return `‹REDACTED ${match.length}-char secret›`;
}

/**
 * Scan one piece of text.
 *
 * @param {string} text
 * @param {{file?: string, startLine?: number}} [where]
 * @returns {{file: string, line: number, rule: string, what: string, excerpt: string}[]}
 */
export function scanText(text, { file = '(text)', startLine = 1 } = {}) {
  const findings = [];

  text.split('\n').forEach((line, index) => {
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        // The assignment rule captures the material in group 1; the key rule
        // matches it whole. Redact whichever one actually is the secret.
        const secret = match[1] ?? match[0];
        findings.push({
          file,
          line: startLine + index,
          rule: pattern.name,
          what: pattern.what,
          excerpt: excerptOf(line, secret),
        });
      }
    }
  });

  return findings;
}

/**
 * The line with the secret taken out, trimmed to something printable.
 *
 * Built by splitting on the secret rather than by slicing around it, so there is
 * no index arithmetic that could go one character wide and leak a byte.
 */
function excerptOf(line, secret, budget = 90) {
  const redacted = line.split(secret).join(redact(secret)).trim();
  return redacted.length <= budget ? redacted : `${redacted.slice(0, budget)}…`;
}

/**
 * Read-only git. Returns null when git is unavailable or the call fails.
 *
 * `stderr: 'pipe'` so a failure does not print git's own message on the way to
 * this scanner printing a better one. The null is not a shrug — every caller
 * turns it into `available: false`, and an unavailable scan is a FAILURE, not an
 * empty result. See `scanRepository`.
 */
function git(args, { cwd = REPO_ROOT } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * Scan what is staged for commit.
 *
 * Only ADDED lines are examined: a secret already in history is a different and
 * worse problem than one about to be introduced, and this scanner's job is to
 * stop the introduction. `-U0` keeps the hunks to changed lines so the line
 * numbers reported are the ones in the new file.
 */
export function scanStaged({ cwd = REPO_ROOT } = {}) {
  const diff = git(['diff', '--cached', '--no-color', '-U0'], { cwd });
  if (diff === null) return { findings: [], available: false, files: 0 };

  const findings = [];
  const seen = new Set();
  let file = '(staged)';
  let lineNumber = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(4).replace(/^b\//, '');
      seen.add(file);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      lineNumber = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      findings.push(...scanText(line.slice(1), { file, startLine: lineNumber }));
      lineNumber += 1;
    }
  }

  return { findings, available: true, files: seen.size };
}

/**
 * Scan every tracked file.
 *
 * Tracked, not "every file on disk": untracked scratch is not going anywhere,
 * and `.env` is neither tracked nor stageable, which is what keeps this scanner
 * away from the secret it is protecting.
 */
export function scanTracked({ cwd = REPO_ROOT } = {}) {
  const listing = git(['ls-files', '-z'], { cwd });
  if (listing === null) return { findings: [], available: false, files: 0, binary: 0, unreadable: [] };

  const files = listing.split('\0').filter(Boolean);
  const findings = [];
  const unreadable = [];
  let scanned = 0;
  let binary = 0;

  for (const file of files) {
    let buffer;
    try {
      // `path.join`, not a URL. A URL treats `#` as a fragment and `%` as an
      // escape, so a tracked file with either in its name resolved to the wrong
      // path — or to a path that does not exist — and the old `catch { continue }`
      // then made that indistinguishable from "scanned, clean".
      buffer = readFileSync(join(cwd, file));
    } catch (error) {
      // COUNTED, never skipped silently. A file the scanner could not open is a
      // file it cannot vouch for, and reporting it as clean is the same class of
      // lie as reporting an unavailable scan as a pass.
      unreadable.push({ file, reason: error?.code ?? 'unreadable' });
      continue;
    }

    // A NUL in the first block means binary; a PNG has no lines to report. This
    // is a DECISION, not a failure, so it is counted separately — the repo
    // tracks images and always will.
    if (buffer.subarray(0, 8000).includes(0)) {
      binary += 1;
      continue;
    }

    scanned += 1;
    findings.push(...scanText(buffer.toString('utf8'), { file }));
  }

  return { findings, available: true, files: scanned, binary, unreadable };
}

/**
 * Both scans, deduplicated, with whether they could actually run.
 *
 * DEDUP IS ON file:line, not file:line:rule. One line can match both patterns —
 * `ANTHROPIC_API_KEY=sk-ant-…` is a key AND a key assignment — and reporting one
 * secret as two findings makes the count untrustworthy, which is the last
 * property a scanner should give away. A file that is both staged and tracked
 * would double-report for the same reason. The STAGED origin wins: it names
 * something not yet committed that can still be stopped.
 *
 * `ok` is the only thing a caller should branch on. It is false when a scan
 * FOUND something and equally when a scan COULD NOT RUN — see `blockers`.
 */
export function scanRepository({ cwd = REPO_ROOT } = {}) {
  const staged = scanStaged({ cwd });
  const tracked = scanTracked({ cwd });

  const byKey = new Map();
  for (const finding of staged.findings) {
    byKey.set(`${finding.file}:${finding.line}`, { ...finding, origin: 'staged' });
  }
  for (const finding of tracked.findings) {
    const key = `${finding.file}:${finding.line}`;
    if (!byKey.has(key)) byKey.set(key, { ...finding, origin: 'tracked' });
  }

  const findings = [...byKey.values()];
  const unreadable = tracked.unreadable ?? [];

  // WHY THESE ARE FAILURES AND NOT WARNINGS. A scan that could not run and a
  // scan that found nothing are indistinguishable in their output, so treating
  // the first as a pass means the scanner reports "clean" at exactly the moment
  // it knows least. Same shape as spend-guard's unreadable ledger: unknown is
  // not zero, and unknown means stop.
  const blockers = [];
  if (!staged.available) blockers.push('the staged diff could not be read (is this a git repository?)');
  if (!tracked.available) blockers.push('the tracked file list could not be read (is this a git repository?)');
  for (const { file, reason } of unreadable) {
    blockers.push(`${file} could not be opened (${reason}), so it was not scanned`);
  }

  return {
    findings,
    staged,
    tracked,
    unreadable,
    blockers,
    available: staged.available && tracked.available,
    ok: findings.length === 0 && blockers.length === 0,
  };
}

/** The report. Never contains key material — see `redact`. */
export function formatReport(result) {
  const { findings, staged, tracked, blockers = [] } = result;

  if (findings.length === 0 && blockers.length === 0) {
    const skipped = tracked.binary ? `, ${tracked.binary} binary skipped` : '';
    return (
      `secret-scan: clean — ${staged.files} staged file${staged.files === 1 ? '' : 's'}, ` +
      `${tracked.files} tracked file${tracked.files === 1 ? '' : 's'} scanned${skipped}, ` +
      'no key material found.'
    );
  }

  // The could-not-run case reads differently from the found-something case,
  // deliberately. "Do not commit" is right for both, but the reader's next move
  // is not: one is a credential to rotate, the other is a scanner to repair.
  if (findings.length === 0) {
    return [
      '',
      '─'.repeat(76),
      'SECRET SCAN COULD NOT RUN — this is NOT a pass. Do not commit.',
      '',
      ...blockers.map((blocker) => `  ${blocker}`),
      '',
      '  A scan that did not run and a scan that found nothing produce the same',
      '  empty result. Treating the first as clean would report success at exactly',
      '  the moment the scanner knows least, so it fails instead.',
      '─'.repeat(76),
      '',
    ].join('\n');
  }

  const lines = [
    '',
    '─'.repeat(76),
    `SECRET SCAN FAILED — ${findings.length} finding${findings.length === 1 ? '' : 's'}. Do not commit.`,
    '',
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.file}:${finding.line}  (${finding.rule}, ${finding.origin ?? 'scanned'})`);
    lines.push(`    ${finding.what}`);
    lines.push(`    ${finding.excerpt}`);
    lines.push('');
  }
  for (const blocker of blockers) lines.push(`  ALSO: ${blocker}`);
  if (blockers.length > 0) lines.push('');
  lines.push(
    '  The matched text is redacted above and is not printed anywhere by this',
    '  scanner. If this is a real credential: rotate it first, then remove it —',
    '  a key that reached a working tree should be treated as already exposed.',
    '',
    '  If this is a placeholder the pattern misjudged, that is a scanner bug and',
    '  the pattern is the thing to fix, not the finding to suppress.',
    '─'.repeat(76),
    '',
  );
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
//
// `node scripts/secret-scan.js` — exit 0 clean, non-zero on a finding OR on a
// scan that could not run. The EXIT CODE is the contract: CLAUDE.md tells the
// reader to proceed only on 0, so it is the thing that has to be right.
//
// `--root <dir>` scans somewhere else. It exists so the exit code is testable
// against a fixture where git genuinely cannot run — without it, the only way to
// exercise the failure path would be to break this repository. The default is
// the repo this script lives in, NOT the process's working directory, so running
// it from a subdirectory still scans the whole project.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const rootFlag = process.argv.indexOf('--root');
  const root = rootFlag === -1 ? REPO_ROOT : process.argv[rootFlag + 1];

  if (rootFlag !== -1 && !root) {
    console.error('secret-scan: --root needs a directory');
    process.exit(2);
  }

  const result = scanRepository({ cwd: root.endsWith('/') ? root : `${root}/` });
  console.log(formatReport(result));
  // `ok`, not `findings.length`: an unavailable scan must not exit 0.
  process.exit(result.ok ? 0 : 1);
}
