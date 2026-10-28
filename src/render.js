/**
 * Human-facing renderers. Every function takes plain data and returns a string, so the
 * output can be snapshot-tested without spawning a process.
 */
import { CHAIN, DEFAULT_ADDRESSES } from './contracts.js';
import { ago, bar, color, duration, padEnd, padStart, percent, token, truncate } from './format.js';
import { normaliseRepo, readPackageJson } from './identity.js';

const SEVERITY = {
  ok: { mark: '+', tone: 'green' },
  warn: { mark: '!', tone: 'yellow' },
  fail: { mark: 'x', tone: 'red' },
  skip: { mark: '-', tone: 'dim' },
};

export const VERDICT_TONE = { VERIFIED: 'green', DEGRADED: 'yellow', FAILED: 'red' };

/** @typedef {{ version: string, colorize?: boolean, width?: number }} RenderOpts */

/**
 * @param {RenderOpts} opts
 * @returns {(s: unknown, tone?: string) => string}
 */
function painter(opts) {
  return (s, tone = 'reset') => color(s, tone, opts.colorize ?? true);
}

function ruleLine(width, opts) {
  return color('-'.repeat(width), 'dim', opts.colorize ?? true);
}

function section(name, opts) {
  return color(name, 'orange', opts.colorize ?? true);
}

function row(labelText, value, opts) {
  return `${color(padEnd(labelText, 12), 'dim', opts.colorize ?? true)}${value}`;
}

function dot(healthy, opts) {
  return color(healthy ? '\u25cf' : '\u25cb', healthy ? 'green' : 'dim', opts.colorize ?? true);
}

function when(iso) {
  if (!iso) return 'unknown';
  const t = new Date(iso);
  return Number.isFinite(t.getTime()) ? t.toISOString().replace('.000Z', 'Z') : 'unknown';
}

function initial(opts) {
  return `${color('Squeekwatch', 'cream', opts.colorize ?? true)} ${color(`v${opts.version}`, 'dim', opts.colorize ?? true)}  ${color(when(opts.generatedAt), 'dim', opts.colorize ?? true)}`;
}

/** Seconds since the hardware counter document was sampled, using the document's own clock. */
export function counterAgeSeconds(snapshot, now = Date.now()) {
  const observed = snapshot?.status?.measurement?.observedAt;
  if (!observed) return null;
  const reference = snapshot?.fixturesTimestamp ? new Date(snapshot.fixturesTimestamp).getTime() : now;
  return Math.max(0, Math.round((reference - new Date(observed).getTime()) / 1000));
}

/** One-line summary used by `watch` and by the dashboard footer. */
export function summaryLine(snapshot, audit, opts = {}) {
  const c = painter(opts);
  const m = snapshot?.status?.measurement ?? {};
  const anchor = snapshot?.status?.builder?.anchor ?? {};
  const processed = snapshot?.economy?.mining?.processedThroughRound ?? '?';
  const current = snapshot?.economy?.lifecycle?.currentRound ?? '?';
  const chain = snapshot?.chain ?? null;
  const anchorHeight = Number(anchor.blockHeight);
  const lag = chain && Number.isFinite(anchorHeight) ? Number(chain.headNumber) - anchorHeight : null;
  const stamp = when(snapshot?.generatedAt).slice(11, 19);
  const age = counterAgeSeconds(snapshot);
  const spinning = m.coreStatus === 'SPINNING';
  return [
    c(stamp, 'dim'),
    c(spinning ? 'WHEEL' : String(m.coreStatus ?? '?'), spinning ? 'green' : 'cyan'),
    c(`rpm ${Number(m.rpmMilli ?? 0) / 1000}`, 'dim'),
    c(`round ${processed}/${current}`, 'cream'),
    chain ? c(`chain ${chain.headNumber}${lag === null ? '' : ` (${lag > 0 ? '+' : ''}${lag})`}`, lag === null ? 'dim' : lag > 10 ? 'yellow' : 'green') : c('chain --', 'dim'),
    audit ? c(`audit ${audit.verdict}`, VERDICT_TONE[audit.verdict] ?? 'dim') : c('audit --', 'dim'),
    audit ? c(`${audit.score}/100`, 'dim') : '',
    age === null ? '' : c(`t${age}s`, age > 120 ? 'yellow' : 'dim'),
  ]
    .filter(Boolean)
    .join(c('  |  ', 'dim'));
}

