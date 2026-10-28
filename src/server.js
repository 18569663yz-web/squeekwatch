// @ts-check
/**
 * Squeekwatch local server.
 *
 * Zero-dependency `node:http` server that serves the static dashboard and a small
 * JSON API on top of the lead-owned modules (`src/api.js`, `src/audit.js`).
 *
 * Contract (docs/INTERFACE.md):
 *   createServer({ root, fetchImpl }) -> http.Server
 *   startServer({ port, root })       -> { server, port, url }
 *
 * Routes:
 *   GET /                      dashboard/index.html
 *   GET /testdrive.html        dashboard/testdrive.html
 *   GET /dashboard/<file>      static file from dashboard/
 *   GET /api/snapshot          ?offline=1 (fixtures/) ?chain=0 (skip RPC) ?nocache=1
 *   GET /api/audit             same query flags
 *   GET /badge.svg             status badge (hamster | BLOCK ... - ... SQK)
 *   GET /badge/audit.svg       audit badge (squeekwatch | VERIFIED n/n)
 *   GET /healthz               liveness + commit metadata
 *
 * The lead's modules are imported lazily so this file keeps working (and stays
 * testable) while they are still being written, and so a missing optional module
 * degrades one route instead of the whole server.
 */

import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { renderStatusBadge, renderAuditBadge } from './badge.js';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SRC_DIR, '..');
const SELF_PATH = fileURLToPath(import.meta.url);

const PKG_HINT = { name: 'squeekwatch', version: '0.1.0' };

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Snapshot / audit responses are memoised briefly to survive dashboard polling. */
const CACHE_TTL_MS = 3000;
/** @type {Map<string, { at: number, value: unknown }>} */
const responseCache = new Map();

/** @type {Map<string, Promise<any>>} */
const modulePromises = new Map();

/**
 * Import a sibling module once, remembering both success and failure.
 * Failed imports are evicted so a concurrently-written file can be picked up later.
 * @param {string} specifier path relative to this file, e.g. './api.js'
 * @returns {Promise<any>}
 */
function importOnce(specifier) {
  const cached = modulePromises.get(specifier);
  if (cached) return cached;
  const pending = import(new URL(specifier, import.meta.url).href).then(
    (mod) => mod,
    (error) => {
      modulePromises.delete(specifier);
      return { __importError: error };
    },
  );
  modulePromises.set(specifier, pending);
  return pending;
}

/**
 * Pick the first callable export matching one of the candidate names.
 * @param {any} mod
 * @param {string[]} names
 * @returns {((...args: any[]) => any) | null}
 */
function pickFunction(mod, names) {
  if (!mod || typeof mod !== 'object') return null;
  for (const name of names) {
    const candidate = mod[name];
    if (typeof candidate === 'function') return candidate;
  }
  if (typeof mod.default === 'function') return mod.default;
  return null;
}

/**
 * @param {string} message
 * @param {string} [hint]
 * @returns {Error}
 */
function moduleError(message, hint) {
  const error = new Error(hint ? message + ' (' + hint + ')' : message);
  // @ts-expect-error - ad-hoc marker consumed by describeError()
  error.squeekwatch = true;
  return error;
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(/** @type {{ message: unknown }} */ (error).message);
  }
  return String(error);
}

/**
 * Resolve a snapshot through src/api.js (which already understands `offline`).
 * @param {{ chain: boolean, community?: boolean, offline?: boolean, fixturesDir?: string, skipCache?: boolean, fetchImpl?: typeof fetch } } options
 * @returns {Promise<any>}
 */
async function snapshotFromApi(options) {
  const mod = await importOnce('./api.js');
  if (mod && mod.__importError) {
    throw moduleError('src/api.js is not available: ' + describeError(mod.__importError));
  }
  const fetchSnapshot = pickFunction(mod, ['fetchSnapshot']);
  if (!fetchSnapshot) throw moduleError('src/api.js does not export fetchSnapshot()');
  return fetchSnapshot({
    chain: options.chain,
    community: options.community !== false,
    offline: options.offline === true,
    fixturesDir: options.fixturesDir,
    skipCache: options.skipCache === true,
    timeoutMs: 9000,
    fetch: options.fetchImpl,
  });
}

