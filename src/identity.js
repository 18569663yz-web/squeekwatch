/**
 * Identity helpers shared by the server, the renderer and the tooling.
 *
 * The repository ships with a placeholder owner (see `PLACEHOLDER_OWNER` below) until
 * `node scripts/set-identity.mjs <github-user>` rewrites package.json and
 * fixtures/meta.json. Keeping the token constructed in one place here lets the
 * runtime refuse placeholder URLs without scattering string literals everywhere.
 *
 * Zero dependencies.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (one level above src/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The placeholder account name used before the repository owner is configured. */
export const PLACEHOLDER_OWNER = ['REPLACE', '_ME'].join('');

/** @returns {{name?: string, version?: string, homepage?: string, repository?: {url?: string}, bugs?: {url?: string}, author?: string}} */
export function readPackageJson(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

/**
 * True when a URL (or any string) still carries the unconfigured placeholder.
 * @param {unknown} value
 */
export function isPlaceholder(value) {
  const text = String(value ?? '').trim();
  return !text || text.includes(PLACEHOLDER_OWNER) || /example\.com/i.test(text);
}

/**
 * Normalise a package.json `repository` value into a browser-safe GitHub URL.
 * Returns null for missing or still-placeholder values.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normaliseRepo(value) {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? /** @type {any} */ (value).url : null;
  if (!raw) return null;
  let url = String(raw).trim();
  if (isPlaceholder(url)) return null;
  url = url.replace(/^git\+/, '').replace(/\.git$/, '');
  if (url.startsWith('git@github.com:')) url = 'https://github.com/' + url.slice('git@github.com:'.length);
  if (url.startsWith('github:')) url = 'https://github.com/' + url.slice('github:'.length);
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}
