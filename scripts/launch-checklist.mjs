#!/usr/bin/env node
// @ts-check
/**
 * launch-checklist.mjs — is this repository ready to submit to Squeekchain's code track?
 *
 *   node scripts/launch-checklist.mjs
 *
 * Runs read-only local checks (git state, required files, packaging, accidental secrets)
 * and prints one PASS / WARN / FAIL line per check. WARN never fails the run; any FAIL
 * makes the process exit with code 1, so it can gate CI or a launch script.
 *
 * Nothing here touches the network and nothing is written. Zero dependencies.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_HINT = 'run this from the repository checkout';
const MAX_SCAN_BYTES = 1024 * 1024;
/**
 * The placeholder token, assembled at runtime so this file never trips its own scan and so a
 * repo-wide find/replace cannot desynchronise the check from what it looks for.
 */
const PLACEHOLDER = ['REPLACE', 'ME'].join('_');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache', '.next', 'out']);
const TEXT_EXTENSIONS = new Set([
  '',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.sh',
  '.ps1',
  '.html',
  '.css',
  '.env',
  '.example',
  '.gitignore',
  '.npmrc',
]);

/** @typedef {'PASS'|'WARN'|'FAIL'} Level */
/** @typedef {{level: Level, label: string, detail: string}} Check */

/** @type {Check[]} */
const checks = [];

/**
 * @param {Level} level
 * @param {string} label
 * @param {string} detail
 */
function record(level, label, detail) {
  checks.push({ level, label, detail });
}

/** @typedef {{ok: boolean, out: string, err: string, missing: boolean}} GitResult */

/** @type {string|null} */
let gitCwd = process.cwd();
/** @type {boolean|null} */
let gitAvailable = null;

/**
 * Run git without touching the network. Never throws.
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {GitResult}
 */
function git(args, cwd = gitCwd ?? process.cwd()) {
  try {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      windowsHide: true,
    });
    if (result.error) {
      const code = /** @type {{code?: string}} */ (result.error).code ?? '';
      if (code === 'ENOENT') return { ok: false, out: '', err: 'git executable not found', missing: true };
      return { ok: false, out: result.stdout ?? '', err: String(result.error), missing: false };
    }
    return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim(), missing: false };
  } catch (err) {
    return { ok: false, out: '', err: err instanceof Error ? err.message : String(err), missing: false };
  }
}

/** @param {string} text @param {number} [max] */
function oneLine(text, max = 160) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// ------------------------------------------------------------------ locate the repository

const top = git(['rev-parse', '--show-toplevel']);
if (top.missing) {
  gitAvailable = false;
} else if (top.ok && top.out !== '') {
  gitAvailable = true;
  gitCwd = top.out;
} else {
  gitAvailable = true;
  gitCwd = resolve(process.cwd());
}

const root = gitCwd ?? process.cwd();
const rel = (p) => relative(root, p).split(sep).join('/') || '.';

// ------------------------------------------------------------------ package.json (needed by several checks)

