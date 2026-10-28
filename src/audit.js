// @ts-check
/**
 * The invariant engine.
 *
 * Squeekchain publishes its economy through a JSON API and settles it on Ethereum Sepolia.
 * Nothing forces those two stories to agree, so Squeekwatch re-derives the arithmetic that
 * *must* hold (supply conservation, NFT conservation, round ordering, allowance budget),
 * compares the API's claims with on-chain reads, and reports every disagreement.
 *
 * Each check is independent: it receives the snapshot and returns a Finding, or `null`
 * when its evidence is missing (offline mode, RPC outage...).
 *
 * Severity policy:
 *   fail  -> an invariant is broken; the API's numbers cannot all be true.
 *   warn  -> the data is inconsistent with our model, stale, or unverifiable.
 *   ok    -> re-derived value matches the published value.
 */

import { baseUnits, compact, percent } from './format.js';

/**
 * @param {any} value
 * @param {bigint} [fallback]
 * @returns {bigint}
 */
function big(value, fallback = 0n) {
  try {
    if (value === null || value === undefined) return fallback;
    return BigInt(String(value));
  } catch {
    return fallback;
  }
}

/** @param {any} value @returns {number|null} */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} id
 * @param {'api'|'rpc'|'community'|'mixed'} source
 * @param {string} title
 * @returns {{id: string, source: 'api'|'rpc'|'community'|'mixed', title: string, run: (snapshot: any) => import('./types.js').Finding|null}}
 */
const check = (id, source, title, run) => ({ id, source, title, run });

/** @param {string} id @param {'api'|'rpc'|'community'|'mixed'} source @param {string} title @param {string} detail @param {Record<string, string>} [extra] @returns {import('./types.js').Finding} */
const ok = (id, source, title, detail, extra = {}) => ({ id, severity: 'ok', source, title, detail, ...extra });
/** @param {string} id @param {'api'|'rpc'|'community'|'mixed'} source @param {string} title @param {string} detail @param {Record<string, string>} [extra] @returns {import('./types.js').Finding} */
const warn = (id, source, title, detail, extra = {}) => ({ id, severity: 'warn', source, title, detail, ...extra });
/** @param {string} id @param {'api'|'rpc'|'community'|'mixed'} source @param {string} title @param {string} detail @param {Record<string, string>} [extra] @returns {import('./types.js').Finding} */
const fail = (id, source, title, detail, extra = {}) => ({ id, severity: 'fail', source, title, detail, ...extra });

