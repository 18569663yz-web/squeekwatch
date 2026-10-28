import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { auditLane } from '../src/lane.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the lane report covers identity, proof, artefacts and evidence', () => {
  const report = auditLane({ root: ROOT });
  const ids = report.checks.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length, 'check ids must be unique');
  for (const expected of ['repo.package', 'repo.zero-dependency', 'repo.license', 'repo.readme', 'repo.docs', 'repo.dashboard', 'repo.tests', 'repo.syntax', 'repo.ci', 'repo.git', 'repo.fixtures', 'gate.code-lane']) {
    assert.ok(ids.includes(expected), `missing ${expected}`);
  }
  assert.equal(typeof report.ready, 'boolean');
  assert.equal(typeof report.next, 'string');
  assert.equal(report.checks.length, ids.length);
});

test('the shipped modules all parse', () => {
  const report = auditLane({ root: ROOT });
  const syntax = report.checks.find((check) => check.id === 'repo.syntax');
  assert.equal(syntax.level, 'ok', syntax.detail);
});

test('the lane report explains what is missing in plain language', () => {
  const report = auditLane({ root: ROOT });
  for (const check of report.checks) {
    assert.ok(check.label.length > 5, `${check.id} needs a readable label`);
    assert.ok(check.detail.length > 0, `${check.id} needs detail`);
    assert.ok(['ok', 'warn', 'fail', 'skip'].includes(check.level));
  }
});

test('a bare directory fails the repository checks instead of crashing', () => {
  const report = auditLane({ root: path.join(ROOT, 'test') });
  assert.ok(report.fail >= 1);
  assert.equal(report.ready, false);
});