/** @type {{name?: string, version?: string, scripts?: Record<string, string>, type?: string} | null} */
let pkg = null;
let pkgError = '';
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
} catch (err) {
  pkgError = err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------------ git checks

if (!gitAvailable) {
  record('WARN', 'git repository', 'git executable not available — repository checks skipped');
  record('WARN', 'remote origin', 'cannot check without git');
  record('WARN', 'working tree clean', 'cannot check without git');
  record('WARN', 'branch is main', 'cannot check without git');
} else {
  const gitDir = git(['rev-parse', '--git-dir']);
  if (gitDir.ok) {
    record('PASS', 'git repository', root);
  } else {
    record('FAIL', 'git repository', `not a git checkout (${oneLine(gitDir.err) || ROOT_HINT})`);
  }

  const remote = git(['remote', 'get-url', 'origin']);
  if (remote.ok && remote.out !== '') {
    const url = remote.out;
    const placeholder = new RegExp(`${PLACEHOLDER}|<owner>|example\\.com`, 'i').test(url);
    if (placeholder) {
      record('WARN', 'remote origin', `${url} — looks like a placeholder, point it at the real GitHub repo`);
    } else if (/github\.com[:/]/i.test(url)) {
      record('PASS', 'remote origin', url);
    } else {
      record('WARN', 'remote origin', `${url} — independent-track submissions require a public GitHub repository`);
    }
  } else {
    record('FAIL', 'remote origin', 'no origin remote: git remote add origin <github-url>');
  }

  const status = git(['status', '--porcelain']);
  if (!status.ok) {
    record('WARN', 'working tree clean', `could not read git status (${oneLine(status.err)})`);
  } else if (status.out === '') {
    record('PASS', 'working tree clean', 'no uncommitted changes');
  } else {
    const files = status.out.split('\n').filter(Boolean);
    record(
      'WARN',
      'working tree clean',
      `${files.length} uncommitted change(s): ${files
        .slice(0, 5)
        .map((file) => oneLine(file, 60))
        .join(', ')}${files.length > 5 ? ', …' : ''}`,
    );
  }

  // `symbolic-ref` works on an unborn branch (fresh clone / fresh init), where `rev-parse` fails.
  const symbolic = git(['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = symbolic.ok && symbolic.out ? symbolic : git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = branch.ok ? branch.out : '';
  if (name === 'main') {
    record('PASS', 'branch is main', 'main');
  } else if (!name || name === 'HEAD') {
    record(
      'FAIL',
      'branch is main',
      'detached HEAD — check out the default branch and make sure it is named main (git switch -c main, or git branch -M main)',
    );
  } else {
    record(
      'FAIL',
      'branch is main',
      `current branch is "${name}" (expected main); rename or switch: git branch -M main`,
    );
  }
}

// ------------------------------------------------------------------ required files

const readmePath = join(root, 'README.md');
if (!existsSync(readmePath)) {
  record('FAIL', 'README.md', 'missing');
} else {
  const chars = readFileSync(readmePath, 'utf8').length;
  if (chars > 2000) {
    record('PASS', 'README.md', `${chars} characters`);
  } else {
    record('FAIL', 'README.md', `${chars} characters (needs > 2000 to explain the project to a reviewer)`);
  }
}

const licensePath = join(root, 'LICENSE');
if (!existsSync(licensePath)) {
  record('FAIL', 'LICENSE', 'missing (MIT is referenced by package.json)');
} else {
  const head = readFileSync(licensePath, 'utf8').slice(0, 400);
  if (/MIT License/i.test(head) || /^\s*MIT\b/i.test(head)) {
    record('PASS', 'LICENSE', 'MIT');
  } else {
    record('WARN', 'LICENSE', 'present, but the first lines do not look like the MIT licence text');
  }
}

if (pkg === null) {
  record('FAIL', 'package.json', `cannot parse: ${oneLine(pkgError)}`);
} else {
  const problems = [];
  if (typeof pkg.name !== 'string' || pkg.name.trim() === '') problems.push('name');
  if (typeof pkg.version !== 'string' || pkg.version.trim() === '') problems.push('version');
  if (problems.length > 0) {
    record('FAIL', 'package.json name/version', `missing: ${problems.join(', ')}`);
  } else if (`${pkg.name} ${pkg.version}`.includes(PLACEHOLDER)) {
    record('WARN', 'package.json name/version', `${pkg.name}@${pkg.version} — contains ${PLACEHOLDER}`);
  } else {
    record('PASS', 'package.json name/version', `${pkg.name}@${pkg.version}`);
  }
  if (pkg.type !== 'module') {
    record('WARN', 'package.json type', path_type_note(pkg.type));
  }
}

/** @param {string|undefined} value */
function path_type_note(value) {
  return `type is ${value === undefined ? 'missing' : `"${value}"`} — the sources are ESM (.mjs / "type": "module")`;
}

const testDir = join(root, 'test');
/** @type {string[]} */
let testFiles = [];
if (existsSync(testDir) && statSync(testDir).isDirectory()) {
  testFiles = readdirSync(testDir).filter((name) => /\.test\.(?:m?js|cjs)$/.test(name));
}
if (testFiles.length > 0) {
  record('PASS', 'test/ suite', `${testFiles.length} test file(s), e.g. ${testFiles[0]}`);
} else if (existsSync(testDir)) {
  record('FAIL', 'test/ suite', 'test/ exists but contains no *.test.js file');
} else {
  record('FAIL', 'test/ suite', 'test/ directory missing');
}

const dashboard = join(root, 'dashboard', 'index.html');
if (!existsSync(dashboard)) {
  record('FAIL', 'dashboard/index.html', 'missing');
} else {
  const bytes = statSync(dashboard).size;
  if (bytes < 500) {
    record('WARN', 'dashboard/index.html', `${bytes} bytes — suspiciously small for a self-contained page`);
  } else {
    record('PASS', 'dashboard/index.html', `${bytes} bytes`);
  }
}

const workflowsDir = join(root, '.github', 'workflows');
/** @type {string[]} */
let workflows = [];
if (existsSync(workflowsDir) && statSync(workflowsDir).isDirectory()) {
  workflows = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name));
}
if (workflows.length > 0) {
  record('PASS', '.github/workflows', workflows.join(', '));
} else {
  record('FAIL', '.github/workflows', 'no workflow YAML found (CI must be green before submission)');
}

// ------------------------------------------------------------------ accidental commits

/**
 * Tracked-file list; falls back to a filesystem walk when git is unavailable.
 * @returns {{files: string[], tracked: boolean}}
 */
function listCandidateFiles() {
  if (gitAvailable) {
    const result = git(['ls-files', '-z']);
    if (result.ok) {
      const files = result.out.split('\0').filter(Boolean);
      if (files.length > 0 || git(['rev-parse', '--verify', 'HEAD']).ok) return { files, tracked: true };
    }
  }
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir @param {number} depth */
  const walk = (dir, depth) => {
    if (depth > 8 || files.length > 5000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile()) {
        files.push(relative(root, join(dir, entry.name)).split(sep).join('/'));
      }
    }
  };
  walk(root, 0);
  return { files, tracked: false };
}

