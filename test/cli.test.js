import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.js');

/** @param {string[]} args */
function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

test('--version prints the package version', () => {
  const result = run(['--version']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^squeekwatch \d+\.\d+\.\d+$/);
});

test('--help lists the commands', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  for (const command of ['status', 'watch', 'audit', 'badge', 'race', 'fixtures', 'protocol', 'mcp']) {
    assert.ok(result.stdout.includes(command), `help should mention ${command}`);
  }
});

test('status --offline --json emits a machine-readable audit', () => {
  const result = run(['status', '--offline', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.audit.verdict, 'VERIFIED');
  assert.equal(payload.snapshot.source, 'fixtures');
  assert.ok(payload.audit.findings.length >= 15);
});

test('audit --offline renders the human report', () => {
  const result = run(['audit', '--offline']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /INVARIANT AUDIT/);
  assert.match(result.stdout, /VERIFIED/);
  assert.match(result.stdout, /supply-identity/);
});

test('a broken flag is a usage error, not a crash', () => {
  const result = run(['--nope']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /unknown flag/);
});

test('badge --json reports the lane checklist', () => {
  const result = run(['badge', '--json']);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.checks));
  assert.ok(payload.checks.length >= 15);
  const ids = payload.checks.map((check) => check.id);
  assert.ok(ids.includes('repo.zero-dependency'));
  assert.ok(ids.includes('gate.code-lane'));
});

test('race --offline --json prints the submission payload', () => {
  const result = run(['race', '--offline', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'Squeekwatch');
  assert.match(payload.repoUrl, /^https:\/\/github\.com\//);
  assert.ok(payload.integration.length >= 20);
});

test('fixtures --json lists the recorded files', () => {
  const result = run(['fixtures', '--json']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.files.length >= 5);
  assert.ok(payload.totalBytes > 10_000);
});

test('an invalid timeout is rejected before any network request', () => {
  const result = run(['status', '--offline', '--timeout', 'soon']);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /invalid timeout/);
});
