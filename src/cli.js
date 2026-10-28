#!/usr/bin/env node
/**
 * Squeekwatch CLI.
 *
 *   squeekwatch [command] [flags]
 *
 * Contract: zero dependencies, no build step, every command works offline from fixtures/
 * and degrades gracefully when the network misbehaves. Exit codes: 0 verified,
 * 1 degraded, 2 failed, 3 usage.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchSnapshot } from './api.js';
import { auditSnapshot } from './audit.js';
import { color, rule, stripAnsi, supportsColor } from './format.js';
import { auditLane } from './lane.js';
import {
  renderAudit,
  renderBadge,
  renderFixturesReport,
  renderHelp,
  renderProtocol,
  renderRace,
  renderStatus,
  summaryLine,
} from './render.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @returns {{name: string, version: string, description: string}} */
function readPackage() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return { name: pkg.name ?? 'squeekwatch', version: pkg.version ?? '0.0.0', description: pkg.description ?? '' };
}

const USAGE = 3;

/**
 * @param {string[]} argv
 * @returns {{command: string, flags: Record<string, any>, rest: string[]}}
 */
export function parseArgs(argv) {
  const commands = new Set(['status', 'watch', 'audit', 'badge', 'race', 'serve', 'protocol', 'fixtures', 'mcp', 'help', 'version']);
  /** @type {Record<string, any>} */
  const flags = {
    json: false,
    offline: false,
    chain: true,
    community: true,
    color: true,
    verbose: false,
    once: false,
    quiet: false,
    rpc: null,
    timeoutMs: 4000,
    interval: 10,
    port: 8787,
    out: null,
  };
  /** @type {string[]} */
  const rest = [];
  let command = 'status';

  /** @param {number} index */
  const takeValue = (index, name) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) throw new UsageError(`--${name} needs a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        flags.json = true;
        break;
      case '--offline':
      case '--fixtures':
        flags.offline = true;
        flags.chain = false;
        break;
      case '--no-chain':
        flags.chain = false;
        break;
      case '--no-community':
        flags.community = false;
        break;
      case '--no-color':
        flags.color = false;
        break;
      case '--verbose':
        flags.verbose = true;
        break;
      case '--once':
        flags.once = true;
        break;
      case '--quiet':
        flags.quiet = true;
        break;
      case '--rpc':
        flags.rpc = takeValue(i, 'rpc');
        i += 1;
        break;
      case '--timeout':
      case '--timeout-ms': {
        const raw = takeValue(i, 'timeout');
        const ms = Number(raw);
        if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid timeout: ${raw}`);
        flags.timeoutMs = ms;
        i += 1;
        break;
      }
      case '--interval': {
        const raw = takeValue(i, 'interval');
        const seconds = Number(raw);
        if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`invalid interval: ${raw}`);
        flags.interval = seconds;
        i += 1;
        break;
      }
      case '--port': {
        const raw = takeValue(i, 'port');
        const port = Number(raw);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`invalid port: ${raw}`);
        flags.port = port;
        i += 1;
        break;
      }
      case '--out': {
        flags.out = takeValue(i, 'out');
        i += 1;
        break;
      }
      case '-h':
      case '--help':
        command = 'help';
        break;
      case '-v':
      case '--version':
        command = 'version';
        break;
      case '--':
        i += 1;
        while (i < argv.length) {
          rest.push(argv[i]);
          i += 1;
        }
        break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`unknown flag: ${arg}`);
        if (commands.has(arg)) command = arg;
        else rest.push(arg);
    }
  }
  return { command, flags, rest };
}

