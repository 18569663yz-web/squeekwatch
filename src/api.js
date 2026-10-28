// @ts-check
/**
 * Typed, dependency-free client for Squeekchain's public APIs.
 *
 * Two hosts are in use:
 *   - https://api.squeekchain.com      live chain/economy telemetry (read-only)
 *   - https://community.squeekchain.com Genesis profiles, badges, leaderboard
 *
 * Both answer with CORS `*`, no authentication. Nothing here writes anywhere.
 */

export const API_BASE = 'https://api.squeekchain.com';
export const COMMUNITY_BASE = 'https://community.squeekchain.com';

const DEFAULT_TIMEOUT_MS = 10_000;

export class SqueekApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, url?: string, code?: string}} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'SqueekApiError';
    this.status = info.status ?? null;
    this.url = info.url ?? null;
    this.code = info.code ?? null;
  }
}

/** @typedef {{fetch?: typeof fetch, timeoutMs?: number, noCache?: boolean}} RequestOpts */

/** @type {Map<string, {at: number, body: string}>} */
const cache = new Map();
const CACHE_TTL_MS = 4_000;

/**
 * GET a JSON document, with a timeout, a tiny in-process cache and a typed error.
 * @param {string} url
 * @param {RequestOpts} [opts]
 * @returns {Promise<any>}
 */
export async function getJson(url, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new SqueekApiError('no fetch implementation available (Node >= 20 required)', { url });
  }
  const now = Date.now();
  const hit = cache.get(url);
  if (!opts.noCache && hit && now - hit.at < CACHE_TTL_MS) {
    return JSON.parse(hit.body);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (err) {
    throw new SqueekApiError(`request failed: ${describe(err)}`, { url });
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const code = extractErrorCode(text);
    throw new SqueekApiError(`HTTP ${res.status} from ${url}${code ? ` (${code})` : ''}`, {
      status: res.status,
      url,
      code,
    });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SqueekApiError(`response is not JSON (${text.slice(0, 80)}...)`, { status: res.status, url });
  }
  cache.set(url, { at: now, body: JSON.stringify(body) });
  return body;
}

/** @param {string} text */
function extractErrorCode(text) {
  try {
    const parsed = JSON.parse(text);
    const code = parsed?.error?.code ?? parsed?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** @param {unknown} err */
function describe(err) {
  if (err instanceof Error) {
    return err.name === 'TimeoutError' ? 'timeout' : `${err.name}: ${err.message}`;
  }
  return String(err);
}

/** @param {RequestOpts} [opts] */
export function getStatus(opts) {
  return getJson(`${API_BASE}/v1/status`, opts);
}

/** @param {RequestOpts} [opts] */
export function getEconomy(opts) {
  return getJson(`${API_BASE}/v1/economy/state`, opts);
}

/**
 * @param {number|string} tokenId 1..9999
 * @param {RequestOpts} [opts]
 */
export function getSqueek(tokenId, opts) {
  const id = String(tokenId);
  if (!/^[1-9][0-9]*$/.test(id) || BigInt(id) > 9999n) {
    throw new SqueekApiError(`invalid Squeeks token id: ${id}`, { code: 'invalid_token_id' });
  }
  return getJson(`${API_BASE}/v1/squeeks/${id}`, opts);
}

/**
 * @param {string} address 0x-prefixed 20-byte hex
 * @param {RequestOpts} [opts]
 */
export function getAccount(address, opts) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new SqueekApiError(`invalid address: ${address}`, { code: 'invalid_address' });
  }
  return getJson(`${API_BASE}/v1/accounts/${address.toLowerCase()}`, opts);
}

/**
 * @param {string} code Genesis profile code (e.g. "8mae44td")
 * @param {RequestOpts} [opts]
 */
export function getAuraProfile(code, opts) {
  const clean = String(code).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,40}$/.test(clean)) {
    throw new SqueekApiError(`invalid profile code: ${code}`, { code: 'invalid_profile_code' });
  }
  return getJson(`${COMMUNITY_BASE}/v1/community/profiles/${clean}`, opts);
}

/** @param {RequestOpts} [opts] */
export function getLeaderboard(opts) {
  return getJson(`${COMMUNITY_BASE}/v1/community/leaderboard`, opts);
}

/** @param {RequestOpts} [opts] */
export function getStats(opts) {
  return getJson(`${COMMUNITY_BASE}/v1/community/stats`, opts);
}

/** @param {RequestOpts} [opts] */
export function getBadgeCatalog(opts) {
  return getJson(`${COMMUNITY_BASE}/v1/community/aura/badges`, opts);
}

/**
 * Fetch everything the observatory needs, degrading politely:
 * status/economy are required, everything else is optional.
 *
 * @param {{chain?: boolean, community?: boolean, offline?: boolean, timeoutMs?: number, fetch?: typeof fetch, rpcUrl?: string, fixturesDir?: string, skipCache?: boolean}} [opts]
 * @returns {Promise<import('./types.js').Snapshot>}
 */
export async function fetchSnapshot(opts = {}) {
  const { chain = true, community = true, offline = false, timeoutMs, fetch: fetchImpl } = opts;
  const requestOpts = { timeoutMs, fetch: fetchImpl, noCache: opts.skipCache };

  if (offline) {
    const { readFixtures } = await import('./fixtures.js');
    const fixtures = await readFixtures(opts.fixturesDir);
    /** @type {any} */
    const snapshot = {
      fetchedAt: new Date().toISOString(),
      generatedAt: fixtures.status?.generatedAt ?? fixtures.meta?.fetchedAt ?? null,
      source: 'fixtures',
      sources: { api: API_BASE, community: COMMUNITY_BASE },
      meta: fixtures.meta ?? null,
      status: fixtures.status,
      economy: fixtures.economy,
      community: community ? fixtures.community ?? null : null,
      chain: null,
      fixturesTimestamp: fixtures.meta?.fetchedAt ?? null,
    };
    return snapshot;
  }

  const [status, economy] = await Promise.all([getStatus(requestOpts), getEconomy(requestOpts)]);

  let communityData = null;
  if (community) {
    const results = await Promise.allSettled([getStats(requestOpts), getLeaderboard(requestOpts), getBadgeCatalog(requestOpts)]);
    const [stats, leaderboard, badges] = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
    if (stats || leaderboard || badges) {
      communityData = { stats, leaderboard, badges };
    }
  }

  let chainData = null;
  if (chain) {
    try {
      const { probeChain } = await import('./rpc.js');
      chainData = await probeChain({ fetch: fetchImpl, rpcUrl: opts.rpcUrl, economy, status });
    } catch {
      chainData = null;
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    generatedAt: status?.generatedAt ?? null,
    source: 'live',
    sources: { api: API_BASE, community: COMMUNITY_BASE },
    meta: null,
    status,
    economy,
    community: communityData,
    chain: chainData,
  };
}

