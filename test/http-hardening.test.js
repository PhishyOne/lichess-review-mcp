import test from 'node:test';
import assert from 'node:assert/strict';
import { close, createHttpServer, listen } from '../src/http-server.js';

async function withServer(callback, options = {}) {
  const dispatch = options.dispatch ?? (async (message) => ({
    jsonrpc: '2.0',
    id: message.id,
    result: {}
  }));
  const server = createHttpServer({
    dispatch,
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: options.allowedOrigins ?? [],
    maxRequestsPerWindow: options.maxRequestsPerWindow,
    rateLimitWindowMs: options.rateLimitWindowMs,
    maxInFlightRequests: options.maxInFlightRequests,
    logger: options.logger,
    now: options.now
  });
  const address = await listen(server, { port: 0, host: '127.0.0.1' });
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

function post(base, body, headers = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };

test('global MCP request limiter returns 429 with Retry-After and resets after its window', async () => {
  let currentTime = 1_000;
  await withServer(async (base) => {
    assert.equal((await post(base, ping)).status, 200);
    assert.equal((await post(base, { ...ping, id: 2 })).status, 200);

    const refused = await post(base, { ...ping, id: 3 });
    assert.equal(refused.status, 429);
    assert.equal(refused.headers.get('retry-after'), '1');
    assert.deepEqual(await refused.json(), { error: 'Request rate limit exceeded. Try again later.' });

    assert.equal((await fetch(`${base}/health`)).status, 200);

    currentTime += 1_000;
    assert.equal((await post(base, { ...ping, id: 4 })).status, 200);
  }, {
    maxRequestsPerWindow: 2,
    rateLimitWindowMs: 1_000,
    now: () => currentTime
  });
});

test('concurrency guard rejects excess in-flight MCP requests without growing work', async () => {
  let releaseHandler;
  const blocked = new Promise((resolve) => { releaseHandler = resolve; });
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const dispatch = async (message) => {
    if (message.method === 'tools/call') {
      markStarted();
      await blocked;
    }
    return { jsonrpc: '2.0', id: message.id, result: {} };
  };

  await withServer(async (base) => {
    const first = post(base, {
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'get_completed_game', arguments: { game: 'Ab12Cd34' } }
    });
    await started;

    const refused = await post(base, { ...ping, id: 11 });
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get('retry-after'), '1');
    assert.deepEqual(await refused.json(), { error: 'Server is busy. Try again shortly.' });

    releaseHandler();
    assert.equal((await first).status, 200);
  }, { dispatch, maxInFlightRequests: 1 });
});

test('request logs contain operational metadata but no tool arguments, hosts, origins, or raw paths', async () => {
  const events = [];
  await withServer(async (base) => {
    const marker = 'Ab12Cd34';
    const response = await post(base, {
      jsonrpc: '2.0', id: 20, method: 'tools/call',
      params: { name: 'get_completed_game', arguments: { game: marker } }
    }, { origin: 'https://chatgpt.com' });
    assert.equal(response.status, 200);
    await response.text();

    const hiddenPath = await fetch(`${base}/private-username-path`);
    assert.equal(hiddenPath.status, 404);
    await hiddenPath.text();

    assert.equal((await fetch(`${base}/health`)).status, 200);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'http_request');
    assert.equal(events[0].method, 'POST');
    assert.equal(events[0].route, 'mcp');
    assert.equal(events[0].status, 200);
    assert.equal(typeof events[0].request_id, 'string');
    assert.equal(typeof events[0].duration_ms, 'number');
    assert.equal(events[1].route, 'other');
    assert.equal(events[1].status, 404);

    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(marker), false);
    assert.equal(serialized.includes('chatgpt.com'), false);
    assert.equal(serialized.includes('127.0.0.1'), false);
    assert.equal(serialized.includes('private-username-path'), false);
  }, { logger: (event) => events.push(event), allowedOrigins: ['https://chatgpt.com'] });
});

test('a failing operational logger cannot break request handling', async () => {
  await withServer(async (base) => {
    const response = await post(base, ping);
    assert.equal(response.status, 200);
  }, { logger: () => { throw new Error('logger unavailable'); } });
});

test('responses include a generated request ID and conservative security headers', async () => {
  await withServer(async (base) => {
    const response = await post(base, ping);
    assert.match(response.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  });
});
