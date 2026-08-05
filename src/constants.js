export const SERVER_NAME = 'lichess-review-mcp';
export const SERVER_VERSION = '0.1.0';
export const MCP_ENDPOINT = '/mcp';
export const HEALTH_ENDPOINT = '/health';

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26'
]);

export const TERMINAL_STATUSES = new Set([
  'aborted',
  'mate',
  'resign',
  'stalemate',
  'timeout',
  'draw',
  'outoftime',
  'cheat',
  'noStart',
  'unknownFinish',
  'variantEnd'
]);

export const LIVE_STATUSES = new Set(['created', 'started']);

export const DEFAULT_RECENT_LIMIT = 5;
export const MAX_RECENT_LIMIT = 10;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;
export const REQUEST_TIMEOUT_MS = 8_000;
export const RATE_LIMIT_COOLDOWN_MS = 60_000;
export const MAX_QUEUE_DEPTH = 20;
export const GAME_CACHE_TTL_MS = 5 * 60_000;
export const RECENT_CACHE_TTL_MS = 30_000;
export const GAME_CACHE_MAX_ENTRIES = 100;
export const RECENT_CACHE_MAX_ENTRIES = 50;

export const HTTP_RATE_LIMIT_REQUESTS = 120;
export const HTTP_RATE_LIMIT_WINDOW_MS = 60_000;
export const HTTP_MAX_IN_FLIGHT_REQUESTS = 8;
export const HTTP_REQUEST_TIMEOUT_MS = 10_000;
export const HTTP_HEADERS_TIMEOUT_MS = 5_000;
export const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5_000;
export const HTTP_MAX_REQUESTS_PER_SOCKET = 100;
