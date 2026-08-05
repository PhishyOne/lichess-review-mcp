import {
  GAME_CACHE_MAX_ENTRIES,
  GAME_CACHE_TTL_MS,
  MAX_QUEUE_DEPTH,
  MAX_RESPONSE_BYTES,
  RATE_LIMIT_COOLDOWN_MS,
  RECENT_CACHE_MAX_ENTRIES,
  RECENT_CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  TERMINAL_STATUSES
} from './constants.js';
import { TtlLruCache } from './cache.js';
import { SerialQueue } from './queue.js';
import { UpstreamError } from './errors.js';
import { normalizeCompletedGame, summarizeCompletedGame } from './normalize.js';

const LICHESS_ORIGIN = 'https://lichess.org';
const USER_AGENT = 'lichess-review-mcp/0.1.0 (+https://github.com/PhishyOne/lichess-review-mcp)';

export class LichessClient {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('A fetch implementation is required.');
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.cooldownMs = options.cooldownMs ?? RATE_LIMIT_COOLDOWN_MS;
    this.cooldownUntil = 0;
    this.queue = options.queue ?? new SerialQueue({ maxDepth: options.maxQueueDepth ?? MAX_QUEUE_DEPTH });
    this.gameCache = options.gameCache ?? new TtlLruCache({
      maxEntries: GAME_CACHE_MAX_ENTRIES,
      ttlMs: GAME_CACHE_TTL_MS,
      now: this.now
    });
    this.recentCache = options.recentCache ?? new TtlLruCache({
      maxEntries: RECENT_CACHE_MAX_ENTRIES,
      ttlMs: RECENT_CACHE_TTL_MS,
      now: this.now
    });
  }

  async getCompletedGame(gameId) {
    const cached = this.gameCache.get(gameId);
    if (cached) return cached;

    return this.queue.enqueue(async () => {
      const secondCheck = this.gameCache.get(gameId);
      if (secondCheck) return secondCheck;

      const url = new URL(`/game/export/${encodeURIComponent(gameId)}`, LICHESS_ORIGIN);
      url.search = new URLSearchParams({
        moves: 'true',
        clocks: 'true',
        evals: 'true',
        opening: 'true',
        literate: 'false',
        pgnInJson: 'true'
      }).toString();

      const text = await this.#requestText(url, 'application/json');
      const raw = parseJson(text);
      const normalized = normalizeCompletedGame(raw);
      this.gameCache.set(gameId, normalized);
      return normalized;
    });
  }

  async listRecentCompletedGames(username, limit) {
    const cacheKey = `${username.toLowerCase()}:${limit}`;
    const cached = this.recentCache.get(cacheKey);
    if (cached) return cached;

    return this.queue.enqueue(async () => {
      const secondCheck = this.recentCache.get(cacheKey);
      if (secondCheck) return secondCheck;

      const url = new URL(`/api/games/user/${encodeURIComponent(username)}`, LICHESS_ORIGIN);
      url.search = new URLSearchParams({
        max: '10',
        moves: 'false',
        clocks: 'false',
        evals: 'false',
        opening: 'true',
        ongoing: 'false',
        finished: 'true',
        pgnInJson: 'false'
      }).toString();

      const text = await this.#requestText(url, 'application/x-ndjson');
      const records = parseNdjson(text);
      const completed = [];
      for (const record of records) {
        if (!TERMINAL_STATUSES.has(record?.status)) continue;
        completed.push(summarizeCompletedGame(record));
        if (completed.length === limit) break;
      }

      const result = { username, count: completed.length, games: completed };
      this.recentCache.set(cacheKey, result);
      return result;
    });
  }

  async #requestText(url, accept) {
    const now = this.now();
    if (now < this.cooldownUntil) {
      const seconds = Math.ceil((this.cooldownUntil - now) / 1000);
      throw new UpstreamError('LICHESS_COOLDOWN', `Lichess requests are paused for another ${seconds} second(s) after a 429 response.`, { status: 503 });
    }

    if (url.origin !== LICHESS_ORIGIN) {
      throw new UpstreamError('FIXED_ORIGIN_VIOLATION', 'Refused a non-Lichess upstream URL.');
    }

    const controller = new AbortController();
    const timer = this.setTimer(() => controller.abort(new Error('timeout')), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': USER_AGENT
        }
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new UpstreamError('LICHESS_TIMEOUT', `Lichess did not respond within ${this.timeoutMs} ms.`, { status: 504, cause: error });
      }
      throw new UpstreamError('LICHESS_NETWORK_ERROR', 'The Lichess request failed.', { cause: error });
    } finally {
      this.clearTimer(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new UpstreamError('LICHESS_REDIRECT_REFUSED', 'Lichess returned a redirect, which is refused.', { status: 502 });
    }

    if (response.status === 429) {
      this.cooldownUntil = this.now() + Math.max(this.cooldownMs, parseRetryAfterMs(response.headers.get('retry-after'), this.now()));
      throw new UpstreamError('LICHESS_RATE_LIMITED', 'Lichess rate-limited the request. Requests are paused for at least 60 seconds.', { status: 503 });
    }

    if (response.status === 404) {
      throw new UpstreamError('LICHESS_NOT_FOUND', 'Lichess did not find the requested game or user.', { status: 404 });
    }

    if (!response.ok) {
      throw new UpstreamError('LICHESS_HTTP_ERROR', `Lichess returned HTTP ${response.status}.`, { status: 502 });
    }

    return readBodyBounded(response, this.maxResponseBytes);
  }
}

export async function readBodyBounded(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('response too large');
        throw new UpstreamError('LICHESS_RESPONSE_TOO_LARGE', `Lichess response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}

export function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new UpstreamError('INVALID_LICHESS_JSON', 'Lichess returned invalid JSON.', { cause: error });
  }
}

export function parseNdjson(text) {
  const records = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw new UpstreamError('INVALID_LICHESS_NDJSON', `Lichess returned invalid NDJSON on line ${index + 1}.`, { cause: error });
    }
  }
  return records;
}

export function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return 0;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}
