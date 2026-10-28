# Squeekchain public API — protocol notes

Squeekwatch reads Squeekchain's public APIs and Sepolia. Those APIs are **not documented**
by the project; this file is our field manual, reconstructed from real responses and from the
official web client. It exists so that anyone can check the same numbers we publish, and so
that future Squeekwatch work does not have to reverse-engineer the same endpoints twice.

Legend used throughout:

| Mark | Meaning |
|---|---|
| **observed** | The value/shape appeared verbatim in a response we captured (snapshot below). |
| **inferred** | We derived it; the API does not state it. Treat as a hypothesis. |
| **unknown** | We did not verify it. Do not build on it. |

Snapshot used for every example in this document:
`2026-10-28T19:25:20.649Z`, installation `stream-game-sepolia-test-20261025-01`,
protocol revision `stream-game-1`. Fixtures in [`fixtures/`](../fixtures) are that exact
capture, so every number here can be reproduced offline.

---

## 0. Ground rules

| Item | Value |
|---|---|
| Live chain telemetry | `https://api.squeekchain.com` |
| Genesis / community | `https://community.squeekchain.com` (all routes below `/v1/community`) |
| Sites | `https://squeekchain.com`, `https://sepolia.squeekchain.com` (same build) |
| CORS | `Access-Control-Allow-Origin: *` on the read endpoints we use (**observed**) |
| Auth on GETs | none (**observed**) |
| Auth on writes | session bearer token, see §2.5 (**inferred from the client**) |
| Chain | Ethereum Sepolia, `chainId` `11155111` (**observed** in `economy/state`) |
| Timestamps | ISO-8601 UTC with milliseconds/microseconds | 
| Quantities | Integers. `*BaseUnits` fields are decimal **strings** in SQK base units (18 decimals). Counters (`blockHeight`, `cumulativeWork`, rounds) are also decimal strings. |
| Versioning | `schemaVersion` on the document (`status` = 1, `economy/state` = 2, `genesis-launch` = 2, **observed**) |

`generatedAt` is the server's clock; `measurement.observedAt` / `receivedAt` are the device's
and the ingestion point's clocks. They differ, and the difference is the thing worth watching:
a healthy snapshot has `observedAt ≤ receivedAt ≤ generatedAt` within a few seconds.

A note on what these numbers *are not*: `/v1/status` is a **telemetry + settlement report**
from one physical installation, and `/v1/economy/state` is the **economy ledger** derived from
it. Neither is a blockchain explorer. The chain is a separate, slower source of truth, which
is why Squeekwatch cross-checks them (§3).

---

## 1. Chain telemetry — `api.squeekchain.com`

### 1.1 `GET /v1/status`

One hardware installation's live view: the hamster wheel, the block builder, the oracle, the
settlement queue and the attesting signer. Everything is in one document because it is one
machine's story.

Top level (**observed**):

| Field | Type | Example | Meaning |
|---|---|---|---|
| `schemaVersion` | number | `1` | Document schema. |
| `installationId` | string | `stream-game-sepolia-test-20261025-01` | Which rig produced this. The suffix looks like a deploy date + counter; treat as opaque. |
| `revision` | string | `Er6WZYRvlUfUBgKvx2nBS-j6roGUDNKDqfZvExJgv_w` | 43-char base64url build/state revision. Changes when the reporter's state changes. |
| `generatedAt` | ISO string | `2026-10-28T19:25:20.649Z` | Server-side generation time. |
| `measurement`, `builder`, `oracle`, `settlementQueue`, `signer`, `modules` | objects/array | — | See below. |

#### `measurement` — the physical wheel

| Field | Type | Example | Meaning |
|---|---|---|---|
| `freshness` | enum | `online` | Reporter's own liveness verdict. `stale`/`offline` are the plausible other states (**inferred**; not observed). |
| `observedAt` | ISO string | `2026-10-28T19:25:17.488Z` | When the sensor sample was taken. |
| `receivedAt` | ISO string | `2026-10-28T19:25:18.034Z` | When the sink accepted it. |
| `staleAfterSeconds` | number | `120` | After this long without a sample the reading is no longer fresh. This is the tolerance Squeekwatch's `telemetry-freshness` check uses. |
| `counterEpoch` | UUID | `c011f01a-93ba-45ff-8579-619ddfdf40ec` | Identifies one continuous counter run. A counter reset (device reflash, wheel swap) starts a new epoch, so a drop in `cumulativeWorkUnits` is only a bug **within** an epoch. |
| `cumulativeWorkUnits` | decimal string | `22073` | Lifetime work units counted on this rig. Monotonic within an epoch. |
| `provenance` | enum | `hardware` | Where the numbers came from. The interesting alternative (`synthetic`/`software`) would invalidate the whole premise; we have only ever seen `hardware`. |
| `coreStatus` | enum | `IDLE` | State of the work core. `IDLE` = no work being accumulated into a block right now (the wheel was still at sample time). |
| `rpmMilli` | integer | `0` | Wheel speed in **thousandths of a revolution per minute**. `12000` would be 12 RPM. Not an RPM float — do not divide by 1000 twice. |
| `speedMmPerSecond` | integer | `0` | Rim speed in mm/s. |
| `distanceMm` | integer | `0` | Distance travelled in this reporting window (not cumulative). |

