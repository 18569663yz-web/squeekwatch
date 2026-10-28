import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../src/fixtures.js';

const PAGE = resolve(REPO_ROOT, 'dashboard/testdrive.html');
const html = readFileSync(PAGE, 'utf8');

test('testdrive page is self-contained ASCII', () => {
  const bad = [...html].findIndex((ch) => ch.charCodeAt(0) > 0x7e || (ch.charCodeAt(0) < 0x20 && !'\t\n\r'.includes(ch)));
  assert.equal(bad, -1, 'non-ASCII character at offset ' + bad);
  const remoteAssets = (html.match(/https?:\/\/[^\s"']+/g) ?? []).filter((url) => /\.(js|css|png|jpg|svg|woff2?)\b/.test(url));
  assert.deepEqual(remoteAssets, [], 'page must not load remote assets');
});

test('testdrive offers a wallet picker instead of trusting window.ethereum', () => {
  for (const needle of ['eip6963:requestProvider', 'eip6963:announceProvider', 'id="walletPicker"', 'window.okxwallet', 'function activateProvider']) {
    assert.ok(html.includes(needle), 'missing ' + needle);
  }
});

test('testdrive inline script parses and still builds the zero-allowance approve', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script, 'inline script missing');
  mkdirSync(resolve(REPO_ROOT, 'scratch'), { recursive: true });
  const file = resolve(REPO_ROOT, 'scratch/testdrive-inline.js');
  writeFileSync(file, script[1]);
  execFileSync(process.execPath, ['--check', file]);
  assert.ok(html.includes('0x095ea7b3'), 'approve selector must stay visible');
});
