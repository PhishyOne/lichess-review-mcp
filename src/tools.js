import { LichessClient } from './lichess-client.js';
import { assertPlainObject, parseGameReference, parseRecentLimit, parseUsername, rejectUnknownKeys } from './validation.js';

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'get_completed_game',
    title: 'Get completed Lichess game',
    description: 'Fetch one public completed Lichess game by eight-character ID or exact-host Lichess URL. Refuses live, missing-status, and unknown-status games.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['game'],
      properties: {
        game: {
          type: 'string',
          description: 'An eight-character Lichess game ID or an https://lichess.org game URL.'
        }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  {
    name: 'list_recent_completed_games',
    title: 'List recent completed Lichess games',
    description: 'List a bounded set of a public Lichess user’s newest completed games. Defaults to 5 and allows at most 10.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['username'],
      properties: {
        username: {
          type: 'string',
          minLength: 2,
          maxLength: 30,
          description: 'Public Lichess username.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5
        }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }
]);

export function createToolHandlers({ client = new LichessClient() } = {}) {
  return {
    async get_completed_game(args) {
      const object = assertPlainObject(args);
      rejectUnknownKeys(object, ['game']);
      const gameId = parseGameReference(object.game);
      return client.getCompletedGame(gameId);
    },

    async list_recent_completed_games(args) {
      const object = assertPlainObject(args);
      rejectUnknownKeys(object, ['username', 'limit']);
      const username = parseUsername(object.username);
      const limit = parseRecentLimit(object.limit);
      return client.listRecentCompletedGames(username, limit);
    }
  };
}