There is **no `stepUnits` field** in `/v1/status`. Step-like quantities do not appear anywhere
in the public documents we hold; do not invent them.

#### `builder` — how work becomes blocks

```json
"builder": {
  "status": "available",
  "anchor": {
    "cumulativeWork": "22073",
    "cumulativeBlockUnits": "2027753319164",
    "blockHeight": "2027",
    "blockProgress": "753319164",
    "workPerThousandBlocks": "11224",
    "settledThroughRound": "320",
    "confirmedAt": "2026-10-28T19:10:36.000Z",
    "transactionHash": "0x0fdeaf786adc8b253b0366920c33d21f8238509f5d8f91eb7652ddfa393c208e"
  },
  "queued": { "closedRoundCount": "1", "closedWorkUnits": "0", "openRoundWorkUnits": "0" },
  "projected": { "...": "same shape as anchor, plus block completion counters" }
}
```

`anchor` is the **last on-chain confirmed state**; `projected` is what the builder would settle
next. Fields:

| Field | Type | Example | Meaning |
|---|---|---|---|
| `cumulativeWork` | decimal string | `22073` | Work units consumed up to this anchor. |
| `cumulativeBlockUnits` | decimal string | `2027753319164` | Blocks completed, scaled by 1e9. **Observed identity:** `blockHeight * 1e9 + blockProgress` — `2027 × 10⁹ + 753319164 = 2027753319164` exactly. |
| `blockHeight` | decimal string | `2027` | Whole blocks minted so far. Matches `economy.schedule.closedThroughBlock`. |
| `blockProgress` | decimal string | `753319164` | Fraction of the next block, in 1e-9 blocks (**inferred** from the identity above). |
| `workPerThousandBlocks` | decimal string | `11224` | Work units per 1,000 blocks. **Its relation to `cumulativeWork / blockHeight` is not established**: the snapshot implies 10.89 work units per block (10,890 per 1,000), while this field says 11,224. It is likely a curve/target parameter rather than a derived ratio (**inferred**). Do not model one from the other. |
| `settledThroughRound` | decimal string | `320` | Highest settlement round the chain has confirmed. |
| `confirmedAt` | ISO string | `2026-10-28T19:10:36.000Z` | When that anchor confirmed. |
| `transactionHash` | 0x hash | `0x0fdeaf78…c208e` | The settlement transaction that produced this anchor. |

`queued` describes work already closed but not yet in a settlement round: `closedRoundCount`
rounds, `closedWorkUnits` work already counted, `openRoundWorkUnits` work in the open round.

`projected` repeats the anchor fields plus `firstCompletedBlock`, `lastCompletedBlock`,
`completedBlockCount` and `lifecycle`. In the snapshot those are `null`, `null`, `"0"` and
`"optimistic"` — i.e. nothing has completed past the anchor yet and the projection is
optimistic.

#### `oracle` — the work-unit attestation

| Field | Type | Example | Meaning |
|---|---|---|---|
| `state` | enum | `accepted` | Oracle verdict on the latest attestation. |
| `reason` | string\|null | `null` | Why it was rejected, when it was. |
| `latestAcceptedAt` | ISO string | `2026-10-28T19:25:18.034Z` | When the oracle last accepted a batch. Equals `measurement.receivedAt` in the snapshot — acceptance is per ingested sample. |
| `latestClosure.firstRound` / `lastRound` / `roundCount` | decimal strings | `321` / `321` / `1` | The round range the oracle last closed. |
| `latestClosure.acceptedAt` | ISO string | `2026-10-28T19:20:08.057Z` | When that closure was accepted. |

#### `settlementQueue` — rounds on their way to Sepolia

This is the most illuminating block in the document: it shows a queue that is mid-flight.

| Field | Type | Example | Meaning |
|---|---|---|---|
| `status` | enum | `available` | Block-level availability (`available` else the block is degraded). |
| `state` | enum | `submitted` | Queue state. `submitted` = a transaction is out, not yet confirmed (**observed**). Other states are **unknown**. |
| `settlementEnabled` | boolean | `true` | Whether this environment is allowed to settle at all. |
| `reporterEnvironmentEnabled` | boolean | `true` | Whether the reporter side is enabled. |
| `buffered` | object | `firstRound 321, lastRound 321, roundCount 1, activeRoundCount 0, workUnits "0"` | Rounds closed locally and waiting. |
| `projected` | object | same shape as `builder.projected` | Expected chain state after the queue drains. |
| `incidentOpen` | boolean | `false` | Whether an incident is declared. |
| `blockedReason` | string\|null | `null` | Why the queue is blocked, when it is. |
| `lastRun.startedAt` / `finishedAt` / `result` | ISO, ISO, enum | `19:20:27.413Z`, `19:20:29.804Z`, `submitted` | The last settlement attempt (2.4 s). |
| `latestSubmission` | object | see below | The submission currently in flight. |

`latestSubmission` (**observed**):

