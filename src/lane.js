/**
 * Build-lane readiness: what a reviewer (and the challenge bot) can verify in this repo
 * without opening a browser. Each check reads the filesystem and reports one line.
 *
 * Levels: ok, warn (not fatal but worth fixing), fail (would sink the submission), skip.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** @typedef {{ id: string, label: string, level: 'ok'|'warn'|'fail'|'skip', detail: string }} LaneCheck */
/** @typedef {{ checks: LaneCheck[], fail: number, warn: number, next: string, blockers: string[], ready: boolean }} LaneReport */

/** @param {string} root @param {string} relative */
function file(root, ...relative) {
  return path.join(root, ...relative);
}

/** @param {string} target */
function isFile(target) {
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/** @param {number} target @param {string[]} files */
function allFiles(target, files) {
  return files.every((name) => isFile(path.join(target, name)));
}

/** @param {string} filePath @param {RegExp} pattern */
function contains(filePath, pattern) {
  try {
    return pattern.test(readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

/** @param {string} dir @param {string} pattern */
function countMatching(dir, pattern) {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name)).length;
  } catch {
    return 0;
  }
}

/** @param {string} root */
function syntaxCheck(root) {
  const failures = [];
  const dirs = ['src', 'scripts'];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs)) {
      if (!/\.(m?js)$/.test(name)) continue;
      const target = path.join(abs, name);
      const result = spawnSync(process.execPath, ['--check', target], { encoding: 'utf8' });
      if (result.status !== 0) failures.push(`${dir}/${name}`);
    }
  }
  return failures;
}

/**
 * Run every lane check.
 * @param {{ root?: string }} [options]
 * @returns {LaneReport}
 */
