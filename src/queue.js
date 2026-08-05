import { QueueFullError } from './errors.js';

export class SerialQueue {
  constructor({ maxDepth = 20 } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth < 1) throw new TypeError('maxDepth must be positive.');
    this.maxDepth = maxDepth;
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
      this.pending.push({ task, resolve, reject });
      this.#drain();
    });
  }

  async #drain() {
    if (this.active) return;
    const next = this.pending.shift();
    if (!next) return;

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