| Field | Example | Meaning |
|---|---|---|
| `submissionId` | `47e6f387-1391-4fd7-b8c6-2958fb303cc0` | Idempotency key for the submission. |
| `lifecycle` | `submitted` | Same vocabulary as `state`. |
| `previousSettledThroughRound` → `settledThroughRound` | `320` → `321` | The round range this submission advances. **Invariant:** `previousSettledThroughRound` must equal the anchor's `settledThroughRound`. In the snapshot the anchor still says 320 because this submission has not confirmed. |
| `roundCount`, `activeRoundCount` | `1`, `0` | Rounds in the batch, and how many were still active. |
| `expected` | object | The post-settlement projection the submission commits to. |
| `transactionHash` | `0x3655a964…a93f` | The Sepolia transaction. |
| `createdAt` / `submittedAt` / `changedAt` | `19:20:28.897Z` | Submission timestamps. |
| `confirmedAt` / `terminalAt` / `outcomeCode` | `null` | Filled when the confirmation lands. The economy API requires **12 confirmations** (`chain.confirmations`), so this lag is expected, not an error. |

#### `signer` — what attests the samples

| Field | Type | Example | Meaning |
|---|---|---|---|
| `kind` | string | `trust-m` | Hardware secure element family (**inferred** from the name; the API does not explain it). |
| `algorithm` | string | `ecdsa-p256-sha256` | Signature algorithm for telemetry attestation. |
| `keySlot` | hex string | `0xE0F3` | Slot of the signing key in the element. |
| `enrolledAt` | ISO string | `2026-10-26T16:03:26.750Z` | When the key was enrolled. |
| `lastVerifiedAt` | ISO string | `2026-10-28T19:25:18.034Z` | Last successful verification. |
| `lastSignature` | base64 | `L3XBtbw1…ZXw==` | ECDSA-P256 signature (64 bytes base64-encoded) over the latest sample batch. |

#### `modules` — attached hardware

Array; the snapshot has exactly one entry:

| Field | Example | Meaning |
|---|---|---|
| `instanceId` | `wheel` | Logical instance name. |
| `moduleType` | `wheel.counter` | Driver type: counts wheel revolutions. |
| `driverId` | `usb-rp2040-a3144e-lm393` | Driver/dongle id. The name suggests a USB RP2040 board with an LM393 optical sensor (**inferred**). |
| `moduleVersion`, `schemaVersion` | `0.2.1`, `1` | Module firmware and payload schema. |
| `state` | `ready` | Module health state. |
| `observedAt` | `2026-10-28T19:25:17.488281Z` | Last sample (microsecond precision). |
| `provenance` | `hardware` | Same vocabulary as `measurement.provenance`. |
| `health.checkedAt` | same as `observedAt` | Last health probe. |
| `data` | `{}` | Module-specific payload; empty for the wheel counter. |

---

### 1.2 `GET /v1/economy/state`

The ledger: who is deployed, how much SQK exists, how emission works, what staking and NFT
rules are. Unlike `/v1/status`, this is not installation-specific.

#### `release` and `chain`

| Field | Example | Meaning |
|---|---|---|
| `release.id` | `stream-game-sepolia-test-20261026-01` | Economy release identifier. |
| `release.protocolRevision` | `stream-game-1` | Protocol revision. |
| `release.rewardModelRevision` | `funded-stream-q128-1` | Reward model revision; `q128` suggests Q-format fixed-point maths (**inferred**). |
| `chain.target` | `sepolia` | Target network. |
| `chain.chainId` | `"11155111"` | Sepolia. |
| `chain.confirmations` | `"12"` | Confirmations before a settlement counts as final. |
| `chain.deploymentBlock` | `11998937` | Block the core deployment landed in. |
| `chain.economyDeploymentBlock` | `11998950` | Block the economy contracts landed in. |
| `chain.indexedThroughBlock` | `12014395` | Last block the API indexer has read. |
| `chain.safeThroughBlock` | `12014384` | Last block considered safe (12 confirmations behind the indexer: `12014395 − 12014384 = 11`; the 12th confirmation is the next block — **inferred**). |
| `chain.safeBlockHash` | `0x702504…8171` | Hash of that safe block. |
| `chain.safeBlockTimestamp` | `2026-10-28T19:23:00.000Z` | Its timestamp. |

#### `identities` — deployed contracts

| Field | Address |
|---|---|
| `identities.core` | `0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44` |
| `identities.genesis` | `0xcb98349c134ab983da5bfd80527dfe2552bdb70f` |
| `identities.token` | `0x5501e1fa81be1c3f49225fa7668da0245d07db60` |
| `identities.tokenFactory` | `0x779a302adbaa9c8a3da45ef48ad67e6a45fcef29` |
| `identities.launch` | `0x1ff6485abfbb2d183cd673d78e1ab31c098e04dd` |
| `identities.mining.proxy` | `0xcd46990f8349057335289ef282c276204b6cdc62` |
| `identities.mining.implementation` | `0x62d25dc1a24033a80edcc4b2d2ffe9348290cc4c` |
| `identities.mining.implementationVersion` | `"9"` |
| `identities.mining.storageLayoutDigest` | `0x136850fc0e19543752b7382cde164f10588dc3b4648e7d704f2f06394ead8b90` |
| `identities.staking.proxy` | `0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f` |
| `identities.staking.implementation` | `0xbbb816616d8840bd98094bf5a20f208df089230b` |
| `identities.staking.implementationVersion` | `"2"` |
| `identities.staking.storageLayoutDigest` | `0x39f298bf725abe5173d3a3b8ded2d4776d4c53fc9923f0027170dd458210a6f8` |

