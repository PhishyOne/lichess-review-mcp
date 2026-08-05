import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPlainObject,
  parseGameReference,
  parseRecentLimit,
  parseUsername,
  rejectUnknownKeys
} from '../src/validation.js';
import { ValidationError } from '../src/errors.js';

test('accepts an eight-character game ID', () => {
  assert.equal(parseGameReference('Ab12Cd34'), 'Ab12Cd34');
});

test('trims a game ID', () => {
  assert.equal(parseGameReference('  Ab12Cd34  '), 'Ab12Cd34');
});

test('accepts an exact-host Lichess URL', () => {
  assert.equal(parseGameReference('https://lichess.org/Ab12Cd34'), 'Ab12Cd34');
});

test('extracts the first eight characters from a 12-character game URL', () => {
  assert.equal(parseGameReference('https://lichess.org/Ab12Cd34Ef56'), 'Ab12Cd34');
});

test('accepts white and black board suffixes', () => {
  assert.equal(parseGameReference('https://lichess.org/Ab12Cd34/white'), 'Ab12Cd34');
  assert.equal(parseGameReference('https://lichess.org/Ab12Cd34/black'), 'Ab12Cd34');
});

test('rejects non-HTTPS game URLs', () => {
  assert.throws(() => parseGameReference('http://lichess.org/Ab12Cd34'), ValidationError);
});

test('rejects lookalike hosts', () => {
  assert.throws(() => parseGameReference('https://lichess.org.example.com/Ab12Cd34'), ValidationError);
  assert.throws(() => parseGameReference('https://evil-lichess.org/Ab12Cd34'), ValidationError);
});

test('rejects explicit ports', () => {
  assert.throws(() => parseGameReference('https://lichess.org:443/Ab12Cd34'), ValidationError);
});

test('rejects embedded URL credentials', () => {
  assert.throws(() => parseGameReference('https://user:pass@lichess.org/Ab12Cd34'), ValidationError);
});

test('rejects non-game Lichess paths', () => {
  assert.throws(() => parseGameReference('https://lichess.org/@/somebody'), ValidationError);
  assert.throws(() => parseGameReference('https://lichess.org/game/export/Ab12Cd34'), ValidationError);
});

test('rejects unsupported path suffixes', () => {
  assert.throws(() => parseGameReference('https://lichess.org/Ab12Cd34/chat'), ValidationError);
});

test('rejects malformed game IDs', () => {
  for (const value of ['short', 'Ab12Cd3!', 'Ab12Cd345', '', null, 123]) {
    assert.throws(() => parseGameReference(value), ValidationError);
  }
});

test('accepts valid usernames', () => {
  assert.equal(parseUsername('Phishy_One-2'), 'Phishy_One-2');
});

test('trims usernames', () => {
  assert.equal(parseUsername('  PhishyOne  '), 'PhishyOne');
});

test('rejects invalid usernames', () => {
  for (const value of ['x', 'has space', 'has.dot', '', null, 42, 'a'.repeat(31)]) {
    assert.throws(() => parseUsername(value), ValidationError);
  }
});

test('defaults the recent-game limit to five', () => {
  assert.equal(parseRecentLimit(undefined), 5);
  assert.equal(parseRecentLimit(null), 5);
});

test('accepts recent-game limits from one through ten', () => {
  assert.equal(parseRecentLimit(1), 1);
  assert.equal(parseRecentLimit(10), 10);
});

test('rejects invalid recent-game limits', () => {
  for (const value of [0, 11, 1.5, '5', NaN]) {
    assert.throws(() => parseRecentLimit(value), ValidationError);
  }
});

test('assertPlainObject accepts only plain object-shaped inputs', () => {
  assert.deepEqual(assertPlainObject({ game: 'Ab12Cd34' }), { game: 'Ab12Cd34' });
  for (const value of [null, [], 'x', 1]) {
    assert.throws(() => assertPlainObject(value), ValidationError);
  }
});

test('rejectUnknownKeys reports unexpected arguments', () => {
  assert.doesNotThrow(() => rejectUnknownKeys({ game: 'Ab12Cd34' }, ['game']));
  assert.throws(() => rejectUnknownKeys({ game: 'Ab12Cd34', url: 'x' }, ['game']), /Unknown argument: url/);
});
