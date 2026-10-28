import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchSnapshot } from '../src/api.js';
import { auditSnapshot, INVARIANTS } from '../src/audit.js';

/** @returns {Promise<any>} */
async function baseline() {
  return fetchSnapshot({ offline: true, chain: false });
}

const EXPECTED_API_CHECKS = [
  'allowance-identity',
  'emission-schedule',
  'installation-consistency',
  'lifecycle-guard',
  'mining-round-order',
  'nft-config',
  'nft-identity',
  'nft-power-monotonic',
  'settlement-linking',
  'staking-conservation',
  'supply-burn',
  'supply-capacity',
  'supply-identity',
  'supply-within-cap',
  'telemetry-coherence',
  'telemetry-freshness',
  'telemetry-provenance',
];

test('the recorded snapshot passes every offline invariant', async () => {
  const snapshot = await baseline();
  const audit = auditSnapshot(snapshot);
  assert.equal(audit.verdict, 'VERIFIED');
  assert.equal(audit.score, 100);
  assert.equal(audit.fail, 0);
  assert.equal(audit.warn, 0);
  assert.equal(audit.pass, EXPECTED_API_CHECKS.length);
  assert.equal(audit.findings.length, EXPECTED_API_CHECKS.length);
  assert.equal(audit.skipped, INVARIANTS.length - EXPECTED_API_CHECKS.length);
});

test('every API check is present and named', async () => {
  const audit = auditSnapshot(await baseline());
  const ids = audit.findings.map((finding) => finding.id).sort();
  for (const expected of EXPECTED_API_CHECKS) assert.ok(ids.includes(expected), `missing ${expected}`);
});

test('offline mode records the chain checks as skipped, not failed', async () => {
  const audit = auditSnapshot(await baseline());
  assert.equal(audit.skipped, INVARIANTS.length - EXPECTED_API_CHECKS.length);
  assert.equal(audit.findings.filter((finding) => finding.source === 'rpc').length, 0);
});

test('a broken supply identity fails loudly and drops the score', async () => {
  const snapshot = structuredClone(await baseline());
  snapshot.economy.supply.totalMintedBaseUnits = '9000000000000000000000000';
  const audit = auditSnapshot(snapshot);
  assert.equal(audit.verdict, 'FAILED');
  assert.ok(audit.fail >= 2);
  assert.ok(audit.score < 100);
  const failing = audit.findings.filter((finding) => finding.severity === 'fail').map((finding) => finding.id);
  assert.ok(failing.includes('supply-identity'));
  assert.ok(failing.includes('supply-burn'));
});

test('an NFT power ladder that goes down is caught', async () => {
  const snapshot = structuredClone(await baseline());
  snapshot.economy.nft.basePower[9] = '1000';
  const audit = auditSnapshot(snapshot);
  const finding = audit.findings.find((entry) => entry.id === 'nft-power-monotonic');
  assert.equal(finding?.severity, 'fail');
});

test('a mismatched installation id is caught', async () => {
  const snapshot = structuredClone(await baseline());
  snapshot.economy.installationId = 'stream-game-sepolia-test-other';
  const audit = auditSnapshot(snapshot);
  const finding = audit.findings.find((entry) => entry.id === 'installation-consistency');
  assert.equal(finding?.severity, 'fail');
});

test('stale telemetry degrades instead of pretending', async () => {
  const snapshot = structuredClone(await baseline());
  const observed = Date.parse('2026-01-01T00:00:00.000Z');
  snapshot.status.measurement.observedAt = new Date(observed).toISOString();
  // Capture time is "now", observation time is ancient: the wheel was not reporting.
  snapshot.fixturesTimestamp = new Date().toISOString();
  const audit = auditSnapshot(snapshot);
  const finding = audit.findings.find((entry) => entry.id === 'telemetry-freshness');
  assert.equal(finding?.severity, 'fail');
});

test('missing evidence drops checks instead of inventing verdicts', async () => {
  const snapshot = structuredClone(await baseline());
  delete snapshot.status.measurement;
  const audit = auditSnapshot(snapshot);
  const telemetry = audit.findings.filter((finding) => finding.id.startsWith('telemetry-'));
  assert.deepEqual(telemetry, [], 'no telemetry findings without telemetry evidence');
  assert.equal(audit.pass, EXPECTED_API_CHECKS.length - 3);
  assert.equal(audit.verdict, 'VERIFIED'); // nothing contradicted the remaining invariants
});

test('an empty snapshot never crashes the engine', () => {
  const audit = auditSnapshot({});
  assert.equal(audit.verdict, 'VERIFIED');
  assert.equal(audit.pass, 0);
  assert.equal(audit.skipped, INVARIANTS.length);
});

test('the invariant list is unique and documented', () => {
  const ids = INVARIANTS.map((invariant) => invariant.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const invariant of INVARIANTS) {
    assert.ok(invariant.title.length > 10, `${invariant.id} needs a title`);
    assert.ok(['api', 'rpc', 'community', 'mixed'].includes(invariant.source));
  }
});
