import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlLruCache } from '../src/cache.js';
import { SerialQueue } from '../src/queue.js';
import { QueueFullError } from '../src/errors.js';

test('cache stores and retrieves values', () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
});

test('cache expires values at the TTL boundary', () => {
  let now = 0;
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 10, now: () => now });
  cache.set('a', 1);
  now = 9;
  assert.equal(cache.get('a'), 1);
  now = 10;
  assert.equal(cache.get('a'), undefined);
});

test('cache evicts the least recently used value', () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  cache.set('a', 1).set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('cache overwrite refreshes insertion order and value', () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  cache.set('a', 1).set('b', 2).set('a', 3).set('c', 4);
  assert.equal(cache.get('a'), 3);
  assert.equal(cache.get('b'), undefined);
});

test('cache delete and clear remove entries', () => {
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 1000 });
  cache.set('a', 1).set('b', 2);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.get('a'), undefined);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('cache size prunes expired entries', () => {
  let now = 0;
  const cache = new TtlLruCache({ maxEntries: 2, ttlMs: 10, now: () => now });
  cache.set('a', 1);
  now = 20;
  assert.equal(cache.size, 0);
});

test('cache constructor rejects invalid limits', () => {
  assert.throws(() => new TtlLruCache({ maxEntries: 0, ttlMs: 10 }), TypeError);
  assert.throws(() => new TtlLruCache({ maxEntries: 1, ttlMs: 0 }), TypeError);
});

test('serial queue never runs two tasks concurrently', async () => {
  const queue = new SerialQueue({ maxDepth: 5 });
  let active = 0;
  let maxActive = 0;
  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  };
  await Promise.all([queue.enqueue(task), queue.enqueue(task), queue.enqueue(task)]);
  assert.equal(maxActive, 1);
});

test('serial queue preserves FIFO order', async () => {
  const queue = new SerialQueue({ maxDepth: 5 });
  const order = [];
  await Promise.all([
    queue.enqueue(async () => order.push(1)),
    queue.enqueue(async () => order.push(2)),
    queue.enqueue(async () => order.push(3))
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

test('serial queue continues after a task rejects', async () => {
  const queue = new SerialQueue({ maxDepth: 5 });
  const failed = queue.enqueue(async () => { throw new Error('boom'); });
  const succeeded = queue.enqueue(async () => 42);
  await assert.rejects(failed, /boom/);
  assert.equal(await succeeded, 42);
});

test('serial queue enforces total active-plus-pending depth', async () => {
  const queue = new SerialQueue({ maxDepth: 2 });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = queue.enqueue(() => blocker);
  const second = queue.enqueue(async () => 2);
  await assert.rejects(queue.enqueue(async () => 3), QueueFullError);
  release(1);
  assert.equal(await first, 1);
  assert.equal(await second, 2);
});

test('serial queue rejects non-function tasks', async () => {
  const queue = new SerialQueue();
  await assert.rejects(queue.enqueue('nope'), TypeError);
});

test('serial queue constructor rejects invalid depth', () => {
  assert.throws(() => new SerialQueue({ maxDepth: 0 }), TypeError);
});
