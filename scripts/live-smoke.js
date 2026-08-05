import assert from 'node:assert/strict';
import { LichessClient } from '../src/lichess-client.js';
import { LIVE_STATUSES, TERMINAL_STATUSES } from '../src/constants.js';

const GAME_ID = process.env.LICHESS_SMOKE_GAME_ID ?? '8fuPHGyu';
const USERNAME = process.env.LICHESS_SMOKE_USERNAME ?? 'perfectpatzer';

const client = new LichessClient();

const game = await client.getCompletedGame(GAME_ID);
assert.equal(game.id, GAME_ID);
assert.ok(TERMINAL_STATUSES.has(game.status));
assert.ok(!LIVE_STATUSES.has(game.status));
assert.match(game.url, /^https:\/\/lichess\.org\/[A-Za-z0-9]{8}$/);

const recent = await client.listRecentCompletedGames(USERNAME, 1);
assert.equal(recent.username, USERNAME);
assert.ok(recent.count >= 0 && recent.count <= 1);
assert.equal(recent.games.length, recent.count);
for (const item of recent.games) {
  assert.ok(TERMINAL_STATUSES.has(item.status));
  assert.ok(!LIVE_STATUSES.has(item.status));
}

console.log(JSON.stringify({
  status: 'ok',
  game: { id: game.id, status: game.status },
  recent: { username: recent.username, count: recent.count }
}));