/** Full `status` panel. */
export function renderStatus(snapshot, audit, opts) {
  const c = painter(opts);
  const width = opts.width ?? 78;
  const lines = [];
  const m = snapshot?.status?.measurement ?? {};
  const anchor = snapshot?.status?.builder?.anchor ?? {};
  const projection = snapshot?.status?.builder?.projected ?? {};
  const queue = snapshot?.status?.settlementQueue ?? {};
  const submission = queue.latestSubmission ?? null;
  const economy = snapshot?.economy ?? {};
  const lifecycle = economy.lifecycle ?? {};
  const supply = economy.supply ?? {};
  const nft = economy.nft ?? {};
  const staking = economy.staking ?? {};
  const chain = snapshot?.chain ?? null;
  const spinning = m.coreStatus === 'SPINNING';

  opts = { ...opts, generatedAt: snapshot?.generatedAt };
  lines.push(initial(opts));
  lines.push(ruleLine(width, opts));

  lines.push(section('HARDWARE', opts));
  lines.push(
    row('', `${dot(spinning, opts)} ${c(m.coreStatus ?? 'unknown', spinning ? 'green' : 'cyan')}  ${c('provenance', 'dim')} ${c(m.provenance ?? '?', 'cream')}  ${c('freshness', 'dim')} ${c(m.freshness ?? '?', 'cream')}  ${c('epoch', 'dim')} ${truncate(m.counterEpoch ?? '?', 12)}`, opts),
  );
  lines.push(
    row(
      'wheel',
      `${c('rpm', 'dim')} ${padStart(String(Number(m.rpmMilli ?? 0) / 1000), 7)}  ${c('speed', 'dim')} ${padStart(`${m.speedMmPerSecond ?? 0} mm/s`, 9)}  ${c('distance', 'dim')} ${m.distanceMm ?? 0} mm`,
      opts,
    ),
  );
  lines.push(
    row(
      'counter',
      `${c('work', 'dim')} ${padStart(String(m.cumulativeWorkUnits ?? 0), 8)}  ${c('work/1k blocks', 'dim')} ${anchor.workPerThousandBlocks ?? '?'}  ${c('sampled', 'dim')} ${ago(m.observedAt, snapshot?.fixturesTimestamp ? Date.parse(snapshot.fixturesTimestamp) : Date.now())}  ${c('doc age', 'dim')} ${counterAgeSeconds(snapshot)}s`,
      opts,
    ),
  );

  lines.push(section('CHAIN', opts));
  lines.push(
    row(
      '',
      `${dot(Boolean(chain), opts)} ${c(chain ? 'SEPOLIA' : 'unreached', chain ? 'green' : 'yellow')}  ${c('chainId', 'dim')} ${c(economy.chain?.chainId ?? CHAIN.chainId, 'cream')}  ${c('head', 'dim')} ${chain ? c(chain.headNumber, 'cream') : '?'}  ${c('gas', 'dim')} ${chain?.gasPriceWei ? `${Number(BigInt(chain.gasPriceWei)) / 1e9} gwei` : '?'}  ${c('block time', 'dim')} ${chain?.headTimestamp ? when(chain.headTimestamp).slice(11, 19) : '?'}`,
      opts,
    ),
  );
  const anchorHeight = Number(anchor.blockHeight);
  const chainLag = chain && Number.isFinite(anchorHeight) ? Number(chain.headNumber) - anchorHeight : null;
  lines.push(
    row(
      'anchor',
      `${c('block', 'dim')} ${c(anchorHeight || '?', 'cream')}  ${c('lag', 'dim')} ${chainLag === null ? '?' : `${chainLag} blocks`}  ${c('settled round', 'dim')} ${anchor.settledThroughRound ?? '?'}  ${c('confirmed', 'dim')} ${anchor.confirmedAt ? when(anchor.confirmedAt).slice(11, 19) : '?'}  ${c('tx', 'dim')} ${truncate(anchor.transactionHash ?? '?', 14)}`,
      opts,
    ),
  );
  lines.push(
    row(
      'sqk',
      `${c('supply', 'dim')} ${c(token(chain?.sqkTotalSupply ?? supply.totalMintedBaseUnits, { symbol: '' }), 'cream')}  ${c('symbol', 'dim')} ${chain?.sqkSymbol ?? economy.asset?.symbol ?? 'SQK'}  ${c('decimals', 'dim')} ${chain?.sqkDecimals ?? economy.asset?.decimals ?? '?'}  ${c('emitted of cap', 'dim')} ${percent(supply.totalMintedBaseUnits ?? 0, supply.capBaseUnits ?? 1, 3)}`,
      opts,
    ),
  );
  lines.push(
    row(
      'contracts',
      `${c('core', 'dim')} ${truncate(DEFAULT_ADDRESSES.core, 12)}  ${c('mining', 'dim')} ${truncate(DEFAULT_ADDRESSES.miningProxy, 12)}  ${c('staking', 'dim')} ${truncate(DEFAULT_ADDRESSES.stakingProxy, 12)}`,
      opts,
    ),
  );

  lines.push(section('MINING', opts));
  lines.push(
    row(
      '',
      `${c('round', 'dim')} ${c(`${economy.mining?.processedThroughRound ?? '?'} / ${lifecycle.currentRound ?? '?'}`, 'cream')}  ${c('started', 'dim')} ${lifecycle.startRound ?? '?'}  ${c('funded blocks', 'dim')} ${economy.mining?.fundedBlocks ?? projection.blockHeight ?? '?'}  ${c('curve floor', 'dim')} ${percent(economy.mining?.curve?.floorBps ?? 0, 10000, 0)}  ${c('target power', 'dim')} ${token(economy.mining?.curve?.targetPower)}`,
      opts,
    ),
  );
  lines.push(
    row(
      'gacha',
      `${c('vault', 'dim')} ${token(chain?.gachaBalance ?? economy.mining?.gachaFundedBaseUnits)}  ${c('funded', 'dim')} ${token(economy.mining?.gachaFundedBaseUnits)}  ${c('solvency', 'dim')} ${percent(chain?.gachaBalance ?? economy.mining?.gachaFundedBaseUnits ?? 0, economy.mining?.gachaFundedBaseUnits ?? 1, 3)}`,
      opts,
    ),
  );

  lines.push(section('SETTLEMENT', opts));
  if (submission) {
    const state = queue.state ?? submission.lifecycle ?? 'unknown';
    const good = state === 'confirmed' || state === 'submitted';
    lines.push(
      row(
        'queue',
        `${dot(good, opts)} ${c(state, good ? 'green' : 'yellow')}  ${c('id', 'dim')} ${truncate(submission.submissionId ?? '?', 8)}  ${c('moves', 'dim')} ${submission.previousSettledThroughRound ?? '?'} \u2192 ${submission.settledThroughRound ?? '?'}  ${c('submitted', 'dim')} ${ago(submission.submittedAt)}  ${c('confirmed', 'dim')} ${submission.confirmedAt ? when(submission.confirmedAt).slice(11, 19) : 'pending'}`,
        opts,
      ),
    );
    lines.push(
      row(
        'tx',
        `${c('hash', 'dim')} ${truncate(submission.transactionHash ?? submission.hash ?? '?', 20)}  ${c('chain link', 'dim')} ${chain?.settlement ? (chain.settlement.found ? c('found on Sepolia', 'green') : c('not yet visible', 'yellow')) : 'not checked'}`,
        opts,
      ),
    );
  } else {
    lines.push(row('queue', c('no submission in flight', 'dim'), opts));
  }

  lines.push(section('NFT', opts));
  lines.push(
    row(
      '',
      `${c('issued', 'dim')} ${nft.issued ?? '?'}  ${c('live', 'dim')} ${nft.live ?? '?'}  ${c('burned', 'dim')} ${nft.burned ?? '?'}  ${c('max level', 'dim')} ${nft.maximumLevel ?? '?'}  ${c('merges', 'dim')} ${nft.mergesOpen ? c('open', 'green') : 'closed'}`,
      opts,
    ),
  );
  lines.push(row('ladder', powerLadder(nft, opts), opts));

  lines.push(section('STAKING', opts));
  lines.push(
    row(
      '',
      `${c('staked', 'dim')} ${token(staking.totalStakedBaseUnits)}  ${c('funded', 'dim')} ${token(staking.rewards?.fundedBaseUnits)}  ${c('paid', 'dim')} ${token(staking.rewards?.paidBaseUnits)}  ${c('remaining', 'dim')} ${token(staking.rewards?.remainingBaseUnits)}`,
      opts,
    ),
  );
  lines.push(
    row(
      'power',
      `${c('nft', 'dim')} ${token(staking.totalNftPower, { digits: 1 })}  ${c('sqk', 'dim')} ${token(staking.totalSqkPower, { digits: 1 })}  ${c('sqk/power', 'dim')} ${token(staking.sqkPerPower, { digits: 0 })}  ${c('reference', 'dim')} ${token(staking.referencePower, { digits: 0 })}`,
      opts,
    ),
  );

  lines.push(section('VERDICT', opts));
  const verdictTone = audit ? VERDICT_TONE[audit.verdict] ?? 'dim' : 'dim';
  lines.push(
    row(
      '',
      `${dot(audit?.verdict === 'VERIFIED', opts)} ${c(audit?.verdict ?? 'UNKNOWN', verdictTone)}  ${c(bar(audit?.score ?? 0, 100, 14), verdictTone)}  ${c(`${audit?.score ?? '--'}/100`, 'dim')}`,
      opts,
    ),
  );
  if (audit) {
    lines.push(
      row(
        'checks',
        `${c(String(audit.pass), 'green')} ok  ${c(String(audit.warn), 'yellow')} warn  ${c(String(audit.fail), 'red')} fail  ${c(String(audit.skipped), 'dim')} skipped`,
        opts,
      ),
    );
    const firstProblem = audit.findings.find((f) => f.severity === 'fail' || f.severity === 'warn');
    if (firstProblem) lines.push(row('attention', truncate(`${firstProblem.id}: ${firstProblem.detail}`, width - 12), opts));
  }

  lines.push(section('SOURCES', opts));
  lines.push(
    row(
      '',
      `${color(snapshot?.source === 'fixtures' ? 'offline fixtures' : 'live', snapshot?.source === 'fixtures' ? 'yellow' : 'green', opts.colorize ?? true)}  ${c('api', 'dim')} ${truncate(snapshot?.sources?.api ?? 'api.squeekchain.com', 30)}  ${c('community', 'dim')} ${truncate(snapshot?.sources?.community ?? 'community.squeekchain.com', 24)}`,
      opts,
    ),
  );
  if (chain?.rpcUrl) lines.push(row('rpc', `${truncate(chain.rpcUrl, 56)}  ${c('probes', 'dim')} ${chain.probes.length}`, opts));
  if (snapshot?.status?.installationId) {
    lines.push(
      row('installation', `${truncate(snapshot.status.installationId, 46)}  ${c('release', 'dim')} ${truncate(economy.release?.id ?? '?', 34)}`, opts),
    );
  }
  return lines.join('\n');
}

