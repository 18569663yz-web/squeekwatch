#!/usr/bin/env node
/**
 * Record a fresh offline snapshot into fixtures/.
 *
 *   node scripts/record-fixtures.mjs [--code 8mae44td] [--out fixtures] [--no-community]
 *
 * The dashboard replay mode, the test suite and CI all read this directory, so it is
 * refreshed deliberately and committed with the capture time in fixtures/meta.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMUNITY_BASE, API_BASE } from '../src/api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @param {string[]} argv */
function parse(argv) {
  const out = { code: '8mae44td', outDir: path.join(ROOT, 'fixtures'), community: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--code') out.code = argv[++i];
    else if (arg === '--out') out.outDir = path.resolve(argv[++i]);
    else if (arg === '--no-community') out.community = false;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/record-fixtures.mjs [--code <profileCode>] [--out <dir>] [--no-community]');
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
}

/** @param {string} file @param {unknown} value */
function write(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  const bytes = readFileSync(file).byteLength;
  console.log(`  ${path.relative(process.cwd(), file)}  ${bytes} B`);
}

async function main() {
  const options = parse(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });
  console.log(`Recording Squeekchain snapshot into ${path.relative(process.cwd(), options.outDir)}/`);

  const status = await get(`${API_BASE}/v1/status`);
  const economy = await get(`${API_BASE}/v1/economy/state`);
  write(path.join(options.outDir, 'status.json'), status);
  write(path.join(options.outDir, 'economy.json'), economy);

  if (options.community) {
    const [stats, leaderboard, badges, profile] = await Promise.allSettled([
      get(`${COMMUNITY_BASE}/v1/community/stats`),
      get(`${COMMUNITY_BASE}/v1/community/leaderboard`),
      get(`${COMMUNITY_BASE}/v1/community/aura/badges`),
      get(`${COMMUNITY_BASE}/v1/community/profiles/${encodeURIComponent(options.code)}`),
    ]);
    if (stats.status === 'fulfilled') write(path.join(options.outDir, 'stats.json'), stats.value);
    if (leaderboard.status === 'fulfilled') write(path.join(options.outDir, 'leaderboard.json'), leaderboard.value);
    if (badges.status === 'fulfilled') write(path.join(options.outDir, 'badges.json'), badges.value);
    if (profile.status === 'fulfilled') write(path.join(options.outDir, 'profile.json'), profile.value);
  }

  // Keep the hand-written story (name, repo, integration text) and only refresh the capture time.
  const metaFile = path.join(options.outDir, 'meta.json');
  /** @type {any} */
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  } catch {
    meta = {};
  }
  write(metaFile, {
    ...meta,
    fetchedAt: new Date().toISOString(),
    installationId: status?.installationId ?? meta.installationId ?? null,
    source: `${API_BASE}, ${COMMUNITY_BASE}`,
  });
  console.log('Done. Commit the refreshed fixtures with the build.');
}

main().catch((error) => {
  console.error(`fixtures: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
