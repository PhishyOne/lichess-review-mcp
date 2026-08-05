import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  HEALTH_ENDPOINT,
  HTTP_HEADERS_TIMEOUT_MS,
  HTTP_KEEP_ALIVE_TIMEOUT_MS,
  HTTP_MAX_IN_FLIGHT_REQUESTS,
  HTTP_MAX_REQUESTS_PER_SOCKET,
  HTTP_RATE_LIMIT_REQUESTS,
  HTTP_RATE_LIMIT_WINDOW_MS,
  HTTP_REQUEST_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MCP_ENDPOINT,
  SUPPORTED_PROTOCOL_VERSIONS
} from './constants.js';

export function createHttpServer({
  dispatch,
  allowedHosts,
  allowedOrigins,
  maxRequestsPerWindow,
  rateLimitWindowMs,
  maxInFlightRequests,
  logger,
  now = () => Date.now()
} = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('dispatch is required.');
  if (typeof now !== 'function') throw new TypeError('now must be a function.');

  const hostPolicy = compileHostPolicy(allowedHosts ?? process.env.ALLOWED_HOSTS);
  const originPolicy = compileOriginPolicy(allowedOrigins ?? process.env.ALLOWED_ORIGINS);
  const requestLogger = compileRequestLogger(logger, process.env.LOG_REQUESTS);
  const limiter = createFixedWindowLimiter({
    limit: parsePositiveInteger(
      maxRequestsPerWindow ?? process.env.HTTP_RATE_LIMIT_REQUESTS,
      HTTP_RATE_LIMIT_REQUESTS,
      'HTTP_RATE_LIMIT_REQUESTS'
    ),
    windowMs: parsePositiveInteger(
      rateLimitWindowMs ?? process.env.HTTP_RATE_LIMIT_WINDOW_MS,
      HTTP_RATE_LIMIT_WINDOW_MS,
      'HTTP_RATE_LIMIT_WINDOW_MS'
    ),
    now
  });
  const maxInFlight = parsePositiveInteger(
    maxInFlightRequests ?? process.env.HTTP_MAX_IN_FLIGHT_REQUESTS,
    HTTP_MAX_IN_FLIGHT_REQUESTS,
    'HTTP_MAX_IN_FLIGHT_REQUESTS'
  );
  let inFlight = 0;

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.maxRequestsPerSocket = HTTP_MAX_REQUESTS_PER_SOCKET;

  return server;

  async function handleRequest(req, res) {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let route = 'other';

    setSecurityHeaders(res);
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => {
      if (route === 'health') return;
      try {
        requestLogger({
          event: 'http_request',
          request_id: requestId,
          method: req.method ?? 'UNKNOWN',
          route,
          status: res.statusCode,
          duration_ms: Math.max(0, Math.round(performance.now() - startedAt))
        });
      } catch {
        // Operational logging must never break request handling.
      }
    });

    try {
      if (!hostPolicy(req.headers.host)) return sendJson(res, 421, { error: 'Host header refused.' });
      if (!originPolicy(req.headers.origin)) return sendJson(res, 403, { error: 'Origin refused.' });

      const url = new URL(req.url ?? '/', 'http://localhost');
      route = classifyRoute(url.pathname);

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

      const rate = limiter.take();
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
        return sendJson(res, 429, { error: 'Request rate limit exceeded. Try again later.' });
      }

      if (inFlight >= maxInFlight) {
        res.setHeader('Retry-After', '1');
        return sendJson(res, 503, { error: 'Server is busy. Try again shortly.' });
      }

      inFlight += 1;
      try {
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
      } finally {
        inFlight -= 1;
      }
    } catch {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      return sendJson(res, 500, { error: 'Internal server error.' });
    }
  }
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

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function createFixedWindowLimiter({ limit, windowMs, now }) {
  let used = 0;
  let resetAt = now() + windowMs;

  return {
    take() {
      const current = now();
      if (current >= resetAt) {
        used = 0;
        resetAt = current + windowMs;
      }
      if (used >= limit) {
        return { allowed: false, retryAfterMs: Math.max(1, resetAt - current) };
      }
      used += 1;
      return { allowed: true, retryAfterMs: 0 };
    }
  };
}

function compileRequestLogger(logger, environmentValue) {
  if (logger !== undefined) {
    if (typeof logger !== 'function') throw new TypeError('logger must be a function.');
    return logger;
  }
  if (!['1', 'true', 'yes'].includes(String(environmentValue ?? '').trim().toLowerCase())) {
    return () => {};
  }
  return (event) => console.log(JSON.stringify(event));
}

function classifyRoute(pathname) {
  if (pathname === HEALTH_ENDPOINT) return 'health';
  if (pathname === MCP_ENDPOINT) return 'mcp';
  return 'other';
}
