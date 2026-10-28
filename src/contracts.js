// @ts-check
/**
 * Squeekchain's on-chain footprint, as observed from GET /v1/economy/state.
 *
 * The protocol deploys on Ethereum Sepolia (chainId 11155111). Addresses below are the
 * values captured on 2026-10-28 and are also re-read from the API at runtime, so the repo
 * keeps working if the project is redeployed.
 */

export const CHAIN = Object.freeze({
  name: 'Sepolia',
  chainId: 11155111,
  explorer: 'https://sepolia.etherscan.io',
});

/** Canonical 4-byte function selectors we need. All of them are standard. */
export const SELECTORS = Object.freeze({
  totalSupply: '0x18160ddd', // uint256 totalSupply()
  name: '0x06fdde03', // string name()
  symbol: '0x95d89b41', // string symbol()
  decimals: '0x313ce567', // uint8 decimals()
  balanceOf: '0x70a08231', // uint256 balanceOf(address)
  approve: '0x095ea7b3', // bool approve(address,uint256)
  transfer: '0xa9059cbb', // bool transfer(address,uint256)
  owner: '0x8da5cb5b', // address owner()
  paused: '0x5c975abb', // bool paused()
});

/** Fallback addresses (used when the economy payload is unavailable, e.g. offline demos). */
export const DEFAULT_ADDRESSES = Object.freeze({
  core: '0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44',
  tokenFactory: '0x779a302adbaa9c8a3da45ef48ad67e6a45fcef29',
  token: '0x5501e1fa81be1c3f49225fa7668da0245d07db60',
  genesis: '0xcb98349c134ab983da5bfd80527dfe2552bdb70f',
  miningProxy: '0xcd46990f8349057335289ef282c276204b6cdc62',
  miningImplementation: '0x62d25dc1a24033a80edcc4b2d2ffe9348290cc4c',
  stakingProxy: '0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f',
  stakingImplementation: '0xbbb816616d8840bd98094bf5a20f208df089230b',
  launch: '0x1ff6485abfbb2d183cd673d78e1ab31c098e04dd',
  gachaVault: '0x5f6ba50f448b84e09f5ee324a6402b033ba70e28',
  guardian: '0x3c4c2ba9a5dfbfc5e48dceabdd3b004131a04be6',
});

export const SQK_DECIMALS = 18;

/**
 * @typedef {Object} ContractSet
 * @property {string} core
 * @property {string} tokenFactory
 * @property {string} token
 * @property {string} genesis
 * @property {string} miningProxy
 * @property {string|null} miningImplementation
 * @property {string} stakingProxy
 * @property {string|null} stakingImplementation
 * @property {string} launch
 * @property {string|null} gachaVault
 * @property {string|null} guardian
 */

/**
 * Build the contract set from a live economy payload, falling back to captured defaults.
 * @param {any} [economy]
 * @returns {ContractSet}
 */
export function contractsFromEconomy(economy) {
  const identities = economy?.identities ?? {};
  const pick = (live, fallback) => (typeof live === 'string' ? live.toLowerCase() : fallback);
  return {
    core: pick(identities.core, DEFAULT_ADDRESSES.core),
    tokenFactory: pick(identities.tokenFactory, DEFAULT_ADDRESSES.tokenFactory),
    token: pick(identities.token, DEFAULT_ADDRESSES.token),
    genesis: pick(identities.genesis, DEFAULT_ADDRESSES.genesis),
    miningProxy: pick(identities.mining?.proxy, DEFAULT_ADDRESSES.miningProxy),
    miningImplementation: identities.mining?.implementation
      ? String(identities.mining.implementation).toLowerCase()
      : DEFAULT_ADDRESSES.miningImplementation,
    stakingProxy: pick(identities.staking?.proxy, DEFAULT_ADDRESSES.stakingProxy),
    stakingImplementation: identities.staking?.implementation
      ? String(identities.staking.implementation).toLowerCase()
      : DEFAULT_ADDRESSES.stakingImplementation,
    launch: pick(identities.launch, DEFAULT_ADDRESSES.launch),
    gachaVault: economy?.mining?.gachaVault ? String(economy.mining.gachaVault).toLowerCase() : DEFAULT_ADDRESSES.gachaVault,
    guardian: economy?.lifecycle?.guardian ? String(economy.lifecycle.guardian).toLowerCase() : DEFAULT_ADDRESSES.guardian,
  };
}

/** @param {string} address */
export function isAddress(address) {
  return typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Left-pad an address to a 32-byte ABI word.
 * @param {string} address
 */
export function padAddress(address) {
  if (!isAddress(address)) throw new Error(`not an address: ${address}`);
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/**
 * ABI-encode a uint256 argument.
 * @param {bigint|number|string} value
 */
export function padUint(value) {
  const big = BigInt(value);
  if (big < 0n) throw new Error('uint256 cannot be negative');
  const hex = big.toString(16);
  if (hex.length > 64) throw new Error('uint256 overflow');
  return hex.padStart(64, '0');
}

/**
 * Build `approve(spender, 0)` calldata for the SQK token.
 * Zeroing an allowance is the cheapest possible real state change: it moves no value,
 * mints nothing and only rewrites one storage slot.
 * @param {string} spender
 */
export function encodeApproveZero(spender) {
  return `${SELECTORS.approve}${padAddress(spender)}${padUint(0)}`;
}

/**
 * Build `approve(spender, amount)` calldata.
 * @param {string} spender
 * @param {bigint|number|string} amount
 */
export function encodeApprove(spender, amount) {
  return `${SELECTORS.approve}${padAddress(spender)}${padUint(amount)}`;
}

/**
 * Build `balanceOf(holder)` calldata.
 * @param {string} holder
 */
export function encodeBalanceOf(holder) {
  return `${SELECTORS.balanceOf}${padAddress(holder)}`;
}
