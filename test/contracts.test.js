import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAIN,
  DEFAULT_ADDRESSES,
  SELECTORS,
  contractsFromEconomy,
  encodeApprove,
  encodeApproveZero,
  encodeBalanceOf,
  isAddress,
  padAddress,
  padUint,
} from '../src/contracts.js';

test('chain facts describe Sepolia', () => {
  assert.equal(CHAIN.chainId, 11155111);
  assert.equal(CHAIN.name, 'Sepolia');
});

test('selectors are the canonical 4-byte signatures', () => {
  assert.equal(SELECTORS.totalSupply, '0x18160ddd');
  assert.equal(SELECTORS.balanceOf, '0x70a08231');
  assert.equal(SELECTORS.symbol, '0x95d89b41');
  assert.equal(SELECTORS.decimals, '0x313ce567');
  assert.equal(SELECTORS.approve, '0x095ea7b3');
});

test('published addresses are 20-byte hex', () => {
  for (const [name, address] of Object.entries(DEFAULT_ADDRESSES)) {
    assert.match(address, /^0x[0-9a-f]{40}$/, `${name} looks malformed`);
  }
});

test('padAddress and padUint produce 32-byte words', () => {
  assert.equal(padAddress(DEFAULT_ADDRESSES.token).length, 64);
  assert.equal(padAddress(DEFAULT_ADDRESSES.token).slice(0, 24), '0'.repeat(24));
  assert.equal(padUint(0).length, 64);
  assert.equal(padUint(18), `${'0'.repeat(62)}12`);
  assert.throws(() => padUint(-1), /negative/i);
});

test('isAddress validates shape', () => {
  assert.equal(isAddress(DEFAULT_ADDRESSES.core), true);
  assert.equal(isAddress(DEFAULT_ADDRESSES.core.toUpperCase().replace('0X', '0x')), true);
  assert.equal(isAddress('0x123'), false);
  assert.equal(isAddress(null), false);
  assert.equal(isAddress(`${'0'.repeat(40)}`), false);
});

test('encodeApproveZero revokes an allowance', () => {
  const data = encodeApproveZero(DEFAULT_ADDRESSES.stakingProxy);
  assert.ok(data.startsWith('0x095ea7b3'));
  assert.equal(data.length, 10 + 64 * 2);
  assert.equal(data.slice(10 + 24, 10 + 64), DEFAULT_ADDRESSES.stakingProxy.slice(2).toLowerCase());
  assert.equal(data.slice(10 + 64), '0'.repeat(64));
});

test('encodeApprove and encodeBalanceOf carry their arguments', () => {
  const approve = encodeApprove(DEFAULT_ADDRESSES.stakingProxy, 1000);
  assert.ok(approve.startsWith('0x095ea7b3'));
  assert.ok(approve.endsWith((1000).toString(16).padStart(64, '0')));
  const balance = encodeBalanceOf(DEFAULT_ADDRESSES.gachaVault);
  assert.ok(balance.startsWith('0x70a08231'));
  assert.ok(balance.toLowerCase().includes(DEFAULT_ADDRESSES.gachaVault.slice(2).toLowerCase()));
});

test('contractsFromEconomy prefers the API view and falls back to published addresses', () => {
  const fromApi = contractsFromEconomy({
    identities: {
      core: '0x1111111111111111111111111111111111111111',
      token: '0x2222222222222222222222222222222222222222',
      mining: { proxy: '0x3333333333333333333333333333333333333333' },
      staking: { proxy: '0x4444444444444444444444444444444444444444' },
    },
  });
  assert.equal(fromApi.core, '0x1111111111111111111111111111111111111111');
  assert.equal(fromApi.token, '0x2222222222222222222222222222222222222222');
  assert.equal(fromApi.miningProxy, '0x3333333333333333333333333333333333333333');
  assert.equal(fromApi.stakingProxy, '0x4444444444444444444444444444444444444444');

  const fallback = contractsFromEconomy(null);
  assert.equal(fallback.token, DEFAULT_ADDRESSES.token);
  assert.equal(fallback.miningProxy, DEFAULT_ADDRESSES.miningProxy);
});
