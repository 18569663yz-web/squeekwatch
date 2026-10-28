#!/usr/bin/env node
// @ts-check
/**
 * add-challenge.mjs — write Squeekchain's repository-verification line, safely.
 *
 * Squeekchain proves repository control by asking you to add one exact line to one file
 * on the default branch (`POST /v1/community/code/projects/:id/challenge` returns
 * `{ text, path, expiresAt }`). This script performs that write without letting the API
 * response — or a typo — escape the repository:
 *
 *   node scripts/add-challenge.mjs <challengePath> "<challengeText>" [--force]
 *
 * Guarantees:
 *   - rejects absolute paths, drive-relative paths (`C:foo`), UNC paths and any `..` segment;
 *   - resolves symlinked parents and refuses targets that land outside the current directory;
 *   - creates missing parent directories;
 *   - idempotent: if the exact line is already present, nothing is written;
 *   - refuses to clobber an existing file that does not contain the line unless --force.
 *
 * Zero dependencies. Windows and POSIX. Exit codes: 0 ok, 1 refused, 2 usage.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

const USAGE = `Usage: node scripts/add-challenge.mjs <challengePath> "<challengeText>" [--force]

  <challengePath>  relative path returned by the Squeekchain challenge API
                   (observed shape: .squeekchain/verification.txt)
  <challengeText>  the exact line returned by the API (one line, no newline)
  --force          overwrite an existing file that does not contain the line
  -h, --help       show this help

Exit codes: 0 written or already present, 1 refused, 2 usage.
`;

/** @param {string} message */
function usageError(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

/** @param {string} message */
function refuse(message) {
  process.stderr.write(`refused: ${message}\n`);
  process.exit(1);
}

/** Print an informational line to stdout. @param {string} message */
function info(message) {
  process.stdout.write(`${message}\n`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  process.stdout.write(USAGE);
  process.exit(args.length === 0 ? 2 : 0);
}

const force = args.includes('--force');
const positional = args.filter((a) => a !== '--force');
const unknownFlags = positional.filter((a) => a.startsWith('--'));
if (unknownFlags.length > 0) usageError(`unknown option ${unknownFlags[0]}`);
if (positional.length !== 2) {
  usageError(`expected exactly 2 arguments, got ${positional.length}`);
}

const [rawPath, rawText] = positional;

// ---------------------------------------------------------------- validate the text

const text = rawText.replace(/\r\n?/g, '\n');
if (text.trim() === '') usageError('challenge text is empty');
if (text.includes('\n')) {
  usageError('challenge text must be a single line (it is copied verbatim from the API response)');
}
const line = text.trim();

// ---------------------------------------------------------------- validate the path

if (rawPath.trim() === '') usageError('challenge path is empty');
const challengePath = rawPath.trim();

if (challengePath.includes('\0')) refuse('path contains a NUL byte');
if (isAbsolute(challengePath)) refuse(`path must be relative, got absolute path: ${challengePath}`);
if (/^[A-Za-z]:/.test(challengePath)) {
  refuse(`path must be relative to the repository, got drive-relative path: ${challengePath}`);
}

const segments = challengePath.split(/[\\/]+/);
if (segments.some((segment) => segment === '..')) {
  refuse(`path must not contain ".." segments: ${challengePath}`);
}
if (segments.every((segment) => segment === '' || segment === '.')) {
  refuse(`path does not name a file: ${challengePath}`);
}

const root = process.cwd();
const target = resolve(root, challengePath);

/** Canonical, case-normalised form used for containment tests (Windows is case-insensitive). */
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

/** @param {string} p */
function realpathOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

const realRoot = fold(realpathOrSelf(root));
if (fold(target) !== realRoot && !fold(target).startsWith(realRoot + sep)) {
  refuse(`"${challengePath}" resolves outside ${root}`);
}

// Walk up to the nearest existing ancestor and make sure symlinks cannot smuggle us out.
let ancestor = target;
while (!existsSync(ancestor)) {
  const parent = dirname(ancestor);
  if (parent === ancestor) break;
  ancestor = parent;
}
const realAncestor = fold(realpathOrSelf(ancestor));
if (realAncestor !== realRoot && !realAncestor.startsWith(realRoot + sep)) {
  refuse(`"${challengePath}" resolves through a symlink that leaves ${root}`);
}

const posixPath = challengePath.split(/[\\/]+/).filter(Boolean).join('/');

// ---------------------------------------------------------------- write (idempotent)

const existing = existsSync(target) ? readFileSync(target, 'utf8').replace(/^\uFEFF/u, '') : null;
const existingLines = existing === null ? [] : existing.split(/\r?\n/);
const alreadyPresent = existingLines.some((candidate) => candidate.trim() === line);

if (alreadyPresent) {
  info(`ok: "${line}" is already present in ${posixPath} — nothing to do`);
  printNextSteps(posixPath);
  process.exit(0);
}

if (existing !== null && existing.trim() !== '' && !force) {
  refuse(
    `${posixPath} already exists and does not contain the challenge line.\n` +
      '         Re-run with --force only if you are sure the file can be replaced.',
  );
}

try {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${line}\n`, { encoding: 'utf8', flag: 'w' });
} catch (err) {
  process.stderr.write(`failed: could not write ${posixPath}: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

info(`ok: wrote 1 line to ${posixPath} (${Buffer.byteLength(`${line}\n`, 'utf8')} bytes)`);
info(`    ${line}`);
printNextSteps(posixPath);
process.exit(0);

// ---------------------------------------------------------------- helpers

/**
 * Print the git commands that must run next, plus the raw-URL pre-warm step.
 * Commands are shell-agnostic and use the repository-relative path.
 * @param {string} relPath
 */
function printNextSteps(relPath) {
  info('');
  info('next:');
  info(`  git add -- ${relPath}`);
  info('  git commit -m "Add Squeekchain repository verification challenge"');
  info('  git push origin HEAD');
  info('  git rev-parse HEAD   # commit sha, needed to pre-warm the CDN:');
  info(`  # curl -sSfL https://raw.githubusercontent.com/<owner>/<repo>/<sha>/${relPath}`);
  info('  # confirm the file is on the default branch before calling POST /verify');
}
