// @ts-check
/**
 * Shared JSDoc typedefs. No runtime code; imported only for editor/`tsc --checkJs` support.
 */

/**
 * @typedef {Object} Probe
 * @property {string} id
 * @property {'totalSupply'|'name'|'symbol'|'decimals'|'balanceOf'|'getCode'|'transaction'} call
 * @property {string} address
 * @property {string[]} [args]
 * @property {string} raw
 * @property {string|null} decoded
 * @property {string} [error]
 */

/**
 * @typedef {Object} ChainFacts
 * @property {string} rpcUrl
 * @property {number} headNumber
 * @property {string} headTimestamp ISO timestamp of the head block
 * @property {string|null} gasPriceWei
 * @property {Probe[]} probes
 * @property {{hash: string, found: boolean, to: string|null, status: string|null, blockNumber: number|null, callsMining: boolean, detail: string}|null} [settlement]
 * @property {string[]} [warnings]
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} fetchedAt
 * @property {'live'|'fixtures'} source
 * @property {any} status raw GET /v1/status
 * @property {any} economy raw GET /v1/economy/state
 * @property {{stats: any, leaderboard: any, badges: any}|null} community
 * @property {ChainFacts|null} chain
 * @property {string|null} [fixturesTimestamp]
 */

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {'ok'|'warn'|'fail'} severity
 * @property {'api'|'rpc'|'community'|'mixed'} source
 * @property {string} title
 * @property {string} detail
 * @property {string} [expected]
 * @property {string} [observed]
 */

/**
 * @typedef {Object} AuditResult
 * @property {string} generatedAt
 * @property {'VERIFIED'|'DEGRADED'|'FAILED'} verdict
 * @property {number} pass
 * @property {number} warn
 * @property {number} fail
 * @property {number} skipped
 * @property {number} total
 * @property {number} score 0-100
 * @property {Finding[]} findings
 * @property {ChainFacts|null} chain
 */

export {};