Mining and staking are **upgradeable proxies**: `proxy` is the address users interact with,
`implementation` is the current logic. The `storageLayoutDigest` is what an upgrade-safety
check compares, and `implementationVersion` is the upgrade counter. Squeekwatch reports these
so a silent upgrade is visible.

#### `asset`

`{ "token": "0x5501e1fa…db60", "symbol": "SQK", "decimals": 18 }` (**observed**). One SQK is
`10¹⁸` base units; every `*BaseUnits` field in this document is in that unit.

#### `lifecycle`

| Field | Example | Meaning |
|---|---|---|
| `stage` | `active` | Economy stage. `active` = mining and settlement are running. |
| `startRound` | `13` | First round that counted for rewards. |
| `currentRound` | `322` | Current accounting round. Rounds are the work-accounting windows that get settled; they advance with settlement, not with blocks (**inferred** from the 1-round settlement in flight). |
| `paused` | `false` | Emergency pause flag. |
| `guardian` | `0x3c4c2ba9a5dfbfc5e48dceabdd3b004131a04be6` | Address that can pause. Not a public user-facing role. |

#### `supply` — the 2.1B SQK ledger

| Field | Base units | SQK |
|---|---|---|
| `capBaseUnits` | `2100000000000000000000000000` | 2,100,000,000 |
| `premintBaseUnits` | `1` | 1 base unit (not one SQK — a single wei-like unit) |
| `miningMintedBaseUnits` | `8066546793063427114304838` | 8,066,546.793063427 |
| `totalMintedBaseUnits` | `8066546793063427114304839` | 8,066,546.793063427 + 1 base unit |
| `totalBurnedBaseUnits` | `0` | 0 |
| `liveSupplyBaseUnits` | `8066546793063427114304839` | 8,066,546.793063427 + 1 base unit |
| `unmintedCapacityBaseUnits` | `2091933453206936572885695161` | 2,091,933,453.206936572885695161 |

Re-derived arithmetic (all **observed**, computed by Squeekwatch on every run):

| Identity | Check |
|---|---|
| `totalMinted = premint + miningMinted` | `8066546793063427114304838 + 1 = 8066546793063427114304839` ✓ |
| `liveSupply = totalMinted − totalBurned` | ✓ |
| `liveSupply + unmintedCapacity = cap` | `…839 + 2091933453206936572885695161 = 2100000000000000000000000000` ✓ |
| minted never exceeds `cap` | ✓ (0.384 % of cap at snapshot time) |

Note the 1-base-unit premint: it is *not* one SQK, and a naive 18-decimal formatter will show
`0.000000000000000001 SQK`. That mismatch is exactly the kind of thing Squeekwatch exists to
make impossible to overlook.

#### `schedule` — emission

| Field | Base units | Meaning |
|---|---|---|
| `allowanceBaseUnits` | `2099999999999999999999999999` | Total SQK mining may ever issue: `cap − premint`. |
| `launchBonusBaseUnits` | `105000000000000000000000000` | 105,000,000 SQK launch bonus pool. |
| `bonusBlocks` | `97020` | Blocks over which the launch bonus is spread. |
| `halvingBlocks` | `393470` | Blocks per halving period. |
| `firstPeriodRateBaseUnits` | `2897298396319922738708` | 2,897.298396319922619 SQK per block, first period. |
| `startHeight` | `0` | Emission starts at block 0 (pre-deployment blocks count). |
| `closedThroughBlock` | `2027` | Last block whose emission is settled; matches `builder.blockHeight`. |
| `issuedBaseUnits` | `8066546793063427114304838` | Issued so far. |

**Verified emission identity** (our own derivation — the API never states it):

```
issued = closedThroughBlock × (firstPeriodRate + floor(launchBonus / bonusBlocks))
```

`2027 × (2897298396319922738708 + 1082251082251082251082) = 8066546793063427114304330`, which
is 508 base units short of the published `8066546793063427114304838` — a rounding remainder of
5.08 × 10⁻¹⁶ SQK, i.e. the launch bonus is distributed per block with the remainder carried.
So during the first `bonusBlocks` blocks the effective rate is
`firstPeriodRate + launchBonus/bonusBlocks` = **3,979.55 SQK per block**; after block 97,020
the bonus stops and the rate halves every `halvingBlocks` (393,470) blocks. Whether halving
applies to the bonus-inclusive rate or the base rate is **inferred** (the snapshot is far too
early to observe a halving).

Sanity check on the budget: `firstPeriodRate × 393,470 × 2 ≈ 2.28 B` SQK — the allowance is
2.1 B, so the schedule must truncate the tail rather than halve forever (**inferred**).

#### `mining` — where the reward stream goes

| Field | Example | Meaning |
|---|---|---|
| `processedThroughRound` | `320` | Last round whose funding has been computed. |
| `fundedBlocks` | `2027` | Blocks whose reward funding has been computed. |
| `gachaFundedBaseUnits` | `8060015158504248523815084` | 8,060,015.158504248523815084 SQK routed to the gacha vault. |
| `stakingFundedBaseUnits` | `6531634559178590489754` | 6,531.634559178590489754 SQK routed to staking rewards. |
| `gachaVault` | `0x5f6ba50f448b84e09f5ee324a6402b033ba70e28` | Vault address. |
| `curve.floorBps` | `4000` | Emission curve floor: 4,000 bps = 40 % of the target. |
| `curve.targetPower` | `5555000000000000000000000` | Target power (5,555,000 × 10¹⁸) — the curve's input scale. |
| `pendingCurve` | `null` | A curve change awaiting activation; none pending. |

