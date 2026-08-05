import { SERVER_NAME, SERVER_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from './constants.js';
import { AppError, ValidationError } from './errors.js';
import { TOOL_DEFINITIONS } from './tools.js';

export function createMcpDispatcher({ handlers }) {
  if (!handlers || typeof handlers !== 'object') throw new TypeError('handlers are required.');

  return async function dispatch(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return jsonRpcError(null, -32600, 'Invalid Request');
    }

    const id = Object.hasOwn(message, 'id') ? message.id : undefined;
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return id === undefined ? null : jsonRpcError(id ?? null, -32600, 'Invalid Request');
    }

    try {
      switch (message.method) {
        case 'initialize':
          return id === undefined ? null : jsonRpcResult(id, initializeResult(message.params));
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return id === undefined ? null : jsonRpcResult(id, {});
        case 'tools/list':
          return id === undefined ? null : jsonRpcResult(id, { tools: TOOL_DEFINITIONS });
        case 'tools/call':
          return id === undefined ? null : jsonRpcResult(id, await callTool(message.params, handlers));
        default:
          return id === undefined ? null : jsonRpcError(id, -32601, 'Method not found');
      }
    } catch (error) {
      if (id === undefined) return null;
      if (error instanceof AppError) {
        return jsonRpcResult(id, toolErrorResult(error));
      }
      return jsonRpcError(id, -32603, 'Internal error');
    }
  };
}

function initializeResult(params) {
  const requested = params && typeof params === 'object' ? params.protocolVersion : undefined;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0];

  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: 'Read-only post-game review service. It refuses ongoing, missing-status, and unknown-status games.'
  };
}

async function callTool(params, handlers) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ValidationError('tools/call params must be an object.');
  }
  if (typeof params.name !== 'string' || !(params.name in handlers)) {
    throw new ValidationError('Unknown tool name.');
  }
  const result = await handlers[params.name](params.arguments ?? {});
  const text = JSON.stringify(result);
  return {
    content: [{ type: 'text', text }],
    structuredContent: result,
    isError: false
  };
}

function toolErrorResult(error) {
  const payload = { error: { code: error.code, message: error.expose ? error.message : 'Request failed.' } };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true
  };
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data }
  };
}
