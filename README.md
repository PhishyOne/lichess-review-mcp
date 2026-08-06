# lichess-review-mcp

Read-only MCP server for reviewing completed public Lichess games in ChatGPT. It fetches a game or a small recent-game list and refuses ongoing, missing-status, or unknown-status games.

## Tools

- `get_completed_game`: accepts an eight-character game ID or exact-host `https://lichess.org` game URL.
- `list_recent_completed_games`: accepts a public username and returns 5 games by default, at most 10.

## Safety and cost boundaries

- Read-only; no OAuth, database, move playing, messaging, challenges, or account management.
- No server-side Stockfish or bulk history imports.
- Fixed Lichess origin, one upstream request at a time, bounded queue, 8-second timeout, manual redirect refusal, 512 KiB response limit, no automatic retries, and at least 60 seconds of cooldown after HTTP 429.
- Upstream work waiting longer than 2 seconds to begin is refused instead of remaining in a long queue.
- Small in-memory TTL/LRU caches only.
- Completed-game status allowlist. `created`, `started`, missing, and unknown statuses fail closed.
- Localhost-only Host/Origin defaults. A deployment must explicitly set `ALLOWED_HOSTS` and `ALLOWED_ORIGINS`.
- HTTP backstops separately limit all MCP transport requests and expensive `tools/call` requests. Defaults are 600 transport requests per minute, 120 tool calls per minute, and 8 in-flight tool calls.
- Cheap MCP setup traffic does not consume tool-call rate or concurrency capacity.
- Optional structured request logs contain only a generated request ID, method, route class, response status, and duration. Tool arguments, usernames, game IDs, IP addresses, hosts, origins, and raw paths are not logged.

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

HTTP hardening can be tuned with positive integers:

```sh
HTTP_RATE_LIMIT_REQUESTS=600 \
HTTP_TOOL_RATE_LIMIT_REQUESTS=120 \
HTTP_RATE_LIMIT_WINDOW_MS=60000 \
HTTP_MAX_IN_FLIGHT_TOOL_CALLS=8 \
LOG_REQUESTS=1 \
npm start
```

The built-in limiters are process-wide emergency backstops, not substitutes for per-client limits at a trusted reverse proxy or edge. The `/health` endpoint remains minimal and is excluded from request logs and MCP request limits.

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
