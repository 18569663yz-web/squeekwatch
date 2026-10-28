#!/usr/bin/env node
// @ts-check
/**
 * set-identity.mjs — point the repository at a real GitHub account.
 *
 * The project ships with the placeholder owner `REPLACE_ME` so that nothing is
 * published with a wrong handle. Run this once, before the first `git push`:
 *
 *   node scripts/set-identity.mjs <github-user> [--name "Display Name"] [--demo <url>]
 *   node scripts/set-identity.mjs --check          # do not write, just report
 *
 * It rewrites, in place:
 *   package.json            homepage / repository / bugs / author
 *   fixtures/meta.json      repoUrl / demoUrl   (used by `squeekwatch race`)
 *
 * Zero dependencies. Exit codes: 0 ok, 1 placeholders remain, 2 usage.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const USAGE = `Usage: node scripts/set-identity.mjs <github-user> [flags]

  <github-user>       GitHub account that will host the repository
  --name <name>       commit/author display name (default: <github-user>)
  --demo <url>        demo URL (default: https://<github-user>.github.io/squeekwatch/)
  --check             report remaining placeholders, write nothing
  -h, --help          show this help

Rewrites package.json and fixtures/meta.json. Exit codes: 0 ok,
1 placeholders remain, 2 usage.
`;

/** @param {string} message */
function usage(message) {
  process.stderr.write(`error: ${message}\n\n${USAGE}`);
  process.exit(2);
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {{user: string|null, name: string|null, demo: string|null, check: boolean, help: boolean}} */
  const out = { user: null, name: null, demo: null, check: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') out.help = true;
    else if (arg === '--check') out.check = true;
    else if (arg === '--name' || arg === '--demo') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) usage(`${arg} needs a value`);
      if (arg === '--name') out.name = value;
      else out.demo = value;
      i += 1;
    } else if (arg.startsWith('-')) usage(`unknown flag: ${arg}`);
    else if (out.user === null) out.user = arg;
    else usage(`unexpected argument: ${arg}`);
  }
  return out;
}

/** @param {string} file */
function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** @param {string} file @param {unknown} value */
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** @param {string} file */
function gitSourceFiles(file) {
  return readFileSync(path.join(ROOT, file), 'utf8');
}

/**
 * Where the placeholder still appears, as `file:line` strings.
 * @returns {string[]}
 */
export function findPlaceholders() {
  const files = ['package.json', 'fixtures/meta.json', 'src/render.js', 'src/server.js', 'src/identity.js'];
  /** @type {string[]} */
  const hits = [];
  for (const file of files) {
    let text;
    try {
      text = gitSourceFiles(file);
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      if (line.includes('REPLACE_ME')) hits.push(`${file}:${index + 1}`);
    });
  }
  return hits;
}

function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (args.check) {
    const hits = findPlaceholders();
    if (hits.length === 0) {
      process.stdout.write('identity: no placeholders left\n');
      return 0;
    }
    process.stdout.write(`identity: REPLACE_ME still in ${hits.length} place(s)\n`);
    for (const hit of hits) process.stdout.write(`  ${hit}\n`);
    process.stdout.write('run: node scripts/set-identity.mjs <github-user>\n');
    return 1;
  }
  if (!args.user) usage('missing <github-user>');
  const user = /** @type {string} */ (args.user);
  if (!USER_PATTERN.test(user)) usage(`invalid GitHub user: ${user}`);

  const displayName = args.name ?? user;
  const repo = `https://github.com/${user}/squeekwatch`;
  const demo = args.demo ?? `https://${user}.github.io/squeekwatch/`;

  const pkgFile = path.join(ROOT, 'package.json');
  const pkg = readJson(pkgFile);
  pkg.homepage = `${repo}#readme`;
  pkg.repository = { type: 'git', url: `git+${repo}.git` };
  pkg.bugs = { url: `${repo}/issues` };
  pkg.author = displayName;
  writeJson(pkgFile, pkg);

  const metaFile = path.join(ROOT, 'fixtures', 'meta.json');
  const meta = readJson(metaFile);
  meta.repoUrl = repo;
  meta.demoUrl = demo;
  writeJson(metaFile, meta);

  const remaining = findPlaceholders();
  process.stdout.write(`identity: ${user}\n  repo ${repo}\n  demo ${demo}\n  author ${displayName}\n`);
  if (remaining.length > 0) {
    process.stdout.write(`still placeholder-bound (guards, not data): ${remaining.join(', ')}\n`);
  }
  process.stdout.write(`\nnext:\n  git remote add origin git@github.com:${user}/squeekwatch.git\n  git push -u origin main\n  node scripts/launch-checklist.mjs\n`);
  return 0;
}

process.exitCode = main();
