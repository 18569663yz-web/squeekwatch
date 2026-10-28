// @ts-check
/**
 * Offline fixture loader. The repository ships a real snapshot of the public APIs so that
 * the audit, the CLI and the test-suite can run without a network connection.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_FIXTURES_DIR = join(REPO_ROOT, 'fixtures');

/** @param {string} [dir] */
export async function readFixtures(dir = DEFAULT_FIXTURES_DIR) {
  const read = async (name) => {
    try {
      return JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch {
      return null;
    }
  };
  const [status, economy, stats, leaderboard, badges, profile, meta] = await Promise.all([
    read('status.json'),
    read('economy.json'),
    read('stats.json'),
    read('leaderboard.json'),
    read('badges.json'),
    read('profile.json'),
    read('meta.json'),
  ]);
  const community = stats || leaderboard || badges ? { stats, leaderboard, badges } : null;
  return { status, economy, stats, leaderboard, badges, profile, meta, community };
}