export class UsageError extends Error {}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${color('error', 'red')} ${message}\n`);
  process.stderr.write(`${color('hint', 'dim')} squeekwatch --help\n`);
  return USAGE;
}

/** @param {Record<string, any>} flags */
function renderOpts(flags) {
  const pkg = readPackage();
  return { version: pkg.version, colorize: flags.color && supportsColor, width: 78, verbose: flags.verbose };
}

/** @param {Record<string, any>} flags */
async function snapshot(flags) {
  return fetchSnapshot({
    chain: flags.chain && !flags.offline,
    community: flags.community !== false,
    offline: flags.offline,
    timeoutMs: flags.timeoutMs,
    rpcUrl: flags.rpc ?? undefined,
    fixturesDir: flags.fixturesDir ?? undefined,
    skipCache: true,
  });
}

/** @param {Record<string, any>} flags */
function readMeta() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** @param {import('./types.js').AuditResult} audit */
function exitCodeFor(audit) {
  return audit.verdict === 'VERIFIED' ? 0 : audit.verdict === 'DEGRADED' ? 1 : 2;
}

/** @param {any} value */
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function cmdStatus(flags) {
  const snap = await snapshot(flags);
  const audit = auditSnapshot(snap);
  if (flags.json) {
    printJson({ snapshot: snap, audit });
  } else {
    process.stdout.write(`${renderStatus(snap, audit, renderOpts(flags))}\n`);
  }
  return exitCodeFor(audit);
}

async function cmdAudit(flags) {
  const snap = await snapshot(flags);
  const audit = auditSnapshot(snap);
  if (flags.json) printJson(audit);
  else process.stdout.write(`${renderAudit(audit, renderOpts(flags))}\n`);
  return exitCodeFor(audit);
}

async function cmdBadge(flags) {
  const report = auditLane({ root: flags.root ?? ROOT });
  const body = flags.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderBadge(report, renderOpts(flags))}\n`;
  if (flags.out) {
    writeFileSync(flags.out, body, 'utf8');
    if (!flags.quiet) process.stdout.write(`${color('wrote', 'dim', flags.color)} ${flags.out} (${Buffer.byteLength(body)} bytes)\n`);
  } else {
    process.stdout.write(body);
  }
  return report.ready ? 0 : 2;
}

