#!/usr/bin/env node
/**
 * Minimal Model Context Protocol server over stdio (JSON-RPC 2.0, newline-delimited).
 *
 * Speaks `initialize`, `tools/list`, `tools/call`, `ping`; ignores notifications. This is a
 * deliberately small surface: the tools are the same reads the CLI performs, so an agent
 * can audit Squeekchain without shelling out, and every number it returns is verifiable
 * against a second source by the audit tool.
 */
import { auditSnapshot } from './audit.js';
import { fetchSnapshot, getAccount, getAuraProfile, getLeaderboard, getSqueek } from './api.js';

const PROTOCOL_VERSION = '2024-11-05';

/** @typedef {{name: string, description: string, inputSchema: Record<string, any>, handler: (args: any) => Promise<any>}} Tool */

/** @type {Tool[]} */
const TOOLS = [
  {
    name: 'squeekchain_status',
    description:
      'Live Squeekchain installation snapshot: hamster-wheel counter (rpm, work units, provenance), settlement queue, confirmed builder anchor, and the derived audit verdict. Uses the recorded fixtures when offline=true.',
    inputSchema: {
      type: 'object',
      properties: {
        offline: { type: 'boolean', description: 'Audit the bundled local snapshot instead of the network.' },
        chain: { type: 'boolean', description: 'Also probe the Sepolia contracts (default true).' },
      },
    },
    async handler(args) {
      const snapshot = await fetchSnapshot({ offline: Boolean(args?.offline), chain: args?.chain !== false });
      const audit = auditSnapshot(snapshot);
      return {
        verdict: audit.verdict,
        score: audit.score,
        generatedAt: snapshot.generatedAt,
        hardware: snapshot.status?.measurement ?? null,
        anchor: snapshot.status?.builder?.anchor ?? null,
        settlement: snapshot.status?.settlementQueue?.latestSubmission ?? null,
        chain: snapshot.chain ?? null,
        findings: audit.findings,
      };
    },
  },
  {
    name: 'squeekchain_audit',
    description:
      'Run the Squeekchain ledger invariants against the live API and Sepolia contracts and return the findings. severity="fail" returns only breaks; default returns all non-ok findings.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['all', 'fail', 'warn', 'non-ok'], description: 'Filter findings.' },
        offline: { type: 'boolean' },
      },
    },
    async handler(args) {
      const snapshot = await fetchSnapshot({ offline: Boolean(args?.offline), chain: true });
      const audit = auditSnapshot(snapshot);
      const filter = args?.severity ?? 'non-ok';
      const findings =
        filter === 'all'
          ? audit.findings
          : filter === 'fail'
            ? audit.findings.filter((f) => f.severity === 'fail')
            : filter === 'warn'
              ? audit.findings.filter((f) => f.severity === 'warn')
              : audit.findings.filter((f) => f.severity === 'fail' || f.severity === 'warn');
      return { verdict: audit.verdict, score: audit.score, pass: audit.pass, warn: audit.warn, fail: audit.fail, skipped: audit.skipped, findings };
    },
  },
  {
    name: 'squeekchain_economy',
    description: 'Supply, emission schedule, mining curve, staking pools and NFT configuration from /v1/economy/state.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const snapshot = await fetchSnapshot({ chain: false, community: false });
      const economy = snapshot.economy ?? {};
      return {
        release: economy.release ?? null,
        lifecycle: economy.lifecycle ?? null,
        supply: economy.supply ?? null,
        schedule: economy.schedule ?? null,
        mining: economy.mining ?? null,
        staking: economy.staking ?? null,
        nft: economy.nft ?? null,
        chain: economy.chain ?? null,
      };
    },
  },
  {
    name: 'squeekchain_squeek',
    description: 'Metadata for one Squeeks NFT (token id 1..9999).',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'integer', minimum: 1, maximum: 9999 } },
      required: ['tokenId'],
    },
    async handler(args) {
      const tokenId = Number(args?.tokenId);
      if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 9999) throw new Error('tokenId must be an integer from 1 to 9999');
      return getSqueek(tokenId);
    },
  },
  {
    name: 'squeekchain_leaderboard',
    description: 'Genesis whitelist ranking: aura, badges, tier. Pass a code to fetch one profile instead.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, code: { type: 'string' } },
    },
    async handler(args) {
      if (args?.code) return { profile: await getAuraProfile(String(args.code)) };
      const board = await getLeaderboard(Number(args?.limit ?? 20));
      return board;
    },
  },
  {
    name: 'squeekchain_account',
    description: 'Portfolio and activity for one wallet address.',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: '0x-prefixed Sepolia address' } },
      required: ['address'],
    },
    async handler(args) {
      const address = String(args?.address ?? '');
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('address must be a 0x-prefixed 20-byte hex string');
      return getAccount(address);
    },
  },
];

/** @param {unknown} value */
function asText(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/** @param {string|number|null} id @param {unknown} result */
function response(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** @param {string|number|null} id @param {number} code @param {string} message @param {unknown} [data] */
function error(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/**
 * Handle one decoded JSON-RPC message.
 * @param {any} message
 * @param {{version: string}} options
 * @returns {Promise<any|null>}
 */
export async function handleMessage(message, options) {
  if (!message || typeof message !== 'object') return null;
  const { id, method, params } = message;
  if (method === undefined) return null; // notification ack
  if (id === undefined) return null; // notifications never get a response

  switch (method) {
    case 'initialize':
      return response(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'squeekwatch', version: options.version },
        instructions:
          'Squeekchain is a proof-of-work chain where a physical hamster wheel produces the work units. squeekchain_status explains the live ledger; squeekchain_audit re-derives the invariants from the public API and Sepolia contracts.',
      });
    case 'ping':
      return response(id, {});
    case 'tools/list':
      return response(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const name = params?.name;
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) return error(id, -32602, `unknown tool: ${name}`);
      try {
        const result = await tool.handler(params?.arguments ?? {});
        return response(id, { content: asText(result), isError: false });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return response(id, { content: [{ type: 'text', text: `tool failed: ${message}` }], isError: true });
      }
    }
    default:
      if (method.startsWith('notifications/')) return null;
      return error(id, -32601, `method not found: ${method}`);
  }
}

/**
 * Start the stdio server. Resolves when stdin closes (or SIGINT).
 * @param {{version: string, input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream}} options
 */
export async function startMcpServer(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const version = options.version ?? '0.0.0';

  /** @param {unknown} payload */
  const send = (payload) => {
    output.write(`${JSON.stringify(payload)}\n`);
  };

  let buffer = '';
  /** @type {Promise<void>[]} */
  const pending = [];
  await new Promise((resolve) => {
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          pending.push(Promise.resolve().then(() => send(error(null, -32700, 'parse error'))));
          continue;
        }
        const work = Promise.resolve(handleMessage(message, { version }))
          .then((reply) => {
            if (reply) send(reply);
          })
          .catch((cause) => send(error(message?.id ?? null, -32603, cause instanceof Error ? cause.message : String(cause))));
        pending.push(work);
      }
    });
    // Answer everything that was already queued before the stream closes, so callers that
    // await this function see a complete transcript.
    const finish = () => {
      Promise.allSettled(pending).then(() => resolve());
    };
    input.on('end', finish);
    input.on('close', finish);
    process.once('SIGINT', () => {
      Promise.allSettled(pending).then(() => resolve());
    });
  });
}

export const tools = TOOLS;
