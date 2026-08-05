import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { close, listen } from '../dist/http-server.js';

const handlers = {
  get_completed_game: async ({ game }) => ({ id: game, status: 'mate' }),
  list_recent_completed_games: async ({ username, limit = 5 }) => ({ username, count: limit, games: [] })
};

const server = createApp({ handlers, allowedHosts: ['127.0.0.1'] });
const address = await listen(server, { host: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const initialize = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'smoke-test', version: '1.0.0' }
    }
  });
  assert.equal(initialize.result.protocolVersion, '2025-06-18');

  const tools = await post(
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { 'mcp-protocol-version': '2025-06-18' }
  );
  assert.deepEqual(tools.result.tools.map((tool) => tool.name), [
    'get_completed_game',
    'list_recent_completed_games'
  ]);

  console.log('Smoke test passed: health, initialize, and exactly two tools.');
} finally {
  await close(server);
}

async function post(body, extraHeaders = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
  assert.equal(response.status, 200);
  return response.json();
}