/**
 * Resolve an audit through src/audit.js. Tolerates a few plausible export names so
 * the dashboard never hard-breaks on a naming drift from the contract.
 * @param {any} snapshot
 * @returns {Promise<any>}
 */
async function auditFromModule(snapshot) {
  const mod = await importOnce('./audit.js');
  if (mod && mod.__importError) {
    throw moduleError('src/audit.js is not available: ' + describeError(mod.__importError));
  }
  const run = pickFunction(mod, ['auditSnapshot', 'runAudit', 'auditSnapshotOf', 'audit']);
  if (!run) throw moduleError('src/audit.js does not export auditSnapshot()');
  return run(snapshot);
}

/**
 * @param {string} key
 * @param {() => Promise<any>} producer
 * @param {boolean} bypass
 * @returns {Promise<any>}
 */
async function memoised(key, producer, bypass) {
  const hit = responseCache.get(key);
  const now = Date.now();
  if (!bypass && hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await producer();
  responseCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * @param {URLSearchParams} query
 * @returns {{ offline: boolean, chain: boolean, bypass: boolean, community: boolean }}
 */
function readFlags(query) {
  /**
   * A bare `?flag` (no value) enables; `?flag=0|false|no|off` disables; a missing
   * parameter falls back to `fallback`.
   * @param {string | null} raw
   * @param {boolean} fallback
   * @returns {boolean}
   */
  const readFlag = (raw, fallback) => {
    if (raw == null) return fallback;
    const value = raw.trim().toLowerCase();
    if (value === '') return true;
    return !(value === '0' || value === 'false' || value === 'no' || value === 'off');
  };
  return {
    offline: readFlag(query.get('offline'), false),
    chain: readFlag(query.get('chain'), true),
    bypass: query.has('nocache') || query.has('refresh'),
    community: readFlag(query.get('community'), true),
  };
}

/**
 * Serve the snapshot for one request.
 * @param {{ root: string, fetchImpl?: typeof fetch, query: URLSearchParams }} ctx
 * @returns {Promise<any>}
 */
async function resolveSnapshot(ctx) {
  const flags = readFlags(ctx.query);
  const key = 'snapshot:' + (flags.offline ? 'offline' : 'online') + ':' + (flags.chain ? 1 : 0);
  return memoised(
    key,
    async () => {
      if (flags.offline) {
        // Offline never touches the network, not even for RPC probes: api.js reads
        // the recorded snapshot from fixtures/ instead.
        return snapshotFromApi({
          chain: false,
          community: flags.community,
          offline: true,
          fixturesDir: path.join(ctx.root, 'fixtures'),
          skipCache: flags.bypass,
          fetchImpl: ctx.fetchImpl,
        });
      }
      return snapshotFromApi({
        chain: flags.chain,
        community: flags.community,
        skipCache: flags.bypass,
        fetchImpl: ctx.fetchImpl,
      });
    },
    flags.bypass,
  );
}

/**
 * Serve the audit for one request.
 * @param {{ root: string, fetchImpl?: typeof fetch, query: URLSearchParams }} ctx
 * @returns {Promise<{ audit: any, snapshot: any }>}
 */
async function resolveAudit(ctx) {
  const flags = readFlags(ctx.query);
  const key = 'audit:' + (flags.offline ? 'offline' : 'online') + ':' + (flags.chain ? 1 : 0);
  const audit = await memoised(
    key,
    async () => {
      const snapshot = await resolveSnapshot(ctx);
      return auditFromModule(snapshot);
    },
    flags.bypass,
  );
  let snapshot = null;
  const snapshotKey = 'snapshot:' + (flags.offline ? 'offline' : 'online') + ':' + (flags.chain ? 1 : 0);
  const hit = responseCache.get(snapshotKey);
  if (hit) snapshot = hit.value;
  return { audit, snapshot };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {unknown} body
 * @param {Record<string, string>} [extraHeaders]
 */
function sendJson(res, statusCode, body, extraHeaders = {}) {
  const payload = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} body
 * @param {string} contentType
 */
function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} svg
 */
function sendSvg(res, statusCode, svg) {
  const payload = Buffer.from(svg, 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

/**
 * Resolve a URL path to an absolute file inside the dashboard directory.
 * Returns null when the path is not one of the explicitly served entries, which
 * keeps `src/`, `fixtures/` and dotfiles unreachable by construction.
 *
 * @param {string} root
 * @param {string} pathname
 * @returns {string | null}
 */
function resolveStaticFile(root, pathname) {
  const dashboardDir = path.join(root, 'dashboard');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const clean = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/');

  let relative;
  if (clean === '/' || clean === '/index.html') relative = 'index.html';
  else if (clean === '/testdrive.html') relative = 'testdrive.html';
  else if (clean === '/dashboard' || clean === '/dashboard/') relative = 'index.html';
  else if (clean.startsWith('/dashboard/')) relative = clean.slice('/dashboard/'.length);
  else return null;

  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const resolved = path.resolve(dashboardDir, relative);
  const prefix = dashboardDir + path.sep;
  if (resolved !== dashboardDir && !resolved.startsWith(prefix)) return null;
  // Never expose dotfiles (e.g. a stray .env) through the static route.
  const segments = path.relative(dashboardDir, resolved).split(path.sep);
  if (segments.some((segment) => segment.startsWith('.'))) return null;
  return resolved;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} filePath
 */
async function serveStaticFile(req, res, filePath) {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    sendText(res, 404, 'Not found\n');
    return;
  }
  let target = filePath;
  if (info.isDirectory()) {
    target = path.join(filePath, 'index.html');
    try {
      info = await stat(target);
    } catch {
      sendText(res, 404, 'Not found\n');
      return;
    }
  }
  if (!info.isFile()) {
    sendText(res, 404, 'Not found\n');
    return;
  }

  const body = await readFile(target);
  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else res.end(body);
}

/**
 * Create the HTTP server without binding a port.
 *
 * @param {{ root?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  const root = options.root ? path.resolve(options.root) : DEFAULT_ROOT;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const ctx = { root, fetchImpl, query: new URLSearchParams() };
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: describeError(error) });
    });
  });

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'accept, content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { error: 'Method not allowed. Squeekwatch is a read-only observatory.' });
      return;
    }

    const host = req.headers.host || '127.0.0.1';
    let url;
    try {
      url = new URL(req.url || '/', 'http://' + host);
    } catch {
      sendJson(res, 400, { error: 'Malformed request URL' });
      return;
    }
    const pathname = url.pathname;
    const query = url.searchParams;

    if (pathname === '/healthz') {
      const pkg = await readPkgInfo(root);
      sendJson(res, 200, {
        ok: true,
        service: 'squeekwatch',
        version: pkg.version || PKG_HINT.version,
        repository: pkg.repository,
        commit: resolveCommit(),
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        now: new Date().toISOString(),
        routes: [
          '/',
          '/testdrive.html',
          '/api/snapshot',
          '/api/audit',
          '/badge.svg',
          '/badge/audit.svg',
          '/healthz',
        ],
      });
      return;
    }

    if (pathname === '/api/snapshot') {
      try {
        const snapshot = await resolveSnapshot({ root, fetchImpl, query });
        sendJson(res, 200, snapshot);
      } catch (error) {
        sendJson(res, 502, {
          error: describeError(error),
          hint: 'src/api.js failed. Retry with ?offline=1 to use fixtures/.',
        });
      }
      return;
    }

    if (pathname === '/api/audit') {
      try {
        const { audit } = await resolveAudit({ root, fetchImpl, query });
        sendJson(res, 200, audit);
      } catch (error) {
        sendJson(res, 502, {
          error: describeError(error),
          hint: 'src/audit.js failed. Retry with ?offline=1 to use fixtures/.',
        });
      }
      return;
    }

    if (pathname === '/badge.svg') {
      try {
        const snapshot = await resolveSnapshot({ root, fetchImpl, query });
        sendSvg(res, 200, renderStatusBadge(snapshot));
      } catch (error) {
        sendSvg(
          res,
          200,
          renderStatusBadge({ status: { builder: { anchor: { blockHeight: 'n/a' } } } }),
        );
        void error;
      }
      return;
    }

    if (pathname === '/badge/audit.svg') {
      try {
        const { audit } = await resolveAudit({ root, fetchImpl, query });
        sendSvg(res, 200, renderAuditBadge(audit));
      } catch {
        sendSvg(res, 200, renderAuditBadge({ verdict: 'UNKNOWN', pass: 0, total: 0 }));
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unknown API route: ' + pathname });
      return;
    }

    const filePath = resolveStaticFile(root, pathname);
    if (!filePath) {
      sendText(res, 404, 'Not found. Try / for the dashboard.\n');
      return;
    }
    await serveStaticFile(req, res, filePath);
  }

  void ctx;
  return server;
}

/**
 * Best-effort commit identifier for the dashboard footer.
 * @returns {string | null}
 */
function resolveCommit() {
  const raw =
    process.env.SQUEKEWATCH_COMMIT || process.env.GITHUB_SHA || process.env.GIT_COMMIT || '';
  const trimmed = String(raw).trim();
  return trimmed ? trimmed.slice(0, 7) : null;
}

/**
 * Normalise a package.json `repository` value into a browser-safe URL.
 * @param {unknown} value
 * @returns {string | null}
 */
function normaliseRepo(value) {
  // Built from parts so a repository-wide placeholder rewrite cannot break this guard.
  const PLACEHOLDER = 'REPLACE' + '_ME';
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? /** @type {any} */ (value).url : null;
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url || url.includes(PLACEHOLDER)) return null;
  url = url.replace(/^git\+/, '').replace(/\.git$/, '');
  if (url.startsWith('git@github.com:')) url = 'https://github.com/' + url.slice('git@github.com:'.length);
  if (url.startsWith('github:')) url = 'https://github.com/' + url.slice('github:'.length);
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

/** @type {{ name: string, version: string, repository: string | null } | null} */
let pkgCache = null;

/**
 * Read the package metadata once so `/healthz` can report the repository and version.
 * @param {string} root
 * @returns {Promise<{ name: string, version: string, repository: string | null }>}
 */
async function readPkgInfo(root) {
  if (pkgCache) return pkgCache;
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    pkgCache = {
      name: typeof pkg.name === 'string' ? pkg.name : PKG_HINT.name,
      version: typeof pkg.version === 'string' ? pkg.version : PKG_HINT.version,
      repository: normaliseRepo(pkg.repository),
    };
  } catch {
    pkgCache = { name: PKG_HINT.name, version: PKG_HINT.version, repository: null };
  }
  return pkgCache;
}

/**
 * Bind a server, walking forward one port at a time while the port is busy.
 *
 * @param {{ port?: number, root?: string, fetchImpl?: typeof fetch, host?: string }} [options]
 * @returns {Promise<{ server: import('node:http').Server, port: number, url: string }>}
 */
export async function startServer(options = {}) {
  const requested = Number.isFinite(Number(options.port)) ? Number(options.port) : 8787;
  const host = options.host || '127.0.0.1';
  const server = createServer({ root: options.root, fetchImpl: options.fetchImpl });

  /** @type {Error | null} */
  let lastError = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const port = requested + attempt;
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.removeListener('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve(undefined);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      const url = 'http://' + host + ':' + port;
      // ASCII source, intentional output: Squeekwatch -> http://127.0.0.1:8787
      console.log('Squeekwatch \u2192 ' + url);
      return { server, port, url };
    } catch (error) {
      lastError = /** @type {Error} */ (error);
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error;
    }
  }
  throw lastError || new Error('No free port found for Squeekwatch');
}

/**
 * `node src/server.js [--port 8787]` starts the server directly.
 */
function runAsScript() {
  const invoked = process.argv[1];
  if (!invoked) return;
  let samePath = false;
  try {
    samePath = path.resolve(invoked).toLowerCase() === path.resolve(SELF_PATH).toLowerCase();
  } catch {
    samePath = false;
  }
  if (!samePath) return;

  const argv = process.argv.slice(2);
  const portFlag = argv.indexOf('--port');
  const fromFlag = portFlag >= 0 ? Number(argv[portFlag + 1]) : NaN;
  const fromEnv = Number(process.env.PORT);
  const port = Number.isFinite(fromFlag) ? fromFlag : Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 8787;
  startServer({ port }).catch((error) => {
    console.error('squeekwatch: failed to start - ' + describeError(error));
    process.exitCode = 1;
  });
}

runAsScript();
