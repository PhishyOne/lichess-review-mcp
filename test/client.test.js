import test from 'node:test';
import assert from 'node:assert/strict';
import { LichessClient, parseJson, parseNdjson, parseRetryAfterMs, readBodyBounded } from '../src/lichess-client.js';
import { LiveGameError, UnknownGameStatusError, UpstreamError } from '../src/errors.js';
import { assertTerminalStatus, normalizeCompletedGame } from '../src/normalize.js';

const completedGame = {
  id: 'Ab12Cd34',
  rated: true,
  variant: 'standard',
  speed: 'blitz',
  perf: 'blitz',
  createdAt: 100,
  lastMoveAt: 200,
  turns: 42,
  status: 'mate',
  winner: 'white',
  players: {
    white: { userId: 'PhishyOne', rating: 1700 },
    black: { user: { name: 'Opponent' }, rating: 1650 }
  },
  opening: { eco: 'C20', name: "King's Pawn Game" },
  pgn: '[Event "rated blitz game"]\n\n1. e4 e5 1-0',
  moves: 'e4 e5'
};

function response(body, init = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

test('normalizes direct userId player names', () => {
  const game = normalizeCompletedGame(completedGame);
  assert.equal(game.players.white.name, 'PhishyOne');
  assert.equal(game.players.black.name, 'Opponent');
});

test('accepts every documented terminal status', () => {
  for (const status of ['aborted', 'mate', 'resign', 'stalemate', 'timeout', 'draw', 'outoftime', 'cheat', 'noStart', 'unknownFinish', 'variantEnd']) {
    assert.equal(assertTerminalStatus(status), status);
  }
});

test('refuses live statuses', () => {
  assert.throws(() => assertTerminalStatus('created'), LiveGameError);
  assert.throws(() => assertTerminalStatus('started'), LiveGameError);
});

test('refuses missing and unknown statuses', () => {
  assert.throws(() => assertTerminalStatus(undefined), UnknownGameStatusError);
  assert.throws(() => assertTerminalStatus('futureStatus'), UnknownGameStatusError);
});

test('getCompletedGame uses the fixed endpoint and bounded options', async () => {
  let seen;
  const client = new LichessClient({
    fetch: async (url, init) => {
      seen = { url: String(url), init };
      return response(JSON.stringify(completedGame));
    }
  });
  const game = await client.getCompletedGame('Ab12Cd34');
  assert.equal(game.id, 'Ab12Cd34');
  assert.match(seen.url, /^https:\/\/lichess\.org\/game\/export\/Ab12Cd34\?/);
  assert.match(seen.url, /pgnInJson=true/);
  assert.equal(seen.init.redirect, 'manual');
  assert.equal(seen.init.headers.Accept, 'application/json');
});

test('getCompletedGame caches completed results', async () => {
  let calls = 0;
  const client = new LichessClient({ fetch: async () => { calls += 1; return response(JSON.stringify(completedGame)); } });
  await client.getCompletedGame('Ab12Cd34');
  await client.getCompletedGame('Ab12Cd34');
  assert.equal(calls, 1);
});

test('live games are not cached or returned', async () => {
  let calls = 0;
  const client = new LichessClient({ fetch: async () => { calls += 1; return response(JSON.stringify({ ...completedGame, status: 'started' })); } });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), LiveGameError);
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), LiveGameError);
  assert.equal(calls, 2);
});

test('invalid JSON is reported as an upstream error', async () => {
  const client = new LichessClient({ fetch: async () => response('{bad') });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'INVALID_LICHESS_JSON');
});

test('redirects are refused without following them', async () => {
  const client = new LichessClient({ fetch: async () => response('', { status: 302, headers: { location: 'https://evil.example/' } }) });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_REDIRECT_REFUSED');
});

test('HTTP 429 starts a minimum cooldown and prevents another fetch', async () => {
  let now = 1000;
  let calls = 0;
  const client = new LichessClient({
    now: () => now,
    fetch: async () => { calls += 1; return response('', { status: 429 }); }
  });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_RATE_LIMITED');
  await assert.rejects(client.getCompletedGame('Ef56Gh78'), (error) => error.code === 'LICHESS_COOLDOWN');
  assert.equal(calls, 1);
  now += 60_000;
  await assert.rejects(client.getCompletedGame('Ef56Gh78'), (error) => error.code === 'LICHESS_RATE_LIMITED');
  assert.equal(calls, 2);
});

