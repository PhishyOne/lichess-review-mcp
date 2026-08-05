# Architecture

The service is one stateless Node.js HTTP process with no external storage.

1. `/mcp` validates Host, Origin, method, content type, accept type, and a 64 KiB request-body ceiling.
2. The MCP dispatcher exposes exactly two read-only tools.
3. Tool handlers validate and normalize IDs, exact-host URLs, usernames, limits, and unknown keys.
4. A single bounded FIFO serializes every Lichess request.
5. The Lichess client permits only `https://lichess.org`, refuses redirects, times out after 8 seconds, caps bodies at 512 KiB, and enters a minimum 60-second cooldown after a 429.
6. Records pass through a completed-status allowlist before moves, clocks, PGN, or analysis can leave the service.
7. Small process-local TTL/LRU caches reduce duplicate traffic. Restarts safely clear them.

The process is suitable for a scale-to-zero service with one maximum instance, but no deployment is authorized by this repository alone.
