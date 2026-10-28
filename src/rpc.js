// @ts-check
/**
 * Minimal Ethereum JSON-RPC client + the chain-side evidence collector.
 *
 * No dependencies, no ABI files: we only call standard ERC-20 view functions, whose
 * selectors are fixed by the standard. Every probe is best-effort; a failing RPC call
 * degrades that probe to `error` and never breaks the audit.
 */

import { CHAIN, SELECTORS, contractsFromEconomy, encodeBalanceOf } from './contracts.js';

export const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

/** Public Sepolia endpoints, tried in order when the first one fails. */
export const RPC_FALLBACKS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.gateway.tenderly.co',
  'https://1rpc.io/sepolia',
];

const DEFAULT_TIMEOUT_MS = 9_000;

export class RpcError extends Error {
  /**
   * @param {string} message
   * @param {{url?: string, code?: number|null, data?: unknown}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'RpcError';
    this.url = info.url ?? null;
    this.code = info.code ?? null;
    this.data = info.data ?? null;
  }
}

export class JsonRpc {
  /**
   * @param {string} [url]
   * @param {{fetch?: typeof fetch, timeoutMs?: number}} [opts]
   */
  constructor(url = DEFAULT_RPC, opts = {}) {
    this.url = url;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nextId = 1;
  }

  /**
   * @param {string} method
   * @param {unknown[]} [params]
   * @returns {Promise<any>}
   */
  async call(method, params = []) {
    if (typeof this.fetchImpl !== 'function') {
      throw new RpcError('no fetch implementation available', { url: this.url });
    }
    const payload = { jsonrpc: '2.0', id: this.nextId++, method, params };
    let res;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new RpcError(`rpc transport failed: ${err instanceof Error ? err.name : 'unknown'}`, { url: this.url });
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      throw new RpcError(`rpc HTTP ${res.status}`, { url: this.url, code: res.status });
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new RpcError('rpc response is not JSON', { url: this.url });
    }
    if (body.error) {
      throw new RpcError(`rpc error: ${body.error.message ?? 'unknown'}`, {
        url: this.url,
        code: typeof body.error.code === 'number' ? body.error.code : null,
        data: body.error.data ?? null,
      });
    }
    return body.result;
  }

  /** @param {string} address */
  getCode(address) {
    return this.call('eth_getCode', [address, 'latest']);
  }

  /** @returns {Promise<number>} */
  async blockNumber() {
    const hex = await this.call('eth_blockNumber', []);
    return Number(hex);
  }

  /** @param {number|'latest'} block */
  getBlock(block) {
    const tag = block === 'latest' ? 'latest' : `0x${Number(block).toString(16)}`;
    return this.call('eth_getBlockByNumber', [tag, false]);
  }

  /** @param {number|'latest'} block */
  async getBlockTimestamp(block) {
    const payload = await this.getBlock(block);
    return Number(payload.timestamp);
  }

  /**
   * @param {{to: string, data: string}} tx
   * @returns {Promise<string>}
   */
  ethCall({ to, data }) {
    return this.call('eth_call', [{ to, data }, 'latest']);
  }

  /** @param {string} hash */
  getTransaction(hash) {
    return this.call('eth_getTransactionByHash', [hash]);
  }

  /** @param {string} hash */
  getTransactionReceipt(hash) {
    return this.call('eth_getTransactionReceipt', [hash]);
  }

  gasPrice() {
    return this.call('eth_gasPrice', []);
  }
}

/**
 * Decode a 32-byte word into a bigint.
 * @param {string} hex
 */
export function decodeUint(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) throw new Error(`not hex: ${String(hex)}`);
  if (hex.length <= 2) return 0n;
  return BigInt(hex);
}

/**
 * Decode an ABI-encoded dynamic `string` return value.
 * @param {string} hex
 */
export function decodeString(hex) {
  if (typeof hex !== 'string' || !hex.startsWith('0x')) throw new Error(`not hex: ${String(hex)}`);
  const data = hex.slice(2);
  if (data.length < 128) return '';
  const offset = Number(BigInt(`0x${data.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${data.slice(offset, offset + 64)}`));
  const body = data.slice(offset + 64, offset + 64 + length * 2);
  const bytes = body.match(/.{2}/g) ?? [];
  return Buffer.from(bytes.join(''), 'hex').toString('utf8');
}

/**
 * Format base units (18 decimals) as a decimal string without floating point loss.
 * @param {bigint} value
 * @param {number} [decimals]
 * @param {number} [fractionDigits]
 */