/** Reference clock: fixtures are judged relative to when they were captured. */
function referenceNow(snapshot) {
  if (snapshot?.source === 'fixtures') {
    const ts = snapshot?.fixturesTimestamp ?? snapshot?.status?.generatedAt;
    const parsed = ts ? Date.parse(ts) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Date.parse(snapshot?.status?.generatedAt ?? '');
  const now = Date.now();
  // Guard against a wildly skewed local clock: never trust `generatedAt` beyond +-2 minutes.
  if (Number.isFinite(parsed) && Math.abs(now - parsed) > 120_000) return now;
  return now;
}

/** @param {any} snapshot */
const API_CHECKS = [
  check('supply-identity', 'api', 'Total minted equals premint + mining minted', (snap) => {
    const supply = snap?.economy?.supply;
    if (!supply) return null;
    const total = big(supply.totalMintedBaseUnits);
    const premint = big(supply.premintBaseUnits);
    const mined = big(supply.miningMintedBaseUnits);
    const expected = premint + mined;
    const detail = `premint ${premint.toString()} + mining ${compact(mined)} SQK = ${compact(expected)} SQK`;
    return total === expected
      ? ok('supply-identity', 'api', 'Total minted equals premint + mining minted', detail, {
          expected: expected.toString(),
          observed: total.toString(),
        })
      : fail('supply-identity', 'api', 'Total minted equals premint + mining minted', `${detail}; API says ${compact(total)} SQK`, {
          expected: expected.toString(),
          observed: total.toString(),
        });
  }),

  check('supply-burn', 'api', 'Live supply equals minted minus burned', (snap) => {
    const supply = snap?.economy?.supply;
    if (!supply) return null;
    const live = big(supply.liveSupplyBaseUnits);
    const minted = big(supply.totalMintedBaseUnits);
    const burned = big(supply.totalBurnedBaseUnits);
    const expected = minted - burned;
    const detail = `minted ${compact(minted)} - burned ${compact(burned)} = ${compact(expected)} SQK`;
    return live === expected
      ? ok('supply-burn', 'api', 'Live supply equals minted minus burned', detail)
      : fail('supply-burn', 'api', 'Live supply equals minted minus burned', `${detail}; API says ${compact(live)} SQK`, {
          expected: expected.toString(),
          observed: live.toString(),
        });
  }),

  check('supply-capacity', 'api', 'Live supply plus unminted capacity equals the 2.1B cap', (snap) => {
    const supply = snap?.economy?.supply;
    if (!supply) return null;
    const live = big(supply.liveSupplyBaseUnits);
    const unminted = big(supply.unmintedCapacityBaseUnits);
    const cap = big(supply.capBaseUnits);
    const detail = `${compact(live)} live + ${compact(unminted)} unminted = ${compact(live + unminted)} of ${compact(cap)} SQK`;
    return live + unminted === cap
      ? ok('supply-capacity', 'api', 'Live supply plus unminted capacity equals the 2.1B cap', detail)
      : fail('supply-capacity', 'api', 'Live supply plus unminted capacity equals the 2.1B cap', `${detail} (short by ${compact(cap - live - unminted)} SQK)`);
  }),

  check('supply-within-cap', 'api', 'Minted supply never exceeds the cap', (snap) => {
    const supply = snap?.economy?.supply;
    if (!supply) return null;
    const minted = big(supply.totalMintedBaseUnits);
    const cap = big(supply.capBaseUnits);
    return minted <= cap
      ? ok('supply-within-cap', 'api', 'Minted supply never exceeds the cap', `${percent(minted.toString(), cap.toString(), 4)} of cap emitted`)
      : fail('supply-within-cap', 'api', 'Minted supply never exceeds the cap', `${compact(minted)} > cap ${compact(cap)} SQK`);
  }),

  check('allowance-identity', 'api', 'Issued supply plus unminted capacity equals the mining allowance', (snap) => {
    const supply = snap?.economy?.supply;
    const schedule = snap?.economy?.schedule;
    if (!supply || !schedule) return null;
    const issued = big(schedule.issuedBaseUnits);
    const unminted = big(supply.unmintedCapacityBaseUnits);
    const allowance = big(schedule.allowanceBaseUnits);
    const detail = `issued ${compact(issued)} + unminted ${compact(unminted)} = ${compact(issued + unminted)} SQK`;
    return issued + unminted === allowance
      ? ok('allowance-identity', 'api', 'Issued supply plus unminted capacity equals the mining allowance', `${detail} = allowance ${compact(allowance)} SQK`)
      : warn('allowance-identity', 'api', 'Issued supply plus unminted capacity equals the mining allowance', `${detail}; allowance ${compact(allowance)} SQK (delta ${compact(allowance - issued - unminted)})`);
  }),

  check('nft-identity', 'api', 'Squeeks NFTs are conserved (issued = live + burned)', (snap) => {
    const nft = snap?.economy?.nft;
    if (!nft) return null;
    const issued = big(nft.issued);
    const live = big(nft.live);
    const burned = big(nft.burned);
    const detail = `issued ${issued} = live ${live} + burned ${burned}`;
    return issued === live + burned && issued <= 9999n
      ? ok('nft-identity', 'api', 'Squeeks NFTs are conserved (issued = live + burned)', detail)
      : fail('nft-identity', 'api', 'Squeeks NFTs are conserved (issued = live + burned)', `${detail}; supply cap is 9999`);
  }),

  check('nft-config', 'api', 'NFT level tables match the declared maximum level', (snap) => {
    const nft = snap?.economy?.nft;
    if (!nft) return null;
    const level = num(nft.maximumLevel);
    const cooldowns = Array.isArray(nft.cooldownBlocks) ? nft.cooldownBlocks.length : 0;
    const powers = Array.isArray(nft.basePower) ? nft.basePower.length : 0;
    if (!level) return null;
    const detail = `maximumLevel ${level}, cooldownBlocks ${cooldowns} rows, basePower ${powers} rows`;
    return cooldowns === level && powers === level
      ? ok('nft-config', 'api', 'NFT level tables match the declared maximum level', detail)
      : fail('nft-config', 'api', 'NFT level tables match the declared maximum level', detail);
  }),

  check('nft-power-monotonic', 'api', 'NFT base power increases with level', (snap) => {
    const powers = snap?.economy?.nft?.basePower;
    if (!Array.isArray(powers) || powers.length < 2) return null;
    const values = powers.map((v) => big(v));
    const broken = values.findIndex((value, index) => index > 0 && value <= values[index - 1]);
    return broken === -1
      ? ok('nft-power-monotonic', 'api', 'NFT base power increases with level', `L1 ${values[0].toString()} -> L${values.length} ${values[values.length - 1].toString()} power units`)
      : fail('nft-power-monotonic', 'api', 'NFT base power increases with level', `level ${broken + 1} (${values[broken].toString()}) is not above level ${broken} (${values[broken - 1].toString()})`);
  }),

  check('mining-round-order', 'api', 'Mining rounds only move forward', (snap) => {
    const economy = snap?.economy;
    const status = snap?.status;
    if (!economy || !status) return null;
    const start = num(economy.lifecycle?.startRound);
    const processed = num(economy.mining?.processedThroughRound);
    const current = num(economy.lifecycle?.currentRound);
    const settled = num(status.builder?.anchor?.settledThroughRound);
    if ([start, processed, current, settled].some((v) => v === null)) return null;
    const detail = `start ${start}, processed ${processed}, current ${current}; confirmed anchor settled ${settled}`;
    // `status` and `economy` are fetched a moment apart, so the confirmed anchor may briefly
    // sit one round ahead of the economy snapshot. Anything larger than one round is a real break.
    const ordered = start <= processed && processed <= current && settled <= current && settled <= processed + 1;
    return ordered
      ? ok('mining-round-order', 'api', 'Mining rounds only move forward', detail)
      : fail('mining-round-order', 'api', 'Mining rounds only move forward', detail);
  }),

  check('settlement-linking', 'api', 'Settlement queue builds on the confirmed anchor', (snap) => {
    const queue = snap?.status?.settlementQueue;
    const anchorRound = snap?.status?.builder?.anchor?.settledThroughRound;
    if (!queue) return null;
    const submission = queue.latestSubmission;
    if (!submission) {
      return warn('settlement-linking', 'api', 'Settlement queue builds on the confirmed anchor', 'no settlement submission is visible in this snapshot');
    }
    const previous = num(submission.previousSettledThroughRound);
    const anchor = num(anchorRound);
    const settledTo = num(submission.settledThroughRound);
    const detail = `submission ${submission.submissionId?.slice(0, 8) ?? '?'} moves ${previous} -> ${settledTo}; anchor settled at ${anchor}`;
    if (previous !== null && anchor !== null && Math.abs(previous - anchor) > 1) {
      return warn('settlement-linking', 'api', 'Settlement queue builds on the confirmed anchor', `${detail}; submission does not extend the confirmed anchor`);
    }
    return ok('settlement-linking', 'api', 'Settlement queue builds on the confirmed anchor', `${detail}; lifecycle ${submission.lifecycle}, confirmedAt ${submission.confirmedAt ?? 'pending'}`);
  }),

  check('emission-schedule', 'api', 'Emission schedule stays inside the mining allowance', (snap) => {
    const schedule = snap?.economy?.schedule;
    const supply = snap?.economy?.supply;
    if (!schedule || !supply) return null;
    const issued = big(schedule.issuedBaseUnits);
    const allowance = big(schedule.allowanceBaseUnits);
    const closed = num(schedule.closedThroughBlock) ?? 0;
    const halving = num(schedule.halvingBlocks) ?? 0;
    const impliedRate = closed > 0 ? issued / BigInt(closed) : 0n;
    const detail = `issued ${compact(issued)} SQK over ${closed} blocks (implied ${baseUnits(impliedRate, 18, 4)} SQK/block); halving every ${halving} blocks`;
    return issued <= allowance
      ? ok('emission-schedule', 'api', 'Emission schedule stays inside the mining allowance', detail)
      : fail('emission-schedule', 'api', 'Emission schedule stays inside the mining allowance', `${detail}; allowance is only ${compact(allowance)} SQK`);
  }),

  check('telemetry-freshness', 'api', 'Hamster telemetry is fresh', (snap) => {
    const measurement = snap?.status?.measurement;
    if (!measurement?.observedAt) return null;
    const staleAfter = (num(measurement.staleAfterSeconds) ?? 120) * 1000;
    const observed = Date.parse(measurement.observedAt);
    const age = Math.max(0, referenceNow(snap) - observed);
    const detail = `observed ${Math.round(age / 1000)}s ago; stale after ${Math.round(staleAfter / 1000)}s`;
    if (!Number.isFinite(observed)) return null;
    if (age <= staleAfter) return ok('telemetry-freshness', 'api', 'Hamster telemetry is fresh', detail);
    if (age <= staleAfter * 2) return warn('telemetry-freshness', 'api', 'Hamster telemetry is stale', detail);
    return fail('telemetry-freshness', 'api', 'Hamster telemetry is stale', detail);
  }),

  check('telemetry-provenance', 'api', 'Telemetry is hardware-sourced and the wheel module is ready', (snap) => {
    const measurement = snap?.status?.measurement;
    if (!measurement) return null;
    const modules = Array.isArray(snap?.status?.modules) ? snap.status.modules : [];
    const wheel = modules.find((m) => String(m?.moduleType ?? '').includes('wheel')) ?? modules[0];
    const hardware = measurement.provenance === 'hardware';
    const moduleState = wheel?.state ?? 'unknown';
    const detail = `provenance ${measurement.provenance ?? 'unknown'}, core ${measurement.coreStatus ?? 'unknown'}, module ${wheel?.moduleType ?? 'none'} ${moduleState}`;
    return hardware && moduleState === 'ready'
      ? ok('telemetry-provenance', 'api', 'Telemetry is hardware-sourced and the wheel module is ready', detail)
      : warn('telemetry-provenance', 'api', 'Telemetry is hardware-sourced and the wheel module is ready', detail);
  }),

  check('telemetry-coherence', 'api', 'RPM, speed and distance are internally coherent', (snap) => {
    const measurement = snap?.status?.measurement;
    if (!measurement) return null;
    const rpm = num(measurement.rpmMilli);
    const speed = num(measurement.speedMmPerSecond);
    const distance = num(measurement.distanceMm);
    const work = big(measurement.cumulativeWorkUnits, -1n);
    if (rpm === null || speed === null || distance === null || work < 0n) return null;
    const stopped = rpm === 0;
    const speedZero = Math.abs(speed) < 0.001;
    const detail = `rpm ${(rpm / 1000).toFixed(3)}, speed ${speed} mm/s, distance ${distance} mm, work ${work.toString()}, epoch ${String(measurement.counterEpoch ?? '').slice(0, 8)}`;
    if (stopped !== speedZero) {
      return warn('telemetry-coherence', 'api', 'RPM, speed and distance are internally coherent', `${detail}; wheel stops and speed disagree`);
    }
    const anchorWork = big(snap?.status?.builder?.anchor?.cumulativeWork, -1n);
    if (anchorWork >= 0n && anchorWork !== work) {
      return warn('telemetry-coherence', 'api', 'RPM, speed and distance are internally coherent', `${detail}; builder anchor reports work ${anchorWork.toString()}`);
    }
    return ok('telemetry-coherence', 'api', 'RPM, speed and distance are internally coherent', detail);
  }),

  check('installation-consistency', 'api', 'Status and economy come from the same installation and release', (snap) => {
    const statusId = snap?.status?.installationId;
    const economyId = snap?.economy?.installationId;
    if (!statusId || !economyId) return null;
    const release = snap?.economy?.release ?? {};
    const detail = `installation ${statusId}; release ${release.id ?? 'unknown'} (${release.protocolRevision ?? '?'} / ${release.rewardModelRevision ?? '?'})`;
    return statusId === economyId
      ? ok('installation-consistency', 'api', 'Status and economy come from the same installation and release', detail)
      : fail('installation-consistency', 'api', 'Status and economy come from the same installation and release', `status ${statusId} vs economy ${economyId}`);
  }),

  check('staking-conservation', 'api', 'Staking rewards never pay out more than was funded', (snap) => {
    const staking = snap?.economy?.staking;
    if (!staking) return null;
    const funded = big(staking.rewards?.fundedBaseUnits);
    const paid = big(staking.rewards?.paidBaseUnits);
    const remaining = big(staking.rewards?.remainingBaseUnits);
    const staked = big(staking.totalStakedBaseUnits);
    const fresh = big(staking.freshPrincipalBaseUnits);
    const detail = `funded ${compact(funded)}, paid ${compact(paid)}, remaining ${compact(remaining)}, staked ${compact(staked)} SQK, fresh ${compact(fresh)}`;
    const rewardsOk = paid + remaining <= funded && paid <= funded;
    const principalOk = fresh <= staked;
    return rewardsOk && principalOk
      ? ok('staking-conservation', 'api', 'Staking rewards never pay out more than was funded', detail)
      : fail('staking-conservation', 'api', 'Staking rewards never pay out more than was funded', detail);
  }),

  check('lifecycle-guard', 'api', 'Lifecycle fields are populated and the guardian is set', (snap) => {
    const lifecycle = snap?.economy?.lifecycle;
    if (!lifecycle) return null;
    const hasGuardian = /^0x[0-9a-fA-F]{40}$/.test(String(lifecycle.guardian ?? ''));
    const stage = String(lifecycle.stage ?? 'unknown');
    const detail = `stage ${stage}, paused ${Boolean(lifecycle.paused)}, guardian ${lifecycle.guardian ?? 'none'}`;
    return hasGuardian ? ok('lifecycle-guard', 'api', 'Lifecycle fields are populated and the guardian is set', detail) : warn('lifecycle-guard', 'api', 'Lifecycle fields are populated and the guardian is set', detail);
  }),
];

/** @param {any} snapshot */
const CHAIN_CHECKS = [
  check('chain-head-lag', 'rpc', 'API index tracks the Sepolia head within a sane lag', (snap) => {
    const chain = snap?.chain;
    const indexed = num(snap?.economy?.chain?.indexedThroughBlock);
    const safe = num(snap?.economy?.chain?.safeThroughBlock);
    if (!chain || indexed === null) return null;
    const lag = chain.headNumber - indexed;
    const detail = `head ${chain.headNumber}, API indexed ${indexed}, lag ${lag} blocks; safe ${safe ?? 'n/a'}`;
    if (lag < 0) return fail('chain-head-lag', 'rpc', 'API index tracks the Sepolia head within a sane lag', `${detail}; API claims blocks that do not exist yet`);
    if (lag > 900) return warn('chain-head-lag', 'rpc', 'API index tracks the Sepolia head within a sane lag', `${detail}; indexer is more than 900 blocks behind`);
    if (safe !== null && safe > indexed) return warn('chain-head-lag', 'rpc', 'API index tracks the Sepolia head within a sane lag', `${detail}; safe block is ahead of the index`);
    return ok('chain-head-lag', 'rpc', 'API index tracks the Sepolia head within a sane lag', detail);
  }),

  check('chain-sqk-supply', 'rpc', 'On-chain SQK totalSupply equals the API minted supply', (snap) => {
    const probe = snap?.chain?.probes?.find((p) => p.id === 'sqk-totalSupply');
    if (!probe || !probe.decoded) return null;
    const onchain = big(probe.decoded);
    const api = big(snap?.economy?.supply?.totalMintedBaseUnits);
    const detail = `ERC-20 totalSupply ${compact(onchain)} SQK vs API minted ${compact(api)} SQK (${probe.address.slice(0, 10)}...)`;
    return onchain === api
      ? ok('chain-sqk-supply', 'rpc', 'On-chain SQK totalSupply equals the API minted supply', detail, { expected: api.toString(), observed: onchain.toString() })
      : fail('chain-sqk-supply', 'rpc', 'On-chain SQK totalSupply equals the API minted supply', `${detail}; delta ${compact(onchain - api)} SQK`, { expected: api.toString(), observed: onchain.toString() });
  }),

  check('chain-sqk-metadata', 'rpc', 'SQK token metadata matches the published asset', (snap) => {
    const symbol = snap?.chain?.probes?.find((p) => p.id === 'sqk-symbol')?.decoded;
    const decimals = snap?.chain?.probes?.find((p) => p.id === 'sqk-decimals')?.decoded;
    const asset = snap?.economy?.asset;
    if (!symbol || !decimals || !asset) return null;
    const detail = `symbol ${symbol}, decimals ${decimals} vs API ${asset.symbol}/${asset.decimals}`;
    return symbol === asset.symbol && Number(decimals) === Number(asset.decimals)
      ? ok('chain-sqk-metadata', 'rpc', 'SQK token metadata matches the published asset', detail)
      : fail('chain-sqk-metadata', 'rpc', 'SQK token metadata matches the published asset', detail);
  }),

  check('chain-deployment', 'rpc', 'Published contract addresses are deployed on Sepolia', (snap) => {
    const codes = (snap?.chain?.probes ?? []).filter((p) => p.call === 'getCode');
    if (!codes.length) return null;
    const zero = codes.filter((p) => !p.error && (p.decoded === '0 bytes' || p.decoded === '0'));
    const detail = codes.map((p) => `${p.id} ${p.decoded ?? p.error ?? '?'}`).join(', ');
    return zero.length === 0
      ? ok('chain-deployment', 'rpc', 'Published contract addresses are deployed on Sepolia', detail)
      : fail('chain-deployment', 'rpc', 'Published contract addresses are deployed on Sepolia', detail);
  }),

  check('chain-settlement-tx', 'rpc', 'The latest settlement transaction really exists on-chain', (snap) => {
    const settlement = snap?.chain?.settlement;
    if (!settlement) return null;
    const title = 'The latest settlement transaction really exists on-chain';
    const detail = `${settlement.hash.slice(0, 14)}... found=${settlement.found} to=${settlement.to?.slice(0, 10) ?? '?'} status=${settlement.status ?? '?'} block=${settlement.blockNumber ?? '?'}`;
    if (!settlement.found) return warn('chain-settlement-tx', 'rpc', title, `${detail}; not yet visible to this RPC`);
    if (settlement.status === '0x0') return fail('chain-settlement-tx', 'rpc', title, `${detail}; transaction reverted`);
    const to = String(settlement.to ?? '').toLowerCase();
    const core = String(snap?.economy?.identities?.core ?? '').toLowerCase();
    const miningProxy = String(snap?.economy?.identities?.mining?.proxy ?? '').toLowerCase();
    const known = to === core || to === miningProxy || settlement.callsMining === true;
    return known ? ok('chain-settlement-tx', 'rpc', title, detail) : warn('chain-settlement-tx', 'rpc', title, `${detail}; targets no known Squeekchain contract`);
  }),

  check('chain-gacha-solvency', 'rpc', 'Gacha vault balance never exceeds its reported funding', (snap) => {
    const probe = snap?.chain?.probes?.find((p) => p.id === 'gacha-sqk-balance');
    const funded = snap?.economy?.mining?.gachaFundedBaseUnits;
    if (!probe?.decoded || !funded) return null;
    const balance = big(probe.decoded);
    const fundedBig = big(funded);
    const detail = `vault holds ${compact(balance)} SQK; funded so far ${compact(fundedBig)} SQK`;
    return balance <= fundedBig
      ? ok('chain-gacha-solvency', 'rpc', 'Gacha vault balance never exceeds its reported funding', detail)
      : warn('chain-gacha-solvency', 'rpc', 'Gacha vault balance never exceeds its reported funding', `${detail}; vault holds more than the API admits`);
  }),

  check('chain-head-freshness', 'rpc', 'Sepolia head block is recent', (snap) => {
    const chain = snap?.chain;
    if (!chain?.headTimestamp) return null;
    const age = Math.max(0, referenceNow(snap) - Date.parse(chain.headTimestamp));
    const detail = `head block ${chain.headNumber} is ${Math.round(age / 1000)}s old via ${chain.rpcUrl.replace(/^https?:\/\//, '')}`;
    return age <= 300_000
      ? ok('chain-head-freshness', 'rpc', 'Sepolia head block is recent', detail)
      : warn('chain-head-freshness', 'rpc', 'Sepolia head block is recent', detail);
  }),
];

export const INVARIANTS = [...API_CHECKS, ...CHAIN_CHECKS];

/**
 * Run every check against a snapshot.
 * @param {import('./types.js').Snapshot} snapshot
 * @returns {import('./types.js').AuditResult}
 */
export function auditSnapshot(snapshot) {
  /** @type {import('./types.js').Finding[]} */
  const findings = [];
  let skipped = 0;
  for (const invariant of INVARIANTS) {
    let result = null;
    try {
      result = invariant.run(snapshot);
    } catch (err) {
      result = warn(invariant.id, invariant.source, invariant.title, `check crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result) findings.push(result);
    else skipped += 1;
  }

  const pass = findings.filter((f) => f.severity === 'ok').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const failCount = findings.filter((f) => f.severity === 'fail').length;
  const total = findings.length;
  const weighted = pass + warnCount * 0.5;
  const score = total === 0 ? 0 : Math.round((weighted / total) * 100);
  const verdict = failCount > 0 ? 'FAILED' : warnCount > 0 ? 'DEGRADED' : 'VERIFIED';

  return {
    generatedAt: new Date().toISOString(),
    verdict,
    pass,
    warn: warnCount,
    fail: failCount,
    skipped,
    total,
    score,
    findings,
    chain: snapshot?.chain ?? null,
  };
}

/** @param {import('./types.js').AuditResult} audit */
export function verdictLabel(audit) {
  return audit.verdict === 'VERIFIED' ? 'VERIFIED' : audit.verdict;
}