/** Serve the offline dashboard and JSON API. */
async function cmdServe(flags) {
  const { startServer } = await import('./server.js');
  const instance = await startServer({ port: flags.port, root: flags.root ?? ROOT });
  if (!flags.quiet) {
    process.stdout.write(`${color('squeekwatch', 'orange', flags.color)} ${color(`http://127.0.0.1:${instance.port}/`, 'cream', flags.color)}\n`);
    process.stdout.write(`${color('  dashboard', 'dim', flags.color)} /dashboard/   ${color('api', 'dim', flags.color)} /api/snapshot  ${color('badge', 'dim', flags.color)} /badge.svg\n`);
  }
  return new Promise((resolve) => {
    /** @param {string} signal */
    const stop = (signal) => {
      if (!flags.quiet) process.stdout.write(`\n${color(signal, 'dim', flags.color)} stopping\n`);
      instance.server.close(() => resolve(0));
      setTimeout(() => resolve(0), 2000).unref();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}

async function cmdRace(flags) {
  const snap = await snapshot(flags);
  const used = { ...snap, meta: snap.meta ?? readMeta() };
  if (flags.json) {
    printJson({
      name: used.meta?.name,
      integration: used.meta?.integration,
      repoUrl: used.meta?.repoUrl,
      demoUrl: used.meta?.demoUrl ?? null,
      evidence: {
        generatedAt: snap.generatedAt,
        workUnits: snap.status?.measurement?.cumulativeWorkUnits,
        anchorBlock: snap.status?.builder?.anchor?.blockHeight,
        minted: snap.economy?.supply?.totalMintedBaseUnits,
      },
    });
  } else {
    process.stdout.write(`${renderRace(used, renderOpts(flags))}\n`);
  }
  return 0;
}

async function cmdProtocol(flags) {
  if (flags.json) {
    const { DEFAULT_ADDRESSES, CHAIN } = await import('./contracts.js');
    printJson({ chain: CHAIN, addresses: DEFAULT_ADDRESSES });
  } else {
    process.stdout.write(`${renderProtocol(renderOpts(flags))}\n`);
  }
  return 0;
}

async function cmdFixtures(flags) {
  const dir = path.join(ROOT, 'fixtures');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const stat = statSync(path.join(dir, name));
      let fetchedAt = null;
      try {
        const parsed = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
        fetchedAt = parsed.generatedAt ?? parsed.fetchedAt ?? parsed.capturedAt ?? null;
      } catch {
        fetchedAt = null;
      }
      return { name, bytes: stat.size, fetchedAt };
    });
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const meta = readMeta();
  const report = { files, totalBytes, capturedAt: meta?.fetchedAt ?? null };
  if (flags.json) printJson(report);
  else process.stdout.write(`${renderFixturesReport(report, renderOpts(flags))}\n`);
  return 0;
}

async function cmdMcp(flags) {
  const { startMcpServer } = await import('./mcp.js');
  await startMcpServer({ version: readPackage().version });
  return null; // the server keeps the process alive until stdin closes
}

/** @param {Record<string, any>} flags @returns {Promise<number|null>} */
async function cmdWatch(flags) {
  const opts = renderOpts(flags);
  const interval = Math.max(1, flags.interval) * 1000;
  if (!flags.quiet && !flags.json) {
    process.stdout.write(`${rule('Squeekwatch live', 78, flags.color)}\n`);
  }
  let timer = null;
  let stopped = false;
  let lastVerdict = null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const tick = async () => {
    try {
      const snap = await snapshot(flags);
      const audit = auditSnapshot(snap);
      lastVerdict = audit;
      if (flags.json) {
        process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), snapshot: snap, audit })}\n`);
      } else {
        process.stdout.write(`${summaryLine(snap, audit, opts)}\n`);
        const attention = audit.findings.filter((f) => f.severity === 'fail' || f.severity === 'warn');
        for (const finding of attention) {
          process.stdout.write(`${color('  !', 'yellow', flags.color)} ${finding.id}: ${stripAnsi(finding.detail)}\n`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${color('  x', 'red', flags.color)} refresh failed: ${message}\n`);
    }
  };

  await tick();
  if (flags.once || interval === 0) {
    return lastVerdict ? exitCodeFor(lastVerdict) : 0;
  }
  // eslint-disable-next-line no-constant-condition
  while (!stopped) {
    await new Promise((resolve) => {
      timer = setTimeout(resolve, interval);
    });
    if (stopped) break;
    await tick();
  }
  return lastVerdict ? exitCodeFor(lastVerdict) : 0;
}

/**
 * The CLI entry point. Returns the exit code; never throws.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) return fail(error.message);
    throw error;
  }
  const { command, flags } = parsed;
  if (command === 'version') {
    const pkg = readPackage();
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
    return 0;
  }
  try {
    switch (command) {
      case 'help':
        process.stdout.write(`${renderHelp(readPackage().version, { colorize: flags.color })}\n`);
        return 0;
      case 'status':
        return await cmdStatus(flags);
      case 'audit':
        return await cmdAudit(flags);
      case 'badge':
        return await cmdBadge(flags);
      case 'race':
        return await cmdRace(flags);
      case 'serve':
        return await cmdServe(flags);
      case 'protocol':
        return await cmdProtocol(flags);
      case 'fixtures':
        return await cmdFixtures(flags);
      case 'watch':
        return (await cmdWatch(flags)) ?? 0;
      case 'mcp':
        return (await cmdMcp(flags)) ?? 0;
      default:
        return fail(`unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${color('fatal', 'red', flags.color)} ${message}\n`);
    if (process.env.SQUEEKWATCH_DEBUG) {
      process.stderr.write(`${error instanceof Error && error.stack ? error.stack : ''}\n`);
    }
    return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const code = await main(process.argv.slice(2));
  if (typeof code === 'number') process.exitCode = code;
}