export function formatBaseUnits(value, decimals = 18, fractionDigits = 6) {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, '0').slice(0, fractionDigits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * @param {typeof fetch} [fetchImpl]
 * @param {string[]} [urls]
 * @returns {Promise<{rpc: JsonRpc, url: string}>}
 */
async function pickRpc(fetchImpl, urls = RPC_FALLBACKS) {
  const errors = [];
  for (const url of urls) {
    const rpc = new JsonRpc(url, { fetch: fetchImpl });
    try {
      await rpc.blockNumber();
      return { rpc, url };
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new RpcError(`no usable Sepolia RPC endpoint (${errors.join(' | ')})`);
}

/**
 * Collect independent on-chain evidence for the audit.
 *
 * @param {{fetch?: typeof fetch, rpcUrl?: string, economy?: any, status?: any}} [opts]
 * @returns {Promise<import('./types.js').ChainFacts|null>}
 */
export async function probeChain(opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const urls = opts.rpcUrl ? [opts.rpcUrl, ...RPC_FALLBACKS] : RPC_FALLBACKS;
  let rpc;
  let url;
  try {
    ({ rpc, url } = await pickRpc(fetchImpl, urls));
  } catch {
    return null;
  }

  const contracts = contractsFromEconomy(opts.economy);
  const warnings = [];
  /** @type {import('./types.js').Probe[]} */
  const probes = [];

  /**
   * @param {import('./types.js').Probe} probe
   * @param {() => Promise<{raw: string, decoded: string|null}>} run
   */
  const collect = async (probe, run) => {
    try {
      const { raw, decoded } = await run();
      probes.push({ ...probe, raw, decoded });
    } catch (err) {
      probes.push({ ...probe, raw: '0x', decoded: null, error: err instanceof Error ? err.message : String(err) });
    }
  };

  const headPromise = (async () => {
    const headNumber = await rpc.blockNumber();
    const block = await rpc.getBlock(headNumber);
    return {
      headNumber,
      headTimestamp: block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString(),
    };
  })();

  /** @type {Promise<string|null>} */
  const gasPromise = rpc.gasPrice().catch(() => null);

  await Promise.all([
    collect({ id: 'sqk-totalSupply', call: 'totalSupply', address: contracts.token }, async () => {
      const raw = await rpc.ethCall({ to: contracts.token, data: SELECTORS.totalSupply });
      return { raw, decoded: decodeUint(raw).toString() };
    }),
    collect({ id: 'sqk-symbol', call: 'symbol', address: contracts.token }, async () => {
      const raw = await rpc.ethCall({ to: contracts.token, data: SELECTORS.symbol });
      return { raw, decoded: decodeString(raw) };
    }),
    collect({ id: 'sqk-decimals', call: 'decimals', address: contracts.token }, async () => {
      const raw = await rpc.ethCall({ to: contracts.token, data: SELECTORS.decimals });
      return { raw, decoded: decodeUint(raw).toString() };
    }),
    contracts.gachaVault
      ? collect(
          { id: 'gacha-sqk-balance', call: 'balanceOf', address: contracts.token, args: [contracts.gachaVault] },
          async () => {
            const raw = await rpc.ethCall({ to: contracts.token, data: encodeBalanceOf(contracts.gachaVault) });
            return { raw, decoded: decodeUint(raw).toString() };
          },
        )
      : Promise.resolve(),
    collect({ id: 'core-code', call: 'getCode', address: contracts.core }, async () => {
      const raw = await rpc.getCode(contracts.core);
      return { raw, decoded: `${Math.max(0, (raw.length - 2) / 2)} bytes` };
    }),
    collect({ id: 'mining-code', call: 'getCode', address: contracts.miningProxy }, async () => {
      const raw = await rpc.getCode(contracts.miningProxy);
      return { raw, decoded: `${Math.max(0, (raw.length - 2) / 2)} bytes` };
    }),
    collect({ id: 'staking-code', call: 'getCode', address: contracts.stakingProxy }, async () => {
      const raw = await rpc.getCode(contracts.stakingProxy);
      return { raw, decoded: `${Math.max(0, (raw.length - 2) / 2)} bytes` };
    }),
  ]);

  const head = await headPromise.catch(() => null);
  const gasPriceWei = await gasPromise;

  /** @type {import('./types.js').ChainFacts['settlement']} */
  let settlement = null;
  const txHash = opts.status?.settlementQueue?.latestSubmission?.transactionHash ?? opts.status?.builder?.anchor?.transactionHash;
  if (typeof txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    try {
      const [tx, receipt] = await Promise.all([rpc.getTransaction(txHash), rpc.getTransactionReceipt(txHash)]);
      const to = typeof tx?.to === 'string' ? tx.to.toLowerCase() : null;
      settlement = {
        hash: txHash,
        found: Boolean(tx),
        to,
        status: receipt?.status ?? null,
        blockNumber: tx?.blockNumber ? Number(tx.blockNumber) : null,
        callsMining: to === contracts.miningProxy.toLowerCase(),
        detail: tx ? `tx to ${to} at block ${tx.blockNumber ? Number(tx.blockNumber) : 'pending'}` : 'transaction not found on chain',
      };
      if (!tx) warnings.push(`settlement transaction ${txHash} was not found on ${CHAIN.name}`);
    } catch (err) {
      warnings.push(`settlement transaction lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!head) {
    warnings.push('head block could not be read');
  }

  return {
    rpcUrl: url,
    headNumber: head?.headNumber ?? 0,
    headTimestamp: head?.headTimestamp ?? new Date().toISOString(),
    gasPriceWei: gasPriceWei ?? null,
    probes,
    settlement,
    warnings,
  };
}
