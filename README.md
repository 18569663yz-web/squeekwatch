# Squeekwatch

**Independent observatory, invariant auditor and MCP bridge for Squeekchain — the hamster-powered
proof-of-work economy on Ethereum Sepolia.**

A real wheel, a real hamster, real blocks. Squeekwatch watches the economy the wheel is spinning,
re-derives its accounting from the public API and from Sepolia itself, and tells you — in a
terminal, a static dashboard, or from inside an AI agent — whether the numbers still add up.

```console
$ node src/cli.js status
Squeekwatch v0.1.0  2026-10-28T19:25:20.649Z
------------------------------------------------------------------------------
HARDWARE
            ○ IDLE  provenance hardware  freshness online  epoch c011f01a-93...
wheel       rpm       0  speed    0 mm/s  distance 0 mm
counter     work    22073  work/1k blocks 11224  sampled 3s ago  doc age 3s
CHAIN
anchor      block 2027  lag ?  settled round 320  confirmed 19:10:36  tx 0x0fdeaf786ad...
sqk         supply 8.07M  symbol SQK  decimals 18  emitted of cap 0.384%
MINING
            round 320 / 322  started 13  funded blocks 2027  curve floor 40%  target power 5.55M
SETTLEMENT
queue       ● submitted  id 47e6f38...  moves 320 → 321  submitted 22m 57s ago  confirmed pending
NFT
            issued 9999  live 9999  burned 0  max level 10  merges closed
VERDICT
            ● VERIFIED  ##############  100/100
checks      17 ok  0 warn  0 fail  7 skipped
```

No dependencies. No build step. No API keys. Node >= 20. Every command runs offline from
`fixtures/` too.

> **Before the first push:** the repository still carries the placeholder owner `REPLACE_ME`.
> Run `node scripts/set-identity.mjs <your-github-user>` once (it rewrites `package.json` and
> `fixtures/meta.json`) and then `node scripts/launch-checklist.mjs`. Nothing else is hard-coded.

---

## Why this exists

Squeekchain publishes exactly one definition of its economy: `https://api.squeekchain.com`, a set
of JSON documents served by the project's own backend. Community dashboards, bots and tooling
trust those documents, and there is — as far as we can tell — no independent way to check them.

That is fine until it isn't. A backend can be stale, mid-migration, or simply wrong about its own
supply. The chain cannot be. So Squeekwatch does the boring thing in both directions:

- **reads the API**, then
- **re-derives the same numbers from Sepolia** with standard JSON-RPC — `totalSupply()`, token
  metadata, contract code at the eight published addresses, block headers, the latest settlement
  receipt —

and reports where the two disagree, with the numbers rather than adjectives.

### Why it is useful to Squeekchain

| For | Value |
|---|---|
| The economy | An independent audit of the supply, emission and NFT identities. If the backend drifts, someone can see it without repo access. |
| Builders (IMD track) | An MCP server so agents can query chain state — height, work units, supply, audit verdict — through stable tool calls instead of scraping HTML or guessing JSON shapes. |
| The community | A status page that shows *why* it believes a number: every tile traces to an API field or an RPC probe, and the audit lists the two numbers behind each claim. |
| Reviewers | `node src/cli.js audit --offline` reproduces every offline check from recorded fixtures — deterministic, no network, no trust. |

It is a **watch**, not a fork: nothing here signs, submits or holds a key. Every request is a
read, and the only writes in this repository are to its own files.

---

## Architecture

```
          ┌──────────────────────────────┐        ┌────────────────────────────────┐
          │ api.squeekchain.com          │        │ Sepolia JSON-RPC               │
          │ /v1/status                   │        │ eth_call   totalSupply()       │
          │ /v1/economy/state            │        │ eth_call   name/symbol/decimals│
          │ (community: stats, badges,   │        │ eth_getCode (8 contracts)      │
          │  leaderboard, profiles)      │        │ eth_getBlockByNumber           │
          └──────────────┬───────────────┘        │ eth_getTransactionReceipt      │
                         │                        └──────────────┬─────────────────┘
                         v                                       v
                 ┌───────────────────────────────────────────────────┐
                 │ src/api.js            src/rpc.js                   │
                 │ fetch + 4 s cache     JSON-RPC, decoded bigints     │
                 │ SqueekApiError        never throws, degrades to null│
                 └───────────────────────┬───────────────────────────┘
                                         v
                 ┌───────────────────────────────────────────────────┐
                 │ Snapshot  { fetchedAt, status, economy,            │
                 │             community, chain }                     │
                 └───────────────────────┬───────────────────────────┘
                                         v
                 ┌───────────────────────────────────────────────────┐
                 │ src/audit.js — 24 invariants                       │
                 │ supply / NFT / rounds / settlement / emission /    │
                 │ telemetry / staking / gacha / chain cross-checks   │
                 └───────┬───────────────────┬───────────────────┬───┘
                         v                   v                   v
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
                 │ src/cli.js   │   │ src/server.js│   │ src/mcp.js       │
                 │ status       │   │ + dashboard/ │   │ MCP over stdio   │
                 │ audit        │   │ index.html   │   │ 6 read-only tools│
                 │ watch/badge  │   │ /api/snapshot│   │ (Claude, Cursor) │
                 │ race/protocol│   │ /api/audit   │   │                  │
                 └──────────────┘   └──────────────┘   └──────────────────┘
```