const { files: candidateFiles, tracked } = listCandidateFiles();
const trackedLabel = tracked ? 'tracked' : 'on disk';

// node_modules committed?
const trackedNodeModules = candidateFiles.filter((file) => /(^|\/)node_modules\//.test(file));
if (trackedNodeModules.length > 0) {
  record('FAIL', 'no node_modules in git', `${trackedNodeModules.length} ${trackedLabel} file(s), e.g. ${trackedNodeModules[0]}`);
} else if (existsSync(join(root, 'node_modules'))) {
  const ignored = gitAvailable ? git(['check-ignore', '-q', 'node_modules']).ok : true;
  record(ignored ? 'PASS' : 'WARN', 'no node_modules in git', ignored ? 'node_modules/ present locally and git-ignored' : 'node_modules/ present and not git-ignored');
} else {
  record('PASS', 'no node_modules in git', 'no node_modules directory');
}

// .env files committed?
const envFiles = candidateFiles.filter((file) => /(^|\/)\.env(?:\.|$)/.test(file) && !/\.env\.(?:example|sample|template)$/i.test(file));
if (envFiles.length > 0) {
  record('FAIL', '.env not committed', `${trackedLabel}: ${envFiles.slice(0, 5).join(', ')}`);
} else {
  const envOnDisk = ['.env', '.env.local'].filter((name) => existsSync(join(root, name)));
  const ignored = envOnDisk.every((name) => (gitAvailable ? git(['check-ignore', '-q', name]).ok : true));
  if (envOnDisk.length > 0 && !ignored) {
    record('WARN', '.env not committed', `${envOnDisk.join(', ')} present locally and not git-ignored`);
  } else {
    record('PASS', '.env not committed', envOnDisk.length > 0 ? 'present locally, git-ignored' : 'no .env files');
  }
}

// private keys / certificates on disk or in git?
const pemFiles = candidateFiles.filter((file) => /\.(?:pem|key|p12|pfx)$/i.test(file));
if (pemFiles.length > 0) {
  record('FAIL', 'no key material', `${trackedLabel}: ${pemFiles.slice(0, 5).join(', ')}`);
} else {
  record('PASS', 'no key material', 'no *.pem / *.key files');
}

/**
 * Scan candidate text files for secret-shaped content. Label-driven so ordinary 32-byte
 * hashes (storage layout digests, transaction hashes) do not trip the check.
 * @returns {{file: string, line: number, kind: string}[]}
 */
function scanSecrets() {
  /** @type {{file: string, line: number, kind: string}[]} */
  const hits = [];
  /** @type {RegExp[]} */
  const patterns = [
    [/BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/, 'PEM private key block'],
    [/(?:private[_-]?key|priv[_-]?key|mnemonic|seed[_-]?phrase|secret[_-]?key)\s*[:=]\s*['"]?(?:0x)?[0-9a-fA-F]{32,}/i, 'labelled private key / mnemonic'],
    [/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/, 'Stripe-style API key'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
    [/\b\d{12}:[A-Za-z0-9_-]{30,}/, 'Telegram bot token'],
  ];
  for (const file of candidateFiles) {
    const full = join(root, file);
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && ext !== '.lock') continue;
    if (file.endsWith('package-lock.json')) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (raw.includes('\0')) continue;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i];
      if (text.length > 4000) continue;
      for (const [pattern, kind] of patterns) {
        if (pattern.test(text)) {
          hits.push({ file, line: i + 1, kind });
          break;
        }
      }
    }
  }
  return hits;
}

const secretHits = scanSecrets();
if (secretHits.length === 0) {
  record('PASS', 'no secret-shaped strings', `${candidateFiles.length} ${trackedLabel} file(s) scanned`);
} else {
  const sample = secretHits
    .slice(0, 5)
    .map((hit) => `${hit.file}:${hit.line} (${hit.kind})`)
    .join(', ');
  record('FAIL', 'no secret-shaped strings', `${secretHits.length} hit(s): ${sample}${secretHits.length > 5 ? ', …' : ''}`);
}

// Placeholder tokens: not fatal, but must be gone before publishing.
/** @type {string[]} */
const placeholders = [];
for (const file of candidateFiles) {
  const full = join(root, file);
  const ext = extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && ext !== '.lock') continue;
  let stat;
  try {
    stat = statSync(full);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
  let raw;
  try {
    raw = readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  if (raw.includes('\0') || !raw.includes(PLACEHOLDER)) continue;
  const line = raw.split(/\r?\n/).findIndex((text) => text.includes(PLACEHOLDER));
  placeholders.push(`${file}${line >= 0 ? `:${line + 1}` : ''}`);
}
if (placeholders.length === 0) {
  record('PASS', `${PLACEHOLDER} placeholders`, 'none');
} else {
  record(
    'WARN',
    `${PLACEHOLDER} placeholders`,
    `${placeholders.length} file(s) still contain ${PLACEHOLDER} — replace before publishing: ${placeholders.slice(0, 5).join(', ')}${placeholders.length > 5 ? ', …' : ''}`,
  );
}

// Node version, because everything targets Node >= 20.
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (nodeMajor >= 20) {
  record('PASS', 'node >= 20', process.versions.node);
} else {
  record('WARN', 'node >= 20', `${process.versions.node} — the project targets Node >= 20`);
}

// ------------------------------------------------------------------ report

const counts = { PASS: 0, WARN: 0, FAIL: 0 };
for (const check of checks) counts[check.level] += 1;

const ordered = [...checks].sort((a, b) => {
  const rank = { FAIL: 0, WARN: 1, PASS: 2 };
  return rank[a.level] - rank[b.level];
});

process.stdout.write(`squeekwatch launch checklist\nroot: ${root}\n\n`);
for (const check of ordered) {
  process.stdout.write(`${check.level.padEnd(4)}  ${check.label.padEnd(28)} ${check.detail}\n`);
}
process.stdout.write(
  `\n${checks.length} checks: ${counts.PASS} pass, ${counts.WARN} warn, ${counts.FAIL} fail` +
    `${counts.FAIL > 0 ? ' — not ready to submit' : counts.WARN > 0 ? ' — ready after the warnings are reviewed' : ' — ready to submit'}\n`,
);

process.exit(counts.FAIL > 0 ? 1 : 0);