**Observed identity:** `gachaFunded + stakingFunded = miningMinted` exactly, so every minted
SQK is accounted for on the reward side. 99.91 % goes to gacha funding, 0.09 % to staking.

`floorBps` / `targetPower` belong to a reward curve whose formula is **not public**. We report
the parameters and the split, not a claimed formula.

#### `staking`

| Field | Example | Meaning |
|---|---|---|
| `paused` | `false` | Staking pause flag. |
| `launchReady` | `true` | Whether staking is armed for launch. |
| `totalStakedBaseUnits` | `0` | Nothing staked yet at snapshot time. |
| `freshPrincipalBaseUnits` / `freshUntilRound` | `0` / `0` | Principal still inside the freshness window. |
| `totalNftPower` | `42000000000000000000000` | 42,000 × 10¹⁸ — NFT-derived power. |
| `totalSqkPower` | `0` | SQK-derived power (none yet, nothing staked). |
| `sqkPerPower` | `40000000000000000000` | 40 SQK per power unit (**inferred** unit from the name). |
| `referencePower` | `1000000000000000000000` | 1,000 × 10¹⁸ reference power for the exit-fee curve. |

`exitPolicy` (**observed**):

| Field | Example | Meaning |
|---|---|---|
| `minBps` | `200` | Minimum exit fee: 2 %. |
| `maxBps` | `6000` | Maximum exit fee: 60 %. |
| `saturationBps` | `2000` | Saturation point: 20 %. |
| `windowDays` | `7` | The policy window. |
| `pressureFloorBaseUnits` | `21000000000000000000000000` | 21,000,000 SQK — the pressure floor below which the fee policy behaves differently (**inferred**). |

`rewards` (**observed**): `fundedBaseUnits` `6531634559178590489754`, `paidBaseUnits`
`2410422766563133045967`, `compoundedBaseUnits` `0`, `remainingBaseUnits` `0`,
`rewardIndex` `695835768034326655861568869318904851479`,
`streamRateBaseUnitsPerSecond` `0`, `streamEndsAt` `0`.

`paid / funded = 36.9 %`. `remaining = 0` while the stream rate is 0 means the classic
"remaining" reading would be misleading — the funded amount is a lifetime budget, not an
unspent balance (**inferred**). Squeekwatch's `staking-conservation` check therefore tests
`paid + compounded ≤ funded` rather than `remaining` bookkeeping.

#### `nft` — Squeeks

| Field | Example |
|---|---|
| `issued` | `9999` |
| `burned` | `0` |
| `live` | `9999` |
| `mergesOpen` | `false` |
| `maximumLevel` | `10` |
| `cooldownBlocks` | `["0","3000","7000","14000","21000","28000","35000","42000","49000","0"]` |
| `basePower` | `["1000","2200","4840","10648","23426","51536","113380","249436","548759","1207269"]` |

`issued = live + burned` ✓ (9,999 = 9,999 + 0).

Both arrays have `maximumLevel` entries, index 0 = level 1. `cooldownBlocks` is the cooldown
before the next level; the final `"0"` means no cooldown is published for the top level (or
the table is 1-based and the last slot is unused — **unknown**). `basePower` is strictly
increasing, roughly ×2.2 per level; a level-10 Squeeks carries 1,207× a level-1.

`totalNftPower` (42,000 × 10¹⁸) with 9,999 NFTs implies an average of 4.2 × 10¹⁸ power per NFT,
i.e. most Squeeks sit at level 1–2 if `basePower` is denominated in 10¹⁸ units (**inferred**).

---

### 1.3 `GET /v1/squeeks/{id}` and `GET /v1/accounts/{address}`

Both exist on `api.squeekchain.com` and are used by the official front end. Squeekwatch exposes
them through `getSqueek(id)` / `getAccount(address)` and validates the obvious inputs
(`id` ∈ 1…9999, `address` = 20-byte hex) before calling.

Their **response shapes are not captured in our snapshot**, and Squeekwatch does not derive any
audit finding from them — the clients pass the JSON through untouched. Treat the body as
**unknown** until you fetch one yourself.

### 1.4 `GET /v1/genesis-launch`

The launch gate for the Genesis event.

```json
{ "schemaVersion": 2, "status": "unavailable", "reason": "launch_unconfigured" }
```

`status: "unavailable"` means the launch programme is not configured on this deployment. The
interesting transition to watch on launch day is this document becoming `available` — see
[LAUNCH.md](LAUNCH.md) §3 for the three detector commands.

---

## 2. Genesis / community — `community.squeekchain.com`

Everything lives under `/v1/community` (**observed** in the official client bundle: a single
`/v1/community` prefix constant plus per-route paths).

### 2.1 `GET /v1/community/stats`

```json
{
  "members": 1159,
  "badgesEarned": 2382,
  "projectsVerified": 0,
  "totalAura": 158223,
  "snapshot": { "members": 1159, "computedAt": "2026-10-28T17:42:17.322Z" }
}
```

