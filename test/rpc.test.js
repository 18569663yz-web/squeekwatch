import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeString, decodeUint, formatBaseUnits, JsonRpc, probeChain } from '../src/rpc.js';

const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const hex = (text) => `0x${Buffer.from(text, 'utf8').toString('hex')}`;
const encodeString = (text) => {
  const body = hex(text).slice(2);
  const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0');
  return `0x${word(32)}${word(body.length / 2)}${padded}`;
};

test('decodeUint reads bytes32 words', () => {
  assert.equal(decodeUint(`0x${word(0)}`), 0n);
  assert.equal(decodeUint(`0x${word(8066546793063427114304839n)}`), 8066546793063427114304839n);
  assert.equal(decodeUint('0x'), 0n);
  assert.throws(() => decodeUint('123'), /not hex/);
});

test('decodeString reads ABI dynamic strings', () => {
  assert.equal(decodeString(encodeString('SQK')), 'SQK');
  assert.equal(decodeString(encodeString('')), '');
  assert.equal(decodeString('0x'), '');
  assert.equal(decodeString(encodeString('Squeekchain test')), 'Squeekchain test');
});

test('formatBaseUnits keeps 18-decimal precision', () => {
  assert.equal(formatBaseUnits(8066546793063427114304839n), '8066546.793063');
  assert.equal(formatBaseUnits(0n), '0');
  assert.equal(formatBaseUnits(1n), '0');
  assert.equal(formatBaseUnits(10n ** 18n), '1');
  assert.equal(formatBaseUnits(-1500000000000000000n), '-1.5');
});

/** @param {{tx?: any, receipt?: any, blocks?: Record<string, any>}} overrides */
function fakeFetch(overrides = {}) {
  const calls = [];
  /** @type {typeof fetch} */
  const impl = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    const { method, params } = payload;
    calls.push({ method, params });
    const respond = (result) => ({ ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }) });
    switch (method) {
      case 'eth_blockNumber':
        return respond('0x1');
      case 'eth_getBlockByNumber':
        return respond({ number: '0x1', timestamp: '0x67000000' });
      case 'eth_gasPrice':
        return respond('0x11');
      case 'eth_getCode':
        return respond('0x608060405234801561001057600080fd5b50');
      case 'eth_call': {
        const data = params[0].data;
        if (data.startsWith('0x18160ddd')) return respond(`0x${word(8066546793063427114304839n)}`);
        if (data.startsWith('0x95d89b41')) return respond(encodeString('SQK'));
        if (data.startsWith('0x313ce567')) return respond(`0x${word(18)}`);
        if (data.startsWith('0x70a08231')) return respond(`0x${word(7060015158504248523815084n)}`);
        return respond('0x');
      }
      case 'eth_getTransactionByHash':
        return respond(overrides.tx ?? null);
      case 'eth_getTransactionReceipt':
        return respond(overrides.receipt ?? null);
      default:
        return respond(null);
    }
  };
  return { impl, calls };
}

test('probeChain collects RPC evidence', async () => {
  const { impl } = fakeFetch();
  const facts = await probeChain({ fetch: impl, rpcUrl: 'http://fake', economy: null, status: null });
  assert.ok(facts);
  assert.equal(facts.headNumber, 1);
  assert.equal(facts.rpcUrl, 'http://fake');
  const byId = Object.fromEntries(facts.probes.map((probe) => [probe.id, probe]));
  assert.equal(byId['sqk-totalSupply'].decoded, '8066546793063427114304839');
  assert.equal(byId['sqk-symbol'].decoded, 'SQK');
  assert.equal(byId['sqk-decimals'].decoded, '18');
  assert.equal(byId['gacha-sqk-balance'].decoded, '7060015158504248523815084');
  assert.equal(byId['core-code'].decoded, '18 bytes');
  assert.equal(facts.settlement, null);
});

test('probeChain resolves the settlement transaction when the status document has one', async () => {
  const hash = `0x${'ab'.repeat(32)}`;
  const { impl } = fakeFetch({
    tx: { to: '0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44', blockNumber: '0x10' },
    receipt: { status: '0x1' },
  });
  const facts = await probeChain({
    fetch: impl,
    rpcUrl: 'http://fake',
    economy: null,
    status: { settlementQueue: { latestSubmission: { transactionHash: hash } } },
  });
  assert.ok(facts?.settlement);
  assert.equal(facts.settlement.hash, hash);
  assert.equal(facts.settlement.found, true);
  assert.equal(facts.settlement.status, '0x1');
  assert.equal(facts.settlement.callsMining, false);
});

test('probeChain degrades to null when no RPC answers', async () => {
  /** @type {typeof fetch} */
  const broken = async () => {
    throw new Error('offline');
  };
  const facts = await probeChain({ fetch: broken, rpcUrl: 'http://fake' });
  assert.equal(facts, null);
});

test('JsonRpc surfaces protocol errors instead of throwing raw errors', async () => {
  /** @type {typeof fetch} */
  const impl = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'boom' } }) };
  };
  const rpc = new JsonRpc('http://fake', { fetch: impl });
  await assert.rejects(() => rpc.call('eth_call', []), /rpc error: boom/);
});
