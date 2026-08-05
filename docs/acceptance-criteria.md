# MVP acceptance criteria

- Exactly two MCP tools are discoverable.
- Game IDs and exact-host Lichess URLs normalize to one eight-character ID.
- Lookalike hosts, non-HTTPS URLs, arbitrary paths, invalid usernames, unknown arguments, and limits above 10 are rejected.
- `created`, `started`, missing, and unknown statuses are refused.
- Every recognized terminal status is accepted.
- Upstream calls are serialized and queue depth is bounded.
- Redirects are refused; timeout and 512 KiB limits are enforced.
- HTTP 429 triggers at least 60 seconds of global cooldown and no automatic retry.
- Health, initialization, tool discovery, tool calls, notifications, malformed JSON, content type, Host, Origin, and body limits are tested.
- `npm run check`, `npm test`, and `npm run build` pass.
- No deployment, publication, OAuth, database, server engine, or paid infrastructure is included.
