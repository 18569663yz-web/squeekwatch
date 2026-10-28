import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseUnits, bar, color, compact, duration, percent, rule, stripAnsi, table, token, truncate, wrap } from '../src/format.js';

test('baseUnits splits without floating point', () => {
  assert.equal(baseUnits('8066546793063427114304839'), '8066546.793063');
  assert.equal(baseUnits('1', 18), '0');
  assert.equal(baseUnits('0', 18), '0');
  assert.equal(baseUnits(1500n, 3), '1.5');
  assert.equal(baseUnits('-2500', 3), '-2.5');
  assert.equal(baseUnits('105000000000000000000000000'), '105000000');
});

test('compact handles magnitudes and zero', () => {
  assert.equal(compact('8066546793063427114304839'), '8.07M');
  assert.equal(compact('2091933453206936572885695161'), '2.09B');
  assert.equal(compact('5555000000000000000000000'), '5.55M');
  assert.equal(compact('0'), '0');
  assert.equal(compact('1234000000000000000000'), '1.23K');
  assert.equal(compact('42000000000000000000000', { digits: 1 }), '42.0K');
});

test('token appends the symbol only when asked', () => {
  assert.equal(token('2100000000000000000000000000'), '2.10B');
  assert.equal(token('2100000000000000000000000000', { symbol: 'SQK' }), '2.10B SQK');
  assert.equal(token(null), 'n/a');
});

test('percent guards against zero and non-numbers', () => {
  assert.equal(percent(1, 4, 0), '25%');
  assert.equal(percent('8066546793063427114304839', '2100000000000000000000000000', 3), '0.384%');
  assert.equal(percent(1, 0), 'n/a');
  assert.equal(percent('x', 2), 'n/a');
});

test('bar clamps to its range', () => {
  assert.equal(bar(0, 100, 10), '----------');
  assert.equal(bar(100, 100, 10), '##########');
  assert.equal(bar(150, 100, 10), '##########');
  assert.equal(bar(50, 100, 10), '#####-----');
});

test('truncate, pad and wrap stay deterministic', () => {
  assert.equal(truncate('abcdef', 4), 'abc...');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(wrap('one two three', 7), 'one two\nthree');
});

test('colour respects the enabled flag and can be stripped', () => {
  assert.equal(stripAnsi(color('ok', 'green', true)), 'ok');
  assert.equal(color('ok', 'green', false), 'ok');
  assert.match(color('ok', 'green', true), /\u001b\[32m/);
  assert.equal(color.dim('x', false), 'x');
});

test('rule renders the requested width', () => {
  const line = stripAnsi(rule('', 30, false));
  assert.equal(line.length, 30);
  assert.match(line, /^-+$/);
  const titled = stripAnsi(rule('TITLE', 40, false));
  assert.equal(titled.length, 40);
  assert.match(titled, /TITLE/);
});

test('table pads columns on the visible width', () => {
  const rendered = table(['id', 'value'], [['a', '1'], ['bbbb', '22']], { enabled: false });
  const lines = rendered.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('  a     '));
  assert.equal(stripAnsi(lines[0]).trim().split(/\s+/)[0], 'id');
});

test('duration describes spans', () => {
  assert.equal(duration(9), '9s');
  assert.equal(duration(90), '1m 30s');
  assert.equal(duration(7200), '2h 0m');
});
