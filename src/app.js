import { createHttpServer } from './http-server.js';
import { createMcpDispatcher } from './mcp.js';
import { createToolHandlers } from './tools.js';

export function createApp(options = {}) {
  const handlers = options.handlers ?? createToolHandlers({ client: options.client });
  const dispatch = createMcpDispatcher({ handlers });
  return createHttpServer({
    dispatch,
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins,
    maxRequestsPerWindow: options.maxRequestsPerWindow,
    maxToolCallsPerWindow: options.maxToolCallsPerWindow,
    rateLimitWindowMs: options.rateLimitWindowMs,
    maxInFlightToolCalls: options.maxInFlightToolCalls,
    logger: options.logger,
    now: options.now
  });
}