function powerLadder(nft, opts) {
  const c = painter(opts);
  const powers = (nft.basePower ?? []).map((p) => Number(p));
  if (!powers.length) return c('n/a', 'dim');
  const steps = powers.slice(1).map((p, i) => (powers[i] > 0 ? `${Math.round((p / powers[i]) * 100)}%` : '?'));
  return `${c(`L1..L${powers.length}`, 'dim')} ${powers.map((p) => (p >= 1000 ? `${(p / 1000).toFixed(1)}k` : String(p))).join(' / ')}  ${c('per-level', 'dim')} ${steps.slice(0, 5).join(' ')}\u2026`;
}

/** Compact one-line-per-check audit report. */
export function renderAudit(audit, opts = {}) {
  const c = painter(opts);
  const lines = [];
  lines.push(`${section('INVARIANT AUDIT', opts)}  ${c(audit.verdict, VERDICT_TONE[audit.verdict] ?? 'dim')}  ${c(`${audit.score}/100`, 'dim')}`);
  lines.push(ruleLine(78, opts));
  /** @type {string|null} */
  let group = null;
  for (const f of audit.findings) {
    if (f.source !== group) {
      group = f.source;
      lines.push(color(String(f.source).toUpperCase(), 'dim', opts.colorize ?? true));
    }
    const sev = SEVERITY[f.severity] ?? SEVERITY.skip;
    lines.push(`  ${c(sev.mark, sev.tone)} ${c(padEnd(f.id, 24), 'cream')} ${f.detail}`);
    if (opts.verbose) lines.push(`    ${c(f.title, 'dim')}`);
  }
  lines.push(ruleLine(78, opts));
  lines.push(
    `${c('checks', 'dim')} ${audit.findings.length}  ${c('ok', 'green')} ${audit.pass}  ${c('warn', 'yellow')} ${audit.warn}  ${c('fail', 'red')} ${audit.fail}  ${c('skipped', 'dim')} ${audit.skipped}`,
  );
  return lines.join('\n');
}

