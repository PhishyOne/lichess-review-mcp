import { MAX_QUEUE_DEPTH, MAX_QUEUE_WAIT_MS } from './constants.js';
import { QueueFullError, QueueWaitTimeoutError } from './errors.js';

export class SerialQueue {
  constructor({ maxDepth = MAX_QUEUE_DEPTH, maxWaitMs = MAX_QUEUE_WAIT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new TypeError('maxDepth must be positive.');
    if (!Number.isInteger(maxWaitMs) || maxWaitMs < 1) throw new TypeError('maxWaitMs must be positive.');
    if (typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new TypeError('setTimer and clearTimer must be functions.');
    }
    this.maxDepth = maxDepth;
    this.maxWaitMs = maxWaitMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.pending = [];
    this.active = false;
  }

  get depth() {
    return this.pending.length + (this.active ? 1 : 0);
  }

  enqueue(task) {
    if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function.'));
    if (this.depth >= this.maxDepth) return Promise.reject(new QueueFullError());

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, timer: undefined };
      entry.timer = this.setTimer(() => {
        const index = this.pending.indexOf(entry);
        if (index === -1) return;
        this.pending.splice(index, 1);
        reject(new QueueWaitTimeoutError(this.maxWaitMs));
        queueMicrotask(() => this.#drain());
      }, this.maxWaitMs);
      this.pending.push(entry);
      this.#drain();
    });
  }

  async #drain() {
    if (this.active) return;
    const next = this.pending.shift();
    if (!next) return;

    this.clearTimer(next.timer);
    this.active = true;
    try {
      next.resolve(await next.task());
    } catch (error) {
      next.reject(error);
    } finally {
      this.active = false;
      queueMicrotask(() => this.#drain());
    }
  }
}
