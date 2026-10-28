# Module interface contract (v0.1)

This file is the *only* thing that binds modules together. Do not invent exports that
are not listed here; do not rename files.

Repo root: `D:\squeek\squeekwatch`. Runtime: **Node >= 20, ESM JavaScript, zero dependencies.**
No TypeScript build step, no bundler, no npm install required (`node src/cli.js …` must work on a
fresh clone with an empty `node_modules`). Use `// @ts-check` + JSDoc where useful.

## Data shapes

```js
/** @typedef {Object} Snapshot
 *  @property {string}  fetchedAt        ISO timestamp of the fetch
 *  @property {object}  status           raw GET /v1/status body            (api.squeekchain.com)
 *  @property {object}  economy          raw GET /v1/economy/state body
 *  @property {object|null} community    { stats, leaderboard } from community.squeekchain.com, may be null
 *  @property {object|null} chain        RPC facts, may be null when offline:
 *      { rpcUrl, headNumber, headTimestamp, gasPriceWei, probes: Probe[] }
 *      Probe = { id, address, call: 'totalSupply'|'name'|'symbol'|'decimals'|'balanceOf',
 *                args?: string[], raw: string, decoded: string|null, error?: string }
 */

/** @typedef {Object} Finding
 *  @property {string} id           stable kebab-case id, e.g. "supply-identity"
 *  @property {'ok'|'warn'|'fail'} severity
 *  @property {'api'|'rpc'|'community'|'mixed'} source
 *  @property {string} title        short claim that was tested
 *  @property {string} detail       one sentence with the numbers used
 *  @property {string} [expected]
 *  @property {string} [observed]
 */

/** @typedef {Object} AuditResult
 *  @property {string} generatedAt
 *  @property {'VERIFIED'|'DEGRADED'|'FAILED'} verdict   VERIFIED = no fail, no warn
 *  @property {number} pass  pass/warn/fail/total counts
 *  @property {number} warn
 *  @property {number} fail
 *  @property {number} total
 *  @property {number} score  0-100 weighted (fail = 0 weight of check, warn = 0.5)
 *  @property {Finding[]} findings
 *  @property {object|null} chain  same shape as Snapshot.chain
 */
```

## Owned files

| Owner | Files |
|---|---|
| lead | `package.json`, `src/api.js`, `src/rpc.js`, `src/contracts.js`, `src/format.js`, `src/audit.js`, `src/cli.js`, `src/mcp.js`, `fixtures/*`, `test/*`, `scripts/record-fixtures.mjs`, `docs/INTERFACE.md`, `.gitignore` |
| dashboard-web | `dashboard/index.html`, `src/badge.js`, `src/server.js`, `.github/workflows/ci.yml`, `.github/workflows/dashboard.yml` |
| docs-launch | `README.md`, `docs/PROTOCOL.md`, `docs/LAUNCH.md`, `docs/BADGES.md`, `LICENSE`, `scripts/launch-checklist.mjs`, `scripts/add-challenge.mjs`, `CHANGELOG.md` |

Never edit a file you do not own. If you need a change in someone else's file, report it to the Lead.

## Module exports

### `src/api.js` (lead)
```js
export const API_BASE = 'https://api.squeekchain.com';
export const COMMUNITY_BASE = 'https://community.squeekchain.com';
export async function getStatus(opts)            // -> raw /v1/status body
export async function getEconomy(opts)           // -> raw /v1/economy/state body
export async function getSqueek(tokenId, opts)   // -> raw /v1/squeeks/:id
export async function getAccount(address, opts)  // -> raw /v1/accounts/:address
export async function getAuraProfile(code, opts) // -> community /v1/community/profiles/:code
export async function getLeaderboard(opts)       // -> community /v1/community/leaderboard
export async function getStats(opts)             // -> community /v1/community/stats
export async function getBadgeCatalog(opts)      // -> community /v1/community/aura/badges
export async function fetchSnapshot({ chain = true, community = true, timeoutMs } = {}) // -> Snapshot
```
`opts` = `{ fetch?: typeof fetch, timeoutMs?: number }`; always passes an `Accept: application/json`
header; throws `SqueekApiError` (exported) with `.status`, `.url`, `.code` on non-2xx / bad JSON.