/** Readiness report card for `code.early_buildooooor`. */
export function renderBadge(badge, opts = {}) {
  const c = painter(opts);
  const lines = [];
  lines.push(`${section('BUILD LANE', opts)}  ${c('code.early_buildooooor', 'cream')} ${c('\u00b7 one of the first 88 verified projects', 'dim')}`);
  lines.push(ruleLine(78, opts));
  for (const check of badge.checks) {
    const sev = SEVERITY[check.level] ?? SEVERITY.skip;
    lines.push(`  ${c(sev.mark, sev.tone)} ${c(padEnd(check.label, 32), 'cream')} ${check.detail}`);
  }
  lines.push(ruleLine(78, opts));
  lines.push(`${c('next', 'dim')} ${badge.next}`);
  if (badge.blockers.length) {
    lines.push(ruleLine(78, opts));
    for (const blocker of badge.blockers) lines.push(`  ${c('open', 'yellow')} ${blocker}`);
  }
  return lines.join('\n');
}

/** Submission packet for the independent project lane. */
export function renderRace(snapshot, opts = {}) {
  const c = painter(opts);
  const meta = snapshot?.meta ?? {};
  const economy = snapshot?.economy ?? {};
  const payload = {
    name: meta.name ?? 'Squeekwatch',
    integration: meta.integration ?? '',
    repoUrl: meta.repoUrl ?? normaliseRepo(readPackageJson().repository) ?? '(set repoUrl in fixtures/meta.json)',
    ...(meta.demoUrl ? { demoUrl: meta.demoUrl } : {}),
  };
  const lines = [];
  lines.push(`${section('RACE PACKET', opts)}  ${c('independent project \u2192 POST /v1/community/code/projects/independent', 'cream')}`);
  lines.push(ruleLine(78, opts));
  lines.push(row('name', c(payload.name, 'cream'), opts));
  lines.push(row('repo', payload.repoUrl, opts));
  lines.push(row('demo', payload.demoUrl ?? c('(optional)', 'dim'), opts));
  lines.push(row('payload', truncate(JSON.stringify(payload), 66), opts));
  lines.push(ruleLine(78, opts));
  lines.push(`${c('evidence from the last snapshot', 'dim')}`);
  const evidence = [
    ['hardware counter', `${snapshot?.status?.measurement?.cumulativeWorkUnits ?? '?'} work units`],
    ['confirmed anchor', `block ${snapshot?.status?.builder?.anchor?.blockHeight ?? '?'}, round ${snapshot?.status?.builder?.anchor?.settledThroughRound ?? '?'}`],
    ['sqk minted', `${token(economy.supply?.totalMintedBaseUnits, { symbol: 'SQK' })} of ${token(economy.supply?.capBaseUnits, { symbol: 'SQK' })}`],
    ['squeeks live', `${economy.nft?.live ?? '?'} / ${economy.nft?.issued ?? '?'}`],
  ];
  for (const [label, value] of evidence) lines.push(`  ${c('evidence', 'dim')} ${padEnd(label, 20)} ${value}`);
  lines.push(ruleLine(78, opts));
  lines.push(`${c('order', 'dim')} commit \u2192 push \u2192 submit above \u2192 add challenge file \u2192 POST verify`);
  return lines.join('\n');
}