| Field | Meaning |
|---|---|
| `members` | Genesis profiles created. |
| `badgesEarned` | Total badge awards across all members. |
| `projectsVerified` | Projects that passed code-track verification. **0** at snapshot time. |
| `totalAura` | Sum of all members' aura. |
| `snapshot.computedAt` | When the aggregates were computed — they lag live data, by design. |

### 2.2 `GET /v1/community/aura/badges`

The badge catalogue: 14 badges, each with its criteria and live holder counts. Field table:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable id, `<lane>.<name>` e.g. `code.early_buildooooor`. |
| `lane` | enum | `clout` (social/invite) or `code` (building). |
| `title` | string | Display name. |
| `description` | string | One-line description. |
| `instruction` | string | How to earn it. |
| `criteria[]` | array | `{ label, detail }` rows; `detail` may be `null`. |
| `trophy` | boolean | Trophy badges show on the profile but add no aura (**observed** in their criteria copy). |
| `rarity.holders` | number | Current holders. Rarity data is live. |
| `rarity.heldByBps` | number | Basis points of the member base: `holders / members × 10,000`. `1159 → 10000` for `signed_up` confirms the denominator is the snapshot's member count. |
| `snapshot` | object | `{ members, computedAt }` for the rarity numbers. |

Full catalogue, with current holders, is in [BADGES.md](BADGES.md).

### 2.3 `GET /v1/community/leaderboard`

```json
{
  "entries": [
    { "rank": 1, "code": "zehzm8kn", "identity": { "kind": "x", "username": "HIB_BTC", "name": "MrHIB", "profileImageUrl": "…" }, "aura": 2939, "badges": 7, "tier": "gold" }
  ],
  "snapshot": { "members": 1159, "computedAt": "…" },
  "generatedAt": "2026-10-28T19:22:43.092Z"
}
```

| Field | Meaning |
|---|---|
| `entries[].rank` | 1-based rank. |
| `entries[].code` | Profile code (short id, e.g. `8mae44td`). |
| `entries[].identity.kind` | `x` (has a linked X account) or `alias` (display name only). |
| `entries[].aura` | Aura points. |
| `entries[].badges` | Badge count. |
| `entries[].tier` | `gold` / `silver` / `bronze` / `member` (**observed enum values**; only `gold` appears in the top 100). |

The board is **capped at 100 entries** in the snapshot; whether it is a hard cap or a page size
is **unknown**. In our capture all 100 entries are `gold`, aura ranges 698 (rank 100) to 2,939
(rank 1), and 96 of 100 identities are X-linked. That is the only tier data we have: we do not
know the tier thresholds, only the observed values.

### 2.4 `GET /v1/community/profiles/{code}`

```json
{
  "code": "8mae44td",
  "valid": true,
  "identity": { "kind": "x", "username": "Despite_zmw", "name": "Dess", "profileImageUrl": "…" },
  "standing": { "rank": null, "aura": 0, "tier": null, "next": null, "movement": null },
  "completedReferrals": 1,
  "inviteeColors": [6],
  "achievements": ["signed_up", "on_discord", "the_invitooor"],
  "snapshot": { "members": 1159, "computedAt": "…" }
}
```

| Field | Meaning |
|---|---|
| `valid` | Whether the code resolves. |
| `standing.rank` / `aura` / `tier` | Ranking state; `null` when unranked. |
| `next`, `movement` | Next-tier hint and rank movement; `null` when absent. |
| `completedReferrals`, `inviteeColors` | Referral bookkeeping (colour index, 1–8). |
| `achievements[]` | Badge ids earned (matches `aura/badges` ids). |
| `snapshot` | Aggregates' computation time. |

Profile codes validate as `^[a-z0-9][a-z0-9._-]{2,40}$` in the client (**inferred** from its
input schema).

### 2.5 Session and auth (write path)

Read endpoints need no token. The code-track write endpoints need a **session bearer token**.
From the client bundle (**inferred**, we have not exercised the write path):

| Item | Value |
|---|---|
| `POST /v1/community/auth/challenge` | Starts a wallet-signature login; `auth: none` (or `required` when re-authorising). Body schema not captured. |
| `POST /v1/community/auth/verify` | Body is the signed challenge; returns `{ token, expiresAt }`. |
| `POST /v1/community/auth/logout` | Requires the token. |
| `GET /v1/community/me` | Requires the token. |
| Token format | 43-char base64url (`^[A-Za-z0-9_-]{43}$`) + ISO `expiresAt`. |
| Storage | `localStorage` key `squeek.community.session`, JSON `{ token, expiresAt }`. |
| Transport | `Authorization: Bearer <token>`, `credentials: "omit"`. |
| Errors | `CommunityApiError` with `status`, `code`, `retryAfterSeconds` (read from the response), 20 s timeout. |

This is why [LAUNCH.md](LAUNCH.md) tells you to copy the token out of DevTools rather than
re-implement wallet login under time pressure.

### 2.6 Code track — project submission

