#!/usr/bin/env node
/**
 * lane-watch: the Squeekchain Genesis "Code" lane ships *inside the web build*, not behind a
 * JSON flag. The deployed route chunk hardcodes `{id:"code", ..., closed:!0}` while the lane is
 * shut, so the reliable open signal is a new build whose chunk no longer carries that marker.
 *
 * This script fingerprints the live build, follows the route chunk, and reports whether the
 * code lane is still closed. It is the thing to run while waiting for the lane to open:
 *
 *   node scripts/lane-watch.mjs                 # poll every 90s until the lane opens
 *   node scripts/lane-watch.mjs --once          # single probe, exit 1 while still closed
 *   node scripts/lane-watch.mjs --interval 300  # slower poll
 *   node scripts/lane-watch.mjs --json          # machine-readable lines
 *
 * Exit codes: 0 = lane appears open, 1 = still closed (single probe), 2 = probe failed.
 */

const ORIGIN = 'https://squeekchain.com';
const LANE_PATH = '/genesis/code';
const COMMUNITY_STATS = 'https://community.squeekchain.com/v1/community/stats';

function parseArgs(argv) {
  const flags = { interval: 90, once: false, json: false, timeout: 12000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') flags.once = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--interval') flags.interval = Number(argv[++i]);
    else if (arg.startsWith('--interval=')) flags.interval = Number(arg.split('=')[1]);
    else if (arg === '--timeout') flags.timeout = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') flags.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(flags.interval) || flags.interval < 10) throw new Error('--interval must be >= 10 seconds');
  return flags;
}

const HELP = `lane-watch - watch the Genesis "Code" lane open

Usage:
  node scripts/lane-watch.mjs [options]

Options:
  --once             probe once and exit (0 open, 1 closed, 2 probe failed)
  --interval <s>     seconds between probes (default 90, minimum 10)
  --timeout <ms>     per-request timeout (default 12000)
  --json             print one JSON object per probe
  -h, --help         show this help

How it decides:
  The lane state is compiled into the deployed route chunk
  (assets/genesis-page-*.js). While the lane is shut that chunk contains the
  literal marker {id:"code", ..., closed:!0}. A probe reports "open" only when
  the chunk loads and no longer carries the code-lane closed marker.
`;

async function get(url, timeout) {
  const response = await fetch(url, {
    headers: { 'cache-control': 'no-cache', 'user-agent': 'squeekwatch-lane-watch' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return await response.text();
}

/** Fingerprint the live build and inspect the route chunk that owns the Genesis lanes. */
export async function probeLane({ origin = ORIGIN, path = LANE_PATH, timeout = 12000 } = {}) {
  const html = await get(origin + path, timeout);
  const entry = /\/assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? null;
  if (!entry) throw new Error('entry bundle not found in page HTML');

  const main = await get(`${origin}/assets/${entry}`, timeout);
  const chunkMatch = /genesis-page-([A-Za-z0-9_-]+\.js)/.exec(main);
  if (!chunkMatch) throw new Error('genesis route chunk not referenced by the entry bundle');
  const chunk = chunkMatch[0];

  const source = await get(`${origin}/assets/${chunk}`, timeout);
  const codeClosed = /id:"code"[^}]*?closed:!0/.test(source) || /closed:!0[^}]*?id:"code"/.test(source);
  const capitalClosed = /id:"capital"[^}]*?closed:!0/.test(source);
  const submitCopy = source.includes('Submit an independent project');

  return {
    checkedAt: new Date().toISOString(),
    entry,
    chunk,
    bytes: source.length,
    codeLaneClosed: codeClosed,
    capitalLaneClosed: capitalClosed,
    open: !codeClosed && submitCopy,
    note: codeClosed ? 'route chunk still marks the code lane closed' : 'code lane marker is gone',
  };
}

async function communityStats() {
  try {
    const response = await fetch(COMMUNITY_STATS, {
      headers: { accept: 'application/json', 'user-agent': 'squeekwatch-lane-watch' },
      signal: AbortSignal.timeout(8000),
    });
    const json = await response.json();
    return { members: json.members ?? null, projectsVerified: json.projectsVerified ?? null };
  } catch {
    return { members: null, projectsVerified: null };
  }
}

function line(probe, stats) {
  const state = probe.open ? 'OPEN' : 'CLOSED';
  const verified = stats.projectsVerified === null ? '?' : stats.projectsVerified;
  return `${state}  ${probe.chunk}  verified=${verified}  members=${stats.members ?? '?'}  (${probe.note})`;
}

async function main(argv) {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`lane-watch: ${error.message}\n\n${HELP}`);
    return 2;
  }
  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let failures = 0;
  for (;;) {
    let probe;
    try {
      probe = await probeLane({ timeout: flags.timeout });
      failures = 0;
    } catch (error) {
      failures += 1;
      process.stderr.write(`lane-watch: probe failed (${failures}): ${error.message}\n`);
      if (flags.once) return 2;
      if (failures >= 5) {
        process.stderr.write('lane-watch: giving up after five consecutive probe failures\n');
        return 2;
      }
      await sleep(flags.interval * 1000);
      continue;
    }

    const stats = await communityStats();
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ...probe, stats })}\n`);
    } else {
      process.stdout.write(`${probe.checkedAt}  ${line(probe, stats)}\n`);
    }

    if (probe.open) {
      if (!flags.json) {
        process.stdout.write(
          `\ncode lane is OPEN (${probe.chunk}). Submit now:\n` +
            '  1. open https://squeekchain.com/genesis/code and click Submit an independent project\n' +
            '  2. paste the payload from submission/payload.json\n' +
            '  3. node scripts/add-challenge.mjs <path> "<text>" && git push, then verify\n',
        );
      }
      return 0;
    }

    if (flags.once) return 1;
    if (probe.capitalLaneClosed === false) {
      process.stdout.write('note: the capital lane changed too; re-check the whole Genesis page.\n');
    }
    await sleep(flags.interval * 1000);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`lane-watch: ${error?.message ?? error}\n`);
      process.exitCode = 2;
    },
  );
}
