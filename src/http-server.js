import { createServer } from 'node:http';
import { HEALTH_ENDPOINT, MAX_REQUEST_BODY_BYTES, MCP_ENDPOINT, SUPPORTED_PROTOCOL_VERSIONS } from './constants.js';

export function createHttpServer({ dispatch, allowedHosts, allowedOrigins } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('dispatch is required.');
  const hostPolicy = compileHostPolicy(allowedHosts ?? process.env.ALLOWED_HOSTS);
  const originPolicy = compileOriginPolicy(allowedOrigins ?? process.env.ALLOWED_ORIGINS);

  return createServer(async (req, res) => {
    setSecurityHeaders(res);

    if (!hostPolicy(req.headers.host)) return sendJson(res, 421, { error: 'Host header refused.' });
    if (!originPolicy(req.headers.origin)) return sendJson(res, 403, { error: 'Origin refused.' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === HEALTH_ENDPOINT && req.method === 'GET') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (url.pathname !== MCP_ENDPOINT) return sendJson(res, 404, { error: 'Not found.' });
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'This stateless MCP endpoint accepts POST only.' });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    if (!isJsonContentType(req.headers['content-type'])) {
      return sendJson(res, 415, { error: 'Content-Type must be application/json.' });
    }

    const accept = req.headers.accept ?? '*/*';
    if (!accept.includes('*/*') && !accept.includes('application/json')) {
      return sendJson(res, 406, { error: 'This server returns application/json.' });
    }

    let body;
    try {
      body = await readJsonBody(req, MAX_REQUEST_BODY_BYTES);
    } catch (error) {
      return sendJson(res, error.statusCode ?? 400, { error: error.message });
    }

    if (Array.isArray(body)) {
      return sendJson(res, 400, { error: 'Streamable HTTP accepts one JSON-RPC message per POST.' });
    }

    if (!hasSupportedProtocolHeader(req.headers['mcp-protocol-version'], body)) {
      return sendJson(res, 400, { error: 'Unsupported MCP-Protocol-Version header.' });
    }

    const response = await dispatch(body);
    if (!response) {
      res.statusCode = 202;
      return res.end();
    }

    return sendJson(res, 200, response);
  });
}

export async function listen(server, { port = 3000, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

export async function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}


function hasSupportedProtocolHeader(value, body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.method === 'initialize') return true;
  const version = value === undefined ? '2025-03-26' : String(value).trim();
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version);
}

function isJsonContentType(value) {
  if (typeof value !== 'string') return false;
  return value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body exceeds ${maxBytes} bytes.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body is not valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function compileHostPolicy(value) {
  const configured = splitCsv(value);
  if (configured.length > 0) {
    const allowed = new Set(configured.map(normalizeHost));
    return (host) => allowed.has(normalizeHost(host));
  }
  return (host) => {
    const normalized = normalizeHost(host);
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
  };
}

function compileOriginPolicy(value) {
  const configured = splitCsv(value);
  if (configured.length > 0) {
    const allowed = new Set(configured);
    return (origin) => origin === undefined || allowed.has(origin);
  }
  return (origin) => {
    if (origin === undefined) return true;
    try {
      const parsed = new URL(origin);
      return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    } catch {
      return false;
    }
  };
}

function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  if (host.startsWith('[')) return host.replace(/:\d+$/, '').toLowerCase();
  return host.split(':', 1)[0].toLowerCase();
}

function splitCsv(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