Every layer is replaceable and independently testable; `fixtures/` lets the whole stack run with
the network unplugged.

---

## Quickstart

```bash
git clone https://github.com/<owner>/squeekwatch && cd squeekwatch
node src/cli.js status          # one snapshot + verdict
node src/cli.js audit           # the 24 invariants; exit 1 on degraded, 2 on failed
node src/server.js              # dashboard on http://127.0.0.1:8787/
```

That is the whole install — there is no `npm install` step, and `node_modules` never exists.
Useful variants:

- `node src/cli.js audit --offline` — checks from `fixtures/`, no network at all (7 RPC checks are
  reported as skipped rather than silently passed).
- `node src/cli.js audit --no-chain` — API and community only, e.g. behind a restrictive network.
- `node src/cli.js status --json` — the full snapshot plus audit as JSON.

---

## The invariants

Each check is one claim, tested with the two numbers that would have to agree. Severity is `ok`,
`warn` (degraded evidence — e.g. the community API is down) or `fail` (contradiction). Run against
the bundled fixtures, all 17 API checks pass and the 7 RPC checks are skipped.

| # | id | Claim |
|---|---|---|
| 1 | `supply-identity` | `totalMintedBaseUnits = premintBaseUnits + miningMintedBaseUnits` |
| 2 | `supply-burn` | `liveSupplyBaseUnits = totalMintedBaseUnits − totalBurnedBaseUnits` |
| 3 | `supply-capacity` | `liveSupplyBaseUnits + unmintedCapacityBaseUnits = 2,100,000,000 SQK` |
| 4 | `supply-within-cap` | Minted supply never exceeds the cap |
| 5 | `allowance-identity` | `issuedBaseUnits + unmintedCapacityBaseUnits = allowanceBaseUnits` — the funded mining budget |
| 6 | `nft-identity` | `issued = live + burned` for the 9,999 Squeeks |
| 7 | `nft-config` | Level tables (`cooldownBlocks`, `basePower`) agree with `maximumLevel` = 10 |
| 8 | `nft-power-monotonic` | Base power strictly increases with level |
| 9 | `mining-round-order` | Processed round, settled round and anchor round only move forward |
| 10 | `settlement-linking` | The settlement queue's `previousSettledThroughRound` continues the confirmed anchor |
| 11 | `emission-schedule` | Issued supply stays inside the mining allowance; halving interval is sane |
| 12 | `telemetry-freshness` | Hamster telemetry is younger than `staleAfterSeconds` (120 s) |
| 13 | `telemetry-provenance` | Telemetry is hardware-sourced and the wheel module is `ready` |
| 14 | `telemetry-coherence` | RPM, speed, distance and work are internally consistent |
| 15 | `installation-consistency` | `/v1/status` and `/v1/economy/state` report the same installation and release |
| 16 | `staking-conservation` | Staking rewards never pay out more than was funded |
| 17 | `lifecycle-guard` | Lifecycle fields are populated and the guardian is set |
| 18 | `chain-head-lag` | The API's indexed block is within a sane lag of the Sepolia head |
| 19 | `chain-sqk-supply` | On-chain `totalSupply()` equals the API's minted supply |
| 20 | `chain-sqk-metadata` | `name()` / `symbol()` / `decimals()` match the published asset |
| 21 | `chain-deployment` | All eight published addresses have code on Sepolia |
| 22 | `chain-settlement-tx` | The latest settlement transaction exists on-chain and was mined |
| 23 | `chain-gacha-solvency` | The gacha vault's SQK balance does not exceed its reported funding |
| 24 | `chain-head-freshness` | The Sepolia head block is recent |

Checks 18–24 are the interesting ones: they are the only place where the project's own numbers are
compared against something the project does not control. Everything else is internal consistency —
useful, but it can be internally consistent and still wrong.

