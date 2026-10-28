import assert from 'node:assert/strict';
import { test } from 'node:test';

import { API_BASE, COMMUNITY_BASE, fetchSnapshot, getJson, getSqueek, SqueekApiError } from '../src/api.js';

/** @param {Record<string, unknown>} routes */
function fakeFetch(routes) {
  let calls = 0;
  /** @type {typeof fetch} */
  const impl = async (url) => {
    calls += 1;
    const key = new URL(String(url)).pathname;
    const body = routes[key];
    const respond = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Not Found',
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    });
    if (body === undefined) return respond({ error: 'not_found' }, 404);
    return respond(body);
  };
  return { impl, calls: () => calls };
}

test('getJson unwraps JSON payloads', async () => {
  const { impl } = fakeFetch({ '/v1/status': { hello: 'hamster' } });
  const payload = await getJson(`${API_BASE}/v1/status`, { fetch: impl, noCache: true });
  assert.deepEqual(payload, { hello: 'hamster' });
});

test('getJson raises a typed error with the HTTP status', async () => {
  const { impl } = fakeFetch({});
  await assert.rejects(
    () => getJson(`${API_BASE}/v1/missing`, { fetch: impl, noCache: true }),
    (error) => error instanceof SqueekApiError && error.status === 404,
  );
});

test('getJson memoises for a few seconds unless told not to', async () => {
  const url = `${API_BASE}/v1/cache-probe`;
  const { impl, calls } = fakeFetch({ '/v1/cache-probe': { n: 1 } });
  const first = await getJson(url, { fetch: impl });
  const second = await getJson(url, { fetch: impl });
  assert.deepEqual(first, second);
  assert.equal(calls(), 1, 'second read should come from cache');
  await getJson(url, { fetch: impl, noCache: true });
  assert.equal(calls(), 2, 'noCache must bypass the cache');
});

test('getSqueek validates the token id before touching the network', async () => {
  const { impl, calls } = fakeFetch({});
  await assert.rejects(async () => getSqueek(0, { fetch: impl }), /token id/i);
  await assert.rejects(async () => getSqueek(10000, { fetch: impl }), /token id/i);
  await assert.rejects(async () => getSqueek('1e3', { fetch: impl }), /token id/i);
  assert.equal(calls(), 0);
  const { impl: good } = fakeFetch({ '/v1/squeeks/42': { tokenId: '42' } });
  assert.deepEqual(await getSqueek(42, { fetch: good, noCache: true }), { tokenId: '42' });
});

test('offline snapshots load from fixtures and never call the network', async () => {
  /** @type {typeof fetch} */
  const exploding = async () => {
    throw new Error('network must not be touched');
  };
  const snapshot = await fetchSnapshot({ offline: true, fetch: exploding });
  assert.equal(snapshot.source, 'fixtures');
  assert.equal(snapshot.chain, null);
  assert.equal(snapshot.status.installationId, 'stream-game-sepolia-test-20261025-01');
  assert.equal(snapshot.economy.supply.totalMintedBaseUnits, '8066546793063427114304839');
  assert.ok(snapshot.generatedAt);
  assert.equal(snapshot.sources.api, API_BASE);
  assert.equal(snapshot.sources.community, COMMUNITY_BASE);
  assert.ok(snapshot.meta?.integration.length > 100);
});

test('live snapshots merge status, economy and the optional community layer', async () => {
  const { impl } = fakeFetch({
    '/v1/status': { installationId: 'inst-1', generatedAt: new Date().toISOString(), builder: {}, measurement: {} },
    '/v1/economy/state': { installationId: 'inst-1', supply: {} },
    '/v1/community/stats': { members: 1 },
    '/v1/community/leaderboard': { entries: [] },
    '/v1/community/aura/badges': { groups: [] },
  });
  const snapshot = await fetchSnapshot({ chain: false, fetch: impl, skipCache: true });
  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.status.installationId, 'inst-1');
  assert.equal(snapshot.community.stats.members, 1);
  assert.equal(snapshot.chain, null);
});

test('a missing community layer is tolerated', async () => {
  const { impl } = fakeFetch({ '/v1/status': { installationId: 'i', generatedAt: new Date().toISOString() }, '/v1/economy/state': { supply: {} } });
  const snapshot = await fetchSnapshot({ chain: false, fetch: impl, skipCache: true });
  assert.equal(snapshot.community, null);
  assert.ok(snapshot.status);
});
