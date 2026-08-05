#!/usr/bin/env bash
set -euo pipefail

npm run build

HOST=127.0.0.1 PORT=3000 node dist/index.js > /tmp/lichess-review-mcp.log 2>&1 &
server_pid=$!
cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT

for _ in {1..30}; do
  if curl --fail --silent http://127.0.0.1:3000/health >/dev/null; then
    break
  fi
  sleep 0.2
done
curl --fail --silent http://127.0.0.1:3000/health >/dev/null

output="$({ npx -y @modelcontextprotocol/inspector@2.0.0 --cli \
  http://127.0.0.1:3000/mcp \
  --transport http \
  --method tools/list; } 2>&1)"
printf '%s\n' "$output"

grep -Fq 'get_completed_game' <<<"$output"
grep -Fq 'list_recent_completed_games' <<<"$output"
