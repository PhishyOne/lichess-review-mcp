# lichess-review-mcp

Read-only MCP server for reviewing completed public Lichess games in ChatGPT. It fetches a game or a small recent-game list and refuses ongoing, missing-status, or unknown-status games.

## Tools

- `get_completed_game`: accepts an eight-character game ID or exact-host `https://lichess.org` game URL.
- `list_recent_completed_games`: accepts a public username and returns 5 games by default, at most 10.

## Safety and cost boundaries

- Read-only; no OAuth, database, move playing, messaging, challenges, or account management.
- No server-side Stockfish or bulk history imports.
- Fixed Lichess origin, one upstream request at a time, bounded queue, 8-second timeout, manual redirect refusal, 512 KiB response limit, no automatic retries, and at least 60 seconds of cooldown after HTTP 429.
- Small in-memory TTL/LRU caches only.
- Completed-game status allowlist. `created`, `started`, missing, and unknown statuses fail closed.
- Localhost-only Host/Origin defaults. A deployment must explicitly set `ALLOWED_HOSTS` and `ALLOWED_ORIGINS`.

## Local use

Requires Node.js 22 or newer.

```sh
npm ci
npm run check
npm test
npm run build
npm run smoke
npm start
```

Default endpoints:

- Health: `http://127.0.0.1:3000/health`
- MCP: `http://127.0.0.1:3000/mcp`

For a tunnel or deployment, set exact comma-separated values, for example:

```sh
ALLOWED_HOSTS=example-tunnel.example \
ALLOWED_ORIGINS=https://chatgpt.com \
HOST=0.0.0.0 PORT=3000 npm start
```

Do not deploy publicly until the integration tests, deployment limits, publisher requirements, and support ownership are separately approved.

## Protocol surface

The server implements the stateless JSON-response portion of Streamable HTTP needed for initialization, `ping`, `tools/list`, and `tools/call`. It returns HTTP 202 for notifications and HTTP 405 for unsupported GET/DELETE streaming sessions.

## Documentation

- [Architecture](docs/architecture.md)
- [Threat and cost model](docs/threat-cost-model.md)
- [Acceptance criteria](docs/acceptance-criteria.md)
- [Competitive notes](docs/competitive-notes.md)

## License

MIT