Recovered from the official client; every path below was read out of the shipped bundle, not
guessed. Contracts are stated exactly as the client sends them.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/v1/community/code/projects/independent` | `{ name, integration, repoUrl, demoUrl? }` | `{ project, challenge \| null }` |
| `POST` | `/v1/community/code/projects/:id/challenge` | — | `{ text, path, expiresAt }` |
| `POST` | `/v1/community/code/projects/:id/verify` | — | `{ project, result }` |
| `POST` | `/v1/community/code/projects/imd` | `{ job, integration, name? }` | `{ project }` |
| `POST` | `/v1/community/code/preview/imd` | `{ job }` | preview object, see below |
| `GET` | `/v1/community/code/projects` | — | `{ projects: Project[] }` |
| `POST` | `/v1/community/code/projects/:id/refresh` | — | refresh from IMD |
| `PUT` | `/v1/community/code/projects/:id` | `{ name?, integration?, demoUrl? }` | `{ project }` |

Constraints, as enforced client-side (**inferred** to be server-side too):

| Field | Rule |
|---|---|
| `name` | trimmed, 1–120 chars |
| `integration` | trimmed, 20–1,000 chars — "How does this project use Squeekchain?" |
| `repoUrl` | must be `https`, ≤ 2048 chars, **public GitHub** only (`unsupported_repository_host`, `invalid_repository`) |
| `demoUrl` | optional, `https`, ≤ 2048 chars |
| `job` (IMD) | IMD job URL or id, minimum 8 chars |

`Project` (client-side shape, **inferred** from the client schemas):

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | Project id used in later calls. |
| `origin` | `imd` \| `independent` | Which track. |
| `externalId` | string | External (IMD) id, 1–512 chars. |
| `name` | string | 1–120. |
| `integration` | string | 20–1,000. |
| `demoUrl` / `repoUrl` | https URL \| null | |
| `imd` | object \| null | `{ jobId, projectId, versions, state, objective, paidBy, repoUrl, commit, pullRequestUrl, siteUrl, syncedAt }` |
| `attribution` | object | `{ kind: "wallet" \| "repository", status: "pending" \| "verified" \| "failed", address, repository, verifiedAt }` |
| `syncError` | string \| null | ≤ 300 chars. |
| `createdAt` / `updatedAt` | ISO string | |

`challenge` = `{ text: string (≤256), path: string (≤256), expiresAt: ISO }`. The UI copy for
the challenge step reads: *"Add this exact line to {path} on the default branch, then check the
verification. The project is saved while it waits."* The path is only known after the call
returns; UI strings elsewhere show `.squeekchain/verification.txt` as the example path, and we
treat that as an **example, not a contract** — always use `challenge.path`.

`result` after `POST …/verify` is one of `verified` / `not_found` / `mismatch` /
`claimed_elsewhere` (**observed** in the client). This is the single most important field in
the whole API: it is what awards "The Buildooooor" and, for the first 88 projects,
"Early Buildooooor".

Official copy worth quoting, because it sets expectations honestly
(*"Verification checks attribution, not quality; a verified project earns its badge."*):

- *"A public GitHub repository is required. Repository control is proven with a challenge file; it does not claim authorship."*
- Badge criteria for `code.project_submitted`: *"Either an IMD project paid from one of your verified wallets, or a GitHub repository you prove you control with a challenge file. Repositories are rechecked daily; removing the file revokes the badge."*

Error codes the client maps (**observed**), with the client's own wording:

| Code | Client message |
|---|---|
| `invalid_job_reference` | IMD job URL or id is not valid. |
| `imd_job_not_found` | IMD has no job with that id. |
| `imd_unavailable` | IMD could not be reached. Try again shortly. |
| `imd_invalid_response` | IMD returned an unexpected record. |
| `payer_mismatch` | That job was paid by a wallet that is not verified on your profile. |
| `payer_missing` | That job has no payer on record, so it cannot be linked. |
| `project_linked_elsewhere` | This project is already linked to another participant. |
| `unsupported_repository_host` | Repository verification supports public GitHub repositories. |
| `invalid_repository` | Enter a public GitHub repository URL. |
| `challenge_expired` | The challenge expired. Generate a new one. |
| `challenge_missing` | Generate a challenge first. |
| `challenge_not_found` | No challenge file was found at the expected path. |
| `challenge_mismatch` | The file does not contain the challenge line. |
| `repository_unavailable` | The repository could not be reached. Try again shortly. |
| `already_verified` | This repository is already verified. |
| `not_imd_project` | Only IMD projects can be refreshed. |
| `not_independent_project` | Only independent projects use repository verification. |
| `project_not_found` | This project does not exist on your profile. |
| `demo_managed_by_imd` | IMD imports the demo link; edit the IMD job instead. |
| `rate_limited` | Too many attempts. Wait a minute and try again. |

The client also enforces: *"Join Genesis to submit a project"* — a project belongs to a Genesis
profile, so wallet verification and X linking must be done first.

---

## 3. Sepolia contracts

Chain `11155111`. The economy API is the index; these contracts are the settlement layer. Our
audit reads them directly with `eth_call` — no API trust required.

### 3.1 Addresses

| Role | Address |
|---|---|
| SQK token (18 decimals) | `0x5501e1fa81be1c3f49225fa7668da0245d07db60` |
| Mining proxy | `0xcd46990f8349057335289ef282c276204b6cdc62` |
| Staking proxy | `0x4b67b739dfd832f4eac67a7aa3bc244fb74cea4f` |
| Gacha vault | `0x5f6ba50f448b84e09f5ee324a6402b033ba70e28` |
| Core | `0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44` |
| Genesis | `0xcb98349c134ab983da5bfd80527dfe2552bdb70f` |
| Launch | `0x1ff6485abfbb2d183cd673d78e1ab31c098e04dd` |
| Token factory | `0x779a302adbaa9c8a3da45ef48ad67e6a45fcef29` |

**No verified source.** These contracts return 404 on Sourcify, so there is no published ABI to
read. Everything below uses standard, obviously-correct read selectors — the same four bytes any
ERC-20 exposes. We deliberately do **not** invent selectors for protocol-specific functions.

### 3.2 Read selectors

| Call | Selector | Returns |
|---|---|---|
| `totalSupply()` | `0x18160ddd` | `uint256` |
| `name()` | `0x06fdde03` | `string` |
| `symbol()` | `0x95d89b41` | `string` |
| `decimals()` | `0x313ce567` | `uint8` |
| `balanceOf(address)` | `0x70a08231` | `uint256` |

Write selectors used only for the optional "The Tester" badge flow
(see [LAUNCH.md](LAUNCH.md) §7):

| Call | Selector | Calldata |
|---|---|---|
| `approve(address,uint256)` | `0x095ea7b3` | `0x095ea7b3` + 32-byte spender + 32-byte amount (big-endian) |

### 3.3 Reproduce with `curl`

```bash
RPC=https://ethereum-sepolia-rpc.publicnode.com
TOKEN=0x5501e1fa81be1c3f49225fa7668da0245d07db60