Scoring: each check contributes 100 on `ok`, 50 on `warn`, 0 on `fail`; skipped checks (RPC when
offline) are excluded from both numerator and denominator. `VERIFIED` = no warn and no fail,
`DEGRADED` = warnings only, `FAILED` = any fail. Exit codes: `0` verified, `1` degraded, `2`
failed, `3` usage.

> The audit is honest about what it does not check: it cannot verify the hamster, the oracle's
> signature chain, or the deployment's own source code. See
> [docs/PROTOCOL.md §4](docs/PROTOCOL.md#4-what-we-could-not-verify).

---

## CLI

| Command | What it does |
|---|---|
| `status` | One-shot snapshot and verdict (the default command): hardware, chain anchor, supply, rounds, settlement, NFT, staking. |
| `audit` | The 24 invariants, with the two numbers behind each. `--verbose` prints each rule's title. |
| `watch` | Live board until Ctrl-C. `--interval <s>` (default 10), `--once`, `--json` (NDJSON). |
| `badge` | Build-lane readiness for the Genesis `code.early_buildooooor` submission: what a reviewer would find in this repo. |
| `race` | The exact submission packet for the independent-project lane — name, integration copy, repo/demo URL, and the latest snapshot as evidence. |
| `protocol` | How each number is sourced and cross-checked. |
| `fixtures` | Age and integrity of the recorded snapshots. |
| `mcp` | MCP server on stdio (see below). |
| `help`, `version` | Usage and version. |

Flags: `--json`, `--offline` (fixtures only, implies `--no-chain`), `--no-chain`, `--no-community`,
`--no-color`, `--rpc <url>`, `--timeout <ms>` (default 4000), `--interval <s>`, `--once`,
`--verbose`, `--quiet`, `-h/--help`, `-v/--version`.

`npm run status | watch | audit | badge | race | mcp` are aliases for the same commands; the CLI
itself needs no install. `node src/server.js [--port 8787]` starts the dashboard server.

---

## MCP (agents)

Squeekwatch speaks the Model Context Protocol over stdio, so an agent can ask the economy questions
instead of parsing HTML. Six tools, all read-only — they fetch, audit and format; nothing signs or
sends:

| Tool | Returns |
|---|---|
| `squeekchain_status` | Status snapshot: telemetry, block anchor, settlement queue, module health |
| `squeekchain_audit` | The invariant audit with verdict, score and per-check detail |
| `squeekchain_economy` | Supply, schedule, mining curve, staking, NFT tables |
| `squeekchain_squeek` | One Squeek by token id (1–9999) |
| `squeekchain_account` | One account by address |
| `squeekchain_leaderboard` | Community leaderboard |

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "squeekwatch": {
      "command": "node",
      "args": ["/absolute/path/to/squeekwatch/src/cli.js", "mcp"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "squeekwatch": {
      "command": "node",
      "args": ["${workspaceFolder}/src/cli.js", "mcp"]
    }
  }
}
```

Windows: use a full path with forward slashes (`C:/tools/squeekwatch/src/cli.js`) and keep
`"command": "node"` — no shell wrapper, no quoting games.

Then ask for the verdict directly:

> "Use squeekchain_audit and tell me which invariants are failing, with the two numbers in each
> failing check. Then use squeekchain_status for the current block height, cumulative work units
> and live SQK supply, and flag anything older than the 120 s telemetry freshness window."

Each tool returns JSON-serializable content, so an agent can quote exact values instead of
paraphrasing. Every request carries a timeout, so a dead endpoint produces a tool error rather than
a hang.

---

## Dashboard

`node src/server.js` serves `dashboard/index.html` — one self-contained HTML file, inline CSS,
inline JS, no CDN, no build. The same file also works on GitHub Pages and from `file://` by
fetching the public API directly and running a client-side subset of the audit, with a visible
banner saying which mode it is in.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SQUEekWATCH            VERIFIED 24/24                       2026-10-28 19:25│
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ HAMSTER      │ │ BLOCK        │ │ LIVE SUPPLY  │ │ SQUEEKS      │        │
│  │ 0 RPM        │ │ 2,027        │ │ 8,066,546.79 │ │ 9,999 / 9,999│        │
│  │ 22,073 units │ │ round 320    │ │ of 2.1B      │ │ 0 burned     │        │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                              │
│  emission ██▏                                       chain  totalSupply ✓    │
│  freshness  online · 3.2 s ago                      settlement tx ✓         │
└──────────────────────────────────────────────────────────────────────────────┘
```

The real page is a dark, thin-framed console (ink `#1A1A20`, orange `#FF7A1A`, cream `#F2EAD3`)
built to be legible on a projector *and* a phone: single column under 720 px, no drop shadows,
tabular numbers, uppercase micro-labels.

Server routes: `/` (dashboard) and `/testdrive.html`, `/api/snapshot`, `/api/audit`, `/badge.svg`,
`/badge/audit.svg`, `/healthz`. The JSON routes accept `?offline=1` and `?chain=0` and always send
`Access-Control-Allow-Origin: *` with `cache-control: no-store`.

---

## Data sources and honesty

| Source | What we take from it |
|---|---|
| `https://api.squeekchain.com/v1/status` | Wheel measurement, block anchor, settlement queue, signer, module health |
| `https://api.squeekchain.com/v1/economy/state` | Supply, schedule, mining curve, staking, NFT tables, deployment blocks |
| `https://community.squeekchain.com/v1/community/*` | Members, badges, leaderboard, profiles |
| Sepolia JSON-RPC (`https://ethereum-sepolia-rpc.publicnode.com`) | Token supply/metadata, contract code, block headers, settlement receipt |

Read-only and keyless. Every endpoint is public and answers with `Access-Control-Allow-Origin: *`.
The contracts are not verified on Sourcify, so Squeekwatch calls only **standard ERC-20 selectors**
(`totalSupply` `0x18160ddd`, `name` `0x06fdde03`, `symbol` `0x95d89b41`, `decimals` `0x313ce567`,
`balanceOf` `0x70a08231`) — it never guesses a custom ABI.

Honesty rules we hold ourselves to:

1. Any number in these docs can be reproduced from the API, the chain, or `fixtures/`.
2. Anything inferred is labelled *inferred* — the emission schedule's exact rounding, the
   `blockProgress`/`workPerThousandBlocks` relationship, and the aura weights all live in that
   bucket.
3. A `warn` is never silently upgraded to `ok`; degraded evidence is reported as degraded, and
   skipped checks are counted as skipped, not passed.
4. No fabricated screenshots, no placeholder images, no future-tense features presented as
   shipped.

Squeekwatch is unaffiliated with Squeekchain. It is a community observer that would rather show
you the receipts than the conclusion.

---

## Ethics

Squeekwatch was built for the Genesis **code** track, where verification proves *repository
control*, not authorship, and where places are assigned in order and never reassigned. We respect
that:

- **One person, one submission.** No multi-accounting, no throwaway wallets, no resubmitting the
  same repository from a second profile.
- **We verify what we actually built.** The repository challenge file stays on the default branch
  permanently; removing it revokes the badge, and a disqualified holder's place stays empty.
- **No attributions we cannot support.** We do not copy, fork-and-claim, or borrow another
  project's identity.
- **The badge is not the point.** The observatory works whether or not it is verified; the
  verification is a receipt for work that stands on its own.

If Squeekwatch is wrong about something, the audit is designed to be wrong *loudly* — open an issue
with the numbers.

---

## Docs

| File | Contents |
|---|---|
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Reverse-engineered API reference: every endpoint, field, unit and real snapshot value; contract addresses and selectors; "what we could not verify". |
| [docs/BADGES.md](docs/BADGES.md) | All 14 badges, live holder counts, the code lane, the aura/tier picture. |
| [docs/LAUNCH.md](docs/LAUNCH.md) | The 90-second submission runbook for the first-88 window. |
| [docs/INTERFACE.md](docs/INTERFACE.md) | Module contract: data shapes, owned files, exports. |
| [CHANGELOG.md](CHANGELOG.md) | Version history. |

---

## License and contributing

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Squeekwatch contributors.

Issues and PRs are welcome, with two rules: **no new dependencies** (the zero-dependency promise is
the product), and **every claimed number needs a source** — an API field, an RPC call, or a
fixture. `node --test test/` must stay green and `node scripts/launch-checklist.mjs` must stay
PASS before a release.

---

## 中文速览

Squeekwatch 是 Squeekchain（Sepolia 上的仓鼠跑轮 PoW 链）的独立观测站：零依赖 Node.js，一条
`node src/cli.js audit` 用 24 个不变量把官方 API 和链上数据对账，冲突时直接给出两个数字。
`node src/server.js` 起本地看板，`node src/cli.js mcp` 把同样的读取能力暴露给 Claude / Cursor 等 agent。
所有请求只读，不需要私钥和 API key；`--offline` 用录制的 fixtures 完全离线复现。
协议细节见 [docs/PROTOCOL.md](docs/PROTOCOL.md)，徽章与提交窗口见 [docs/BADGES.md](docs/BADGES.md) 与 [docs/LAUNCH.md](docs/LAUNCH.md)。