/** Static protocol notes. */
export function renderProtocol(opts = {}) {
  const c = painter(opts);
  return [
    `${section('PROTOCOL', opts)}  ${c('what the tool reads, and why it can be trusted', 'cream')}`,
    ruleLine(78, opts),
    `${c('doctrine', 'dim')}  never trust one source: every number is cross-checked against a second edge.`,
    '',
    `${c('1', 'dim')} read-only API      ${c('https://api.squeekchain.com', 'cream')}`,
    '          /v1/status          hardware counter, settlement queue, builder anchor',
    '          /v1/economy/state   supply, schedule, mining curve, staking, nft config',
    '',
    `${c('2', 'dim')} community API      ${c('https://community.squeekchain.com', 'cream')}`,
    '          /v1/community/stats \u00b7 /leaderboard \u00b7 /aura/badges \u00b7 /profiles/:code',
    '',
    `${c('3', 'dim')} chain              ${c('Ethereum Sepolia \u00b7 chainId 11155111', 'cream')}`,
    `          SQK token          ${DEFAULT_ADDRESSES.token}`,
    `          core               ${DEFAULT_ADDRESSES.core}`,
    `          mining proxy       ${DEFAULT_ADDRESSES.miningProxy}`,
    `          staking proxy      ${DEFAULT_ADDRESSES.stakingProxy}`,
    `          gacha vault        ${DEFAULT_ADDRESSES.gachaVault}`,
    '',
    `${c('4', 'dim')} writes             ${c('none: eth_call + eth_getCode only', 'cream')}`,
    '          no keys, no signing, no transactions. The official app keeps that power.',
    '',
    `${c('verdict', 'dim')}  17 API invariants (supply identity, burn conservation, NFT conservation and power`,
    '  monotonicity, round ordering, settlement linking, emission schedule, telemetry freshness,',
    '  coherence and provenance, installation consistency, staking conservation, lifecycle guard)',
    '  plus 7 Sepolia probes (SQK totalSupply/symbol/decimals, gacha solvency, deployed bytecode,',
    '  settlement tx existence, head freshness). A FAILED verdict means the public numbers',
    '  stopped describing one another.',
  ].join('\n');
}