test('Retry-After longer than a minute extends cooldown', async () => {
  let now = 0;
  const client = new LichessClient({
    now: () => now,
    fetch: async () => response('', { status: 429, headers: { 'retry-after': '120' } })
  });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'));
  now = 61_000;
  await assert.rejects(client.getCompletedGame('Ef56Gh78'), (error) => error.code === 'LICHESS_COOLDOWN');
});

test('404 and other HTTP failures are distinguished', async () => {
  const missing = new LichessClient({ fetch: async () => response('', { status: 404 }) });
  await assert.rejects(missing.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_NOT_FOUND' && error.status === 404);
  const broken = new LichessClient({ fetch: async () => response('', { status: 500 }) });
  await assert.rejects(broken.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_HTTP_ERROR');
});

test('response bodies are capped before full buffering', async () => {
  const client = new LichessClient({ maxResponseBytes: 5, fetch: async () => response('123456') });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_RESPONSE_TOO_LARGE');
});

test('request timeout aborts the upstream request', async () => {
  const client = new LichessClient({
    timeoutMs: 5,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    })
  });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_TIMEOUT');
});

test('network errors are wrapped', async () => {
  const client = new LichessClient({ fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(client.getCompletedGame('Ab12Cd34'), (error) => error.code === 'LICHESS_NETWORK_ERROR');
});

test('recent games use NDJSON, filter nonterminal records, and honor limit', async () => {
  let seen;
  const lines = [
    { ...completedGame, id: 'Aa11Bb22', status: 'started' },
    { ...completedGame, id: 'Cc33Dd44', status: 'mate' },
    { ...completedGame, id: 'Ee55Ff66', status: 'resign' },
    { ...completedGame, id: 'Gg77Hh88', status: 'draw' }
  ].map(JSON.stringify).join('\n');
  const client = new LichessClient({ fetch: async (url, init) => { seen = { url: String(url), init }; return response(lines, { headers: { 'content-type': 'application/x-ndjson' } }); } });
  const result = await client.listRecentCompletedGames('PhishyOne', 2);
  assert.equal(result.count, 2);
  assert.deepEqual(result.games.map((game) => game.id), ['Cc33Dd44', 'Ee55Ff66']);
  assert.match(seen.url, /^https:\/\/lichess\.org\/api\/games\/user\/PhishyOne\?/);
  assert.match(seen.url, /max=10/);
  assert.equal(seen.init.headers.Accept, 'application/x-ndjson');
});

test('recent-game results are cached by normalized username and limit key', async () => {
  let calls = 0;
  const client = new LichessClient({ fetch: async () => { calls += 1; return response(`${JSON.stringify(completedGame)}\n`); } });
  await client.listRecentCompletedGames('PhishyOne', 5);
  await client.listRecentCompletedGames('phishyone', 5);
  assert.equal(calls, 1);
});

test('invalid NDJSON identifies the bad line', () => {
  assert.throws(() => parseNdjson('{}\nnot-json\n{}'), /line 2/);
});

test('JSON parser wraps syntax errors', () => {
  assert.throws(() => parseJson('{'), (error) => error instanceof UpstreamError && error.code === 'INVALID_LICHESS_JSON');
});

test('Retry-After parser accepts seconds and HTTP dates', () => {
  assert.equal(parseRetryAfterMs('60', 0), 60_000);
  assert.equal(parseRetryAfterMs('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60_000);
  assert.equal(parseRetryAfterMs('nonsense', 0), 0);
});

test('bounded body reader handles an empty body', async () => {
  assert.equal(await readBodyBounded(new Response(null), 10), '');
});

test('client serializes upstream fetches', async () => {
  let active = 0;
  let maxActive = 0;
  const client = new LichessClient({
    fetch: async (url) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const id = String(url).match(/export\/([A-Za-z0-9]{8})/)?.[1] ?? 'Ab12Cd34';
      return response(JSON.stringify({ ...completedGame, id }));
    }
  });
  await Promise.all([client.getCompletedGame('Ab12Cd34'), client.getCompletedGame('Ef56Gh78')]);
  assert.equal(maxActive, 1);
});