### `src/rpc.js` (lead)
```js
export const DEFAULT_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const RPC_FALLBACKS = [ ... ];
export class JsonRpc { constructor(url); call(method, params); getCode(addr); blockNumber(); getBlock(n); ethCall({to,data}) }
export function decodeUint(hex)   // -> bigint
export function decodeString(hex) // -> string
export async function probeChain({ fetch, rpcUrl } = {}) // -> Snapshot.chain
```
`probeChain` must never throw: any RPC failure degrades to `null` (or partial probes) and records `error`.

### `src/badge.js` (dashboard-web)
```js
export function renderBadgeSvg({ label, value, color = '#FF7A1A', labelColor = '#1A1A20' }) // -> string (a complete <svg>)
export function renderStatusBadge(snapshot)   // "hamster | BLOCK 2027 · 8.06M SQK"
export function renderAuditBadge(audit)       // "squeekwatch | VERIFIED 12/12"
```

### `src/server.js` (dashboard-web)
```js
export function createServer({ root, fetchImpl } = {}) // -> http.Server
export async function startServer({ port = 8787, root } = {}) // -> { server, port, url }
```
Routes: `GET /` + `GET /dashboard/<file>` + `GET /testdrive.html`, `GET /api/snapshot`,
`GET /api/audit`, `GET /badge.svg`, `GET /badge/audit.svg`, `GET /healthz`.
`/api/snapshot` and `/api/audit` must accept `?offline=1` (use `fixtures/` instead of the network) and
`?chain=0` (skip RPC). Always send `Access-Control-Allow-Origin: *`, `cache-control: no-store` for JSON.

### `src/cli.js` (lead)
Commands: `status`, `watch [--interval 5] [--once] [--json]`, `audit [--json] [--verbose] [--no-chain]`,
`badge [--out file]`, `race`, `protocol`, `fixtures`, `mcp`, `serve [--port 8787]`, `help`.
Exit codes: `0` verified, `1` degraded, `2` failed (or build lane not ready), `3` usage error.

## Dashboard (`dashboard/index.html`)

Single self-contained HTML file: inline CSS + inline JS, **no external assets, no CDN, no build**.
Must work three ways:

1. **Served**: `node src/cli.js serve` (or `npm start`) → `http://127.0.0.1:8787/` → data from `/api/snapshot` and `/api/audit`.
2. **GitHub Pages / static host**: relative path `/api/…` 404s, so fall back to fetching
   `https://api.squeekchain.com/v1/status` + `/v1/economy/state` directly (CORS `*`) and run a
   **client-side subset** of the audit checks (supply identity, NFT identity, round monotonicity,
   telemetry freshness, emission schedule) with a visible "local verification" banner.
3. **file://** double click: same fallback as (2).

Design tokens (Squeekchain-derived): ink `#1A1A20`, panel `#22222A`, line `#33333D`, cream `#F2EAD3`,
orange `#FF7A1A`, red `#C7362B`, green `#3FA46A`, gray `#8A8A93`. Display font stack
`"Barlow Condensed", "Arial Narrow", Impact, sans-serif`; mono stack `"IBM Plex Mono", ui-monospace, monospace`.
Dark UI, thin frames, uppercase micro-labels with letter-spacing, tabular numbers, no drop shadows.
It must be readable on a 1280x720 projector *and* on a phone (single column under 720px).

Content: (a) verdict strip; (b) live tiles — hamster RPM (canvas gauge), cumulative work units,
block height, settled round, SQK live supply with emission bar, NFT live/total, telemetry freshness;
(c) 60-point in-page history sparkline of RPM + work units (sampled from the same API on a timer);
(d) audit checklist rendered from `/api/audit` (or the local subset); (e) "chain evidence" panel
showing each RPC probe (contract → totalSupply vs API value); (f) footer: repo, commit, timestamp.
