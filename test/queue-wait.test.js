import test from 'node:test';
import assert from 'node:assert/strict';
import { QueueWaitTimeoutError } from '../src/errors.js';
import { SerialQueue } from '../src/queue.js';

test('serial queue rejects work that cannot start before the wait deadline', async () => {
  const queue = new SerialQueue({ maxDepth: 3, maxWaitMs: 20 });
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const first = queue.enqueue(() => blocker);
  const second = queue.enqueue(async () => 2);

  await assert.rejects(second, (error) => {
    assert.ok(error instanceof QueueWaitTimeoutError);
    assert.equal(error.code, 'QUEUE_WAIT_TIMEOUT');
    return true;
  });

  release(1);
  assert.equal(await first, 1);
  assert.equal(queue.depth, 0);
});

test('serial queue constructor rejects an invalid wait deadline', () => {
  assert.throws(() => new SerialQueue({ maxWaitMs: 0 }), TypeError);
});