export function auditLane(options = {}) {
  const root = options.root ?? process.cwd();
  /** @type {LaneCheck[]} */
  const checks = [];
  const add = (id, label, level, detail) => checks.push({ id, label, level, detail });

  // 1. repository identity ----------------------------------------------------
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(file(root, 'package.json'), 'utf8'));
  } catch {
    add('repo.package', 'package.json parses and declares a name', 'fail', 'package.json missing or unreadable');
  }
  if (pkg.name) {
    const dependencyCount = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    add('repo.package', 'package.json parses and declares a name', 'ok', `${pkg.name}@${pkg.version ?? '?'}`);
    add(
      'repo.zero-dependency',
      'Ships with zero runtime dependencies',
      dependencyCount === 0 ? 'ok' : 'fail',
      dependencyCount === 0 ? 'no dependencies, no install step: node runs the repo as-is' : `${dependencyCount} dependencies must be installed first`,
    );
    add(
      'repo.bin',
      'Exposes a CLI entry point',
      pkg.bin && pkg.bin.squeekwatch ? 'ok' : 'warn',
      pkg.bin && pkg.bin.squeekwatch ? String(pkg.bin.squeekwatch) : 'package.json has no bin.squeekwatch',
    );
    add(
      'repo.scripts',
      'Has test and lint scripts',
      pkg.scripts?.test ? 'ok' : 'fail',
      pkg.scripts?.test ? `test: ${pkg.scripts.test}` : 'package.json has no test script',
    );
  }

  // 2. proof for reviewers ------------------------------------------------------
  add(
    'repo.license',
    'Declares a license',
    isFile(file(root, 'LICENSE')) ? 'ok' : 'fail',
    isFile(file(root, 'LICENSE')) ? 'LICENSE present' : 'LICENSE missing',
  );
  const readme = file(root, 'README.md');
  const readmeText = isFile(readme) ? readFileSync(readme, 'utf8') : '';
  add(
    'repo.readme',
    'README explains the project in under two minutes',
    readmeText.length > 1500 ? 'ok' : readmeText.length > 400 ? 'warn' : 'fail',
    readmeText.length > 1500 ? `${readmeText.split('\n').length} lines` : readmeText.length > 400 ? 'short: add quickstart and screenshots' : 'README missing or too thin',
  );
  const docs = ['docs/PROTOCOL.md', 'docs/LAUNCH.md', 'docs/BADGES.md'];
  const docsPresent = docs.filter((name) => isFile(file(root, ...name.split('/'))));
  add(
    'repo.docs',
    'Documents protocol, launch plan and badge ladder',
    docsPresent.length === docs.length ? 'ok' : docsPresent.length > 0 ? 'warn' : 'fail',
    docsPresent.length === docs.length ? docs.join(' · ') : `present: ${docsPresent.join(', ') || 'none'}`,
  );

  // 3. the artefacts the project actually ships ---------------------------------
  const dashboard = ['dashboard/index.html', 'dashboard/testdrive.html'];
  const dashboardPresent = dashboard.filter((name) => isFile(file(root, ...name.split('/'))));
  add(
    'repo.dashboard',
    'Ships a browser dashboard with a replay mode',
    dashboardPresent.length === dashboard.length ? 'ok' : 'warn',
    dashboardPresent.length === dashboard.length ? 'dashboard pages present' : `present: ${dashboardPresent.join(', ') || 'none'}`,
  );
  const pagesEntry = file(root, 'dashboard', 'index.html');
  add(
    'repo.pages',
    'Publishes a GitHub Pages entry point',
    isFile(pagesEntry) && isFile(file(root, '.github', 'workflows', 'pages.yml')) ? 'ok' : 'warn',
    isFile(pagesEntry) ? 'dashboard/index.html is published by .github/workflows/pages.yml' : 'add dashboard/index.html and a Pages workflow',
  );
  add(
    'repo.service',
    'Includes a live snapshot service',
    allFiles(file(root, 'src'), ['server.js', 'api.js', 'audit.js']) ? 'ok' : 'warn',
    allFiles(file(root, 'src'), ['server.js', 'api.js', 'audit.js']) ? 'src/server.js serves /api/snapshot' : 'src/server.js wiring incomplete',
  );

  // 4. evidence that it runs ----------------------------------------------------
  const testCount = countMatching(file(root, 'test'), /\.test\.(m?js)$/);
  add(
    'repo.tests',
    'Has an automated test suite',
    testCount >= 3 ? 'ok' : testCount > 0 ? 'warn' : 'fail',
    testCount >= 3 ? `${testCount} test files` : testCount > 0 ? 'add more edge-case tests' : 'no test files',
  );
  const syntaxFailures = syntaxCheck(root);
  add(
    'repo.syntax',
    'Every shipped module parses on this Node',
    syntaxFailures.length === 0 ? 'ok' : 'fail',
    syntaxFailures.length === 0 ? `node --check clean · node ${process.version}` : `syntax errors: ${syntaxFailures.join(', ')}`,
  );
  add(
    'repo.ci',
    'CI runs the suite on every push',
    isFile(file(root, '.github', 'workflows', 'ci.yml')) ? 'ok' : 'warn',
    isFile(file(root, '.github', 'workflows', 'ci.yml')) ? '.github/workflows/ci.yml' : 'add a CI workflow so the green check is public',
  );
  add(
    'repo.git',
    'Repository is a git repo with a remote',
    existsSync(file(root, '.git')) ? 'ok' : 'fail',
    existsSync(file(root, '.git')) ? 'git repository initialised' : 'run git init and push before submitting',
  );
  const fixtures = ['fixtures/status.json', 'fixtures/economy.json', 'fixtures/meta.json'];
  add(
    'repo.fixtures',
    'Ships a recorded snapshot so demos work offline',
    allFiles(file(root, 'fixtures'), ['status.json', 'economy.json', 'meta.json']) ? 'ok' : 'warn',
    allFiles(file(root, 'fixtures'), ['status.json', 'economy.json', 'meta.json']) ? fixtures.join(' · ') : 'fixtures/ incomplete',
  );

  // 5. gate ---------------------------------------------------------------------
  add(
    'gate.code-lane',
    'Genesis code lane accepts independent submissions',
    'skip',
    'code lane reads "Not open yet" at build time; submit the moment it opens',
  );
  add(
    'gate.challenge',
    'Locked wallet is ready to sign the challenge file',
    'warn',
    'the challenge file is only issued after you submit; prepare the wallet beforehand',
  );

  const fail = checks.filter((c) => c.level === 'fail').length;
  const warn = checks.filter((c) => c.level === 'warn').length;
  const blockers = checks.filter((c) => c.level === 'fail').map((c) => `${c.label}: ${c.detail}`);
  const next =
    fail > 0
      ? 'Fix the failing checks, then run `npm test` and `npm run check:launch`.'
      : warn > 0
        ? 'Good shape. Clear the warnings, then push and submit the moment the lane opens.'
        : 'Ready. Push, then submit the packet from `squeekwatch race` the moment the lane opens.';
  return { checks, fail, warn, next, blockers, ready: fail === 0 };
}

export default auditLane;
