import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { handleMessage, startMcpServer, tools } from '../src/mcp.js';

const OPTIONS = { version: '0.1.0' };

test('initialize answers with server info and the protocol version', async () => {
  const reply = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, OPTIONS);
  assert.equal(reply.id, 1);
  assert.equal(reply.result.serverInfo.name, 'squeekwatch');
  assert.equal(reply.result.serverInfo.version, '0.1.0');
  assert.equal(reply.result.protocolVersion, '2024-11-05');
  assert.ok(reply.result.capabilities.tools);
});

test('tools/list advertises the read-only toolset', async () => {
  const reply = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, OPTIONS);
  const names = reply.result.tools.map((tool) => tool.name);
  for (const expected of ['squeekchain_status', 'squeekchain_audit', 'squeekchain_economy', 'squeekchain_squeek', 'squeekchain_leaderboard', 'squeekchain_account']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  assert.equal(names.length, tools.length);
});

test('tools/call runs the offline audit and returns JSON content', async () => {
  const reply = await handleMessage(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'squeekchain_audit', arguments: { severity: 'non-ok', offline: true } } },
    OPTIONS,
  );
  assert.equal(reply.result.isError, false);
  const payload = JSON.parse(reply.result.content[0].text);
  assert.equal(payload.verdict, 'VERIFIED');
  assert.ok(payload.pass >= 15);
  assert.deepEqual(payload.findings, []);
});

test('tools/call validates arguments before touching the network', async () => {
  const reply = await handleMessage(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'squeekchain_squeek', arguments: { tokenId: 10000 } } },
    OPTIONS,
  );
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /1 to 9999/);
});

test('unknown tools and methods are protocol errors', async () => {
  const unknownTool = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, OPTIONS);
  assert.equal(unknownTool.error.code, -32602);
  const unknownMethod = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'nope' }, OPTIONS);
  assert.equal(unknownMethod.error.code, -32601);
});

test('notifications are never answered', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, OPTIONS), null);
});

test('the stdio transport answers newline-delimited JSON-RPC', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = startMcpServer({ version: '0.1.0', input, output });
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk;
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  input.write('not json\n');
  input.end();
  await server;
  const lines = buffer.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[1].id, 2);
  assert.equal(lines[2].error.code, -32700);
});