# totalSupply()
curl -sS "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"'"$TOKEN"'","data":"0x18160ddd"},"latest"]}'
# -> {"jsonrpc":"2.0","id":1,"result":"0x6ab4..."}  (hex uint256, 18 decimals)
```

### 3.4 Reproduce with PowerShell

```powershell
$rpc   = 'https://ethereum-sepolia-rpc.publicnode.com'
$token = '0x5501e1fa81be1c3f49225fa7668da0245d07db60'
$body  = @{
  jsonrpc = '2.0'; id = 1; method = 'eth_call'
  params  = @(@{ to = $token; data = '0x18160ddd' }, 'latest')
} | ConvertTo-Json -Depth 4

$hex = (Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body $body).result
[System.Numerics.BigInteger]::Parse($hex.Substring(2), 'AllowHexSpecifier') / [math]::Pow(10, 18)
```

Expected result at snapshot time: `totalSupply = 8066546793063427114304839` base units
(`8,066,546.793063427 + 1e-18 SQK`) — exactly `economy.supply.liveSupplyBaseUnits`. That
agreement is the `chain-sqk-supply` invariant.

Also check:

| Call | Expected |
|---|---|
| `symbol()` on the token | `SQK` (per `economy.asset.symbol`) |
| `decimals()` | `18` |
| `balanceOf(gachaVault)` | ≤ `mining.gachaFundedBaseUnits` (the vault can never hold more than was funded) |
| `eth_getCode` on all eight addresses | non-empty (`0x`) for deployed contracts |

Squeekwatch runs these on every `audit` unless you pass `--no-chain` (or `--offline`, which reads
`fixtures/` and skips RPC entirely). The JSON-RPC endpoint defaults to
`https://ethereum-sepolia-rpc.publicnode.com` and falls back to public alternatives.

---

## 4. What we could not verify

Honest list. Each item is a real gap, not a disclaimer.

**Submission flow**

- The concrete `challenge.path` and `challenge.text` are only issued after a project is
  created; we have never completed a submission because the code track has `projectsVerified:
  0` and is not open. The `.squeekchain/verification.txt` path in the UI copy is an example.
- Whether `verify` inspects repository *contents* (beyond the challenge line), the default
  branch only, or a specific commit. The UI says "on the default branch"; nothing more.
- Whether a repository that previously held a challenge for another account can be
  re-verified (`claimed_elsewhere` hints it cannot).
- The per-account limit on projects, and whether projects can be deleted or renamed after
  verification.
- Whether `challenge` expires in minutes or hours (only `expiresAt` is returned).

**Aura**

- The aura **weights** are not public. We report observed values only: `totalAura` 158,223,
  leaderboard range 698–2,939, all top-100 entries `gold`. No formula, no tie-break rule.
- Tier thresholds (`gold`/`silver`/`bronze`/`member`) are unknown; only `gold` was observed.

**Sepolia / contracts**

- No verified source (Sourcify 404), so no protocol-specific ABI. Only standard selectors are
  used. `totalSupply()` was not itself captured on-chain in our snapshot — the identity in §3.4
  is the expected value, verified by the audit on a live run.
- Whether `name()` returns `Squeek` — **we have not captured the string**; only `symbol`/`decimals`
  are compared by the audit.

**Telemetry**

- The relation between `workPerThousandBlocks` and `cumulativeWork / blockHeight` (§1.1): the
  numbers disagree by ~3 %, so we treat it as an unexplained curve parameter.
- Other values of `settlementQueue.state` and `measurement.freshness` besides the ones above.
- Where `stepUnits` would live: it does **not** exist in `/v1/status`. If a future schema adds
  it, our client passes unknown fields through untouched.
- Retry behaviour and rate limits on the read endpoints (we have only ever been served 200s).