/** @param {{files: Array<{name: string, bytes: number, fetchedAt: string|null}>, totalBytes: number, capturedAt: string|null}} report */
export function renderFixturesReport(report, opts = {}) {
  const c = painter(opts);
  const lines = [`${section('FIXTURES', opts)}  ${c('offline snapshot used by demos and CI', 'cream')}`, ruleLine(78, opts)];
  for (const entry of report.files) {
    lines.push(`  ${c(padEnd(entry.name, 18), 'cream')} ${padStart(String(entry.bytes), 7)} B  ${c(entry.fetchedAt ?? 'no timestamp', 'dim')}  ${c(ago(entry.fetchedAt), 'dim')}`);
  }
  lines.push(ruleLine(78, opts));
  lines.push(`  ${c('total', 'dim')} ${report.totalBytes} B  ${c('captured', 'dim')} ${report.capturedAt ?? 'unknown'}`);
  return lines.join('\n');
}

export function renderHelp(version, opts = {}) {
  const c = painter(opts);
  return [
    `${color('Squeekwatch', 'cream', opts.colorize ?? true)} ${c(`v${version}`, 'dim')} \u2014 independent instrumentation + audit for the Squeekchain economy`,
    '',
    `${section('USAGE', opts)}`,
    '  squeekwatch [command] [flags]',
    '',
    `${section('COMMANDS', opts)}`,
    '  status               one-shot snapshot + verdict (default)',
    '  watch                live board; --interval seconds, --once, --json (NDJSON)',
    '  audit                invariant audit; --verbose shows each rule title',
    '  badge                build-lane readiness for the Genesis code badge; --out <file>',
    '  race                 submission packet for the independent project lane',
    '  serve                HTTP dashboard + JSON API (default port 8787)',
    '  protocol             how the data is sourced and cross-checked',
    '  fixtures             age/integrity of the offline snapshot',
    '  mcp                  run the Model Context Protocol server on stdio',
    '',
    `${section('FLAGS', opts)}`,
    '  --json               machine-readable output',
    '  --offline            use fixtures/ only',
    '  --no-chain           skip Sepolia RPC probes',
    '  --no-color           plain text (also honours NO_COLOR)',
    '  --rpc <url>          override the Sepolia RPC endpoint',
    '  --timeout <ms>       per-request timeout (default 4000)',
    '  --interval <s>       watch refresh interval (default 10)',
    '  --once               watch renders one frame and exits',
    '  --port <n>           serve port (default 8787, also honours PORT)',
    '  --out <file>         write badge report to a file',
    '  -h, --help           this text',
    '  -v, --version        version',
    '',
    `${section('EXIT CODES', opts)}`,
    '  0 verified   1 degraded   2 failed   3 usage error',
    '',
    `${section('EXAMPLES', opts)}`,
    '  squeekwatch status --offline           audit the bundled snapshot',
    '  squeekwatch watch --interval 5         follow the wheel live',
    '  squeekwatch audit --json > report.json',
  ].join('\n');
}
