import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { close, listen } from '../src/http-server.js';
import { ValidationError } from '../src/errors.js';

async function withServer(callback, options = {}) {
  const handlers = options.handlers ?? {
    get_completed_game: async ({ game }) => ({ id: game, status: 'mate' }),
    list_recent_completed_games: async ({ username, limit = 5 }) => ({ username, count: limit, games: [] })
  };
  const server = createApp({ handlers, allowedHosts: ['127.0.0.1'], allowedOrigins: options.allowedOrigins ?? [] });
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
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

test('health endpoint returns ok', async () => withServer(async (base) => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
}));

test('unknown paths return 404', async () => withServer(async (base) => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
}));

test('MCP GET and DELETE are refused with 405', async () => withServer(async (base) => {
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 405);
}));

test('non-JSON content type is refused', async () => withServer(async (base) => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
}));

test('unacceptable response type is refused', async () => withServer(async (base) => {
  const res = await post(base, { jsonrpc: '2.0', id: 1, method: 'ping' }, { accept: 'text/plain' });
  assert.equal(res.status, 406);
}));

test('malformed JSON is refused', async () => withServer(async (base) => {
  const res = await post(base, '{bad');
  assert.equal(res.status, 400);
}));

test('oversized request bodies are refused', async () => withServer(async (base) => {
  const res = await post(base, JSON.stringify({ data: 'x'.repeat(70 * 1024) }));
  assert.equal(res.status, 413);
}));

test('initialize negotiates a supported protocol and advertises tools', async () => withServer(async (base) => {
  const res = await post(base, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
  });
  const body = await res.json();
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(body.result.serverInfo.name, 'lichess-review-mcp');
}));

test('initialize falls back safely for an unknown protocol version', async () => withServer(async (base) => {
  const body = await (await post(base, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future' } })).json();
  assert.equal(body.result.protocolVersion, '2025-11-25');
}));

test('initialized notification returns HTTP 202 with no body', async () => withServer(async (base) => {
  const res = await post(base, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(res.status, 202);
  assert.equal(await res.text(), '');
}));

test('tools/list exposes exactly the two intended tools', async () => withServer(async (base) => {
  const body = await (await post(base, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })).json();
  assert.deepEqual(body.result.tools.map((tool) => tool.name), ['get_completed_game', 'list_recent_completed_games']);
  assert.ok(body.result.tools.every((tool) => tool.annotations.readOnlyHint === true));
}));

test('tools/call returns text and structured content', async () => withServer(async (base) => {
  const body = await (await post(base, {
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'get_completed_game', arguments: { game: 'Ab12Cd34' } }
  })).json();
  assert.equal(body.result.isError, false);
  assert.equal(body.result.structuredContent.id, 'Ab12Cd34');
  assert.equal(JSON.parse(body.result.content[0].text).status, 'mate');
}));

test('tool application errors become MCP tool errors', async () => {
  const handlers = {
    get_completed_game: async () => { throw new ValidationError('bad game'); },
    list_recent_completed_games: async () => ({ games: [] })
  };
  await withServer(async (base) => {
    const body = await (await post(base, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_completed_game', arguments: { game: 'bad' } }
    })).json();
    assert.equal(body.result.isError, true);
    assert.equal(body.result.structuredContent.error.code, 'INVALID_ARGUMENT');
  }, { handlers });
});

test('unknown methods return JSON-RPC method-not-found', async () => withServer(async (base) => {
  const body = await (await post(base, { jsonrpc: '2.0', id: 5, method: 'resources/list' })).json();
  assert.equal(body.error.code, -32601);
}));

test('invalid JSON-RPC requests return invalid-request', async () => withServer(async (base) => {
  const body = await (await post(base, { id: 6, method: 'ping' })).json();
  assert.equal(body.error.code, -32600);
}));

test('ping returns an empty result', async () => withServer(async (base) => {
  const body = await (await post(base, { jsonrpc: '2.0', id: 7, method: 'ping' })).json();
  assert.deepEqual(body.result, {});
}));

test('JSON-RPC batches are refused because Streamable HTTP requires one message per POST', async () => withServer(async (base) => {
  const res = await post(base, [
    { jsonrpc: '2.0', id: 8, method: 'ping' },
    { jsonrpc: '2.0', id: 9, method: 'tools/list' }
  ]);
  assert.equal(res.status, 400);
}));

test('empty JSON-RPC batches are refused', async () => withServer(async (base) => {
  const res = await post(base, []);
  assert.equal(res.status, 400);
}));

test('subsequent requests accept a supported MCP protocol version header', async () => withServer(async (base) => {
  const res = await post(
    base,
    { jsonrpc: '2.0', id: 12, method: 'ping' },
    { 'mcp-protocol-version': '2025-11-25' }
  );
  assert.equal(res.status, 200);
}));

test('subsequent requests reject an unsupported MCP protocol version header', async () => withServer(async (base) => {
  const res = await post(
    base,
    { jsonrpc: '2.0', id: 13, method: 'ping' },
    { 'mcp-protocol-version': '2099-01-01' }
  );
  assert.equal(res.status, 400);
}));

test('configured Origin policy refuses an unlisted origin', async () => withServer(async (base) => {
  const res = await post(base, { jsonrpc: '2.0', id: 10, method: 'ping' }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
}, { allowedOrigins: ['https://chatgpt.com'] }));

test('configured Origin policy permits an exact origin', async () => withServer(async (base) => {
  const res = await post(base, { jsonrpc: '2.0', id: 11, method: 'ping' }, { origin: 'https://chatgpt.com' });
  assert.equal(res.status, 200);
}, { allowedOrigins: ['https://chatgpt.com'] }));
