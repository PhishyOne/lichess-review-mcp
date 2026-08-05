# Threat and cost model

## Protected goals

- Never provide assistance for an ongoing or uncertain game.
- Never become an arbitrary HTTP proxy.
- Never create unbounded Lichess traffic, memory usage, CPU use, or cloud scaling.
- Never collect credentials or private account data.

## Main controls

- Exact Lichess origin and direct game-reference validation.
- Terminal-status allowlist with fail-closed unknown handling.
- Strict argument schemas and unknown-key rejection.
- One request at a time, queue depth 20, no automatic retries.
- Eight-second upstream timeout and 512 KiB response cap.
- Minimum 60-second global cooldown after HTTP 429.
- Limits of one game or ten recent summaries.
- No database, engine, OAuth, account mutations, or general-purpose URL input.
- Host and Origin validation to reduce DNS-rebinding and cross-origin abuse.

## Residual risks

- Lichess may change response schemas or status names; the service will refuse unfamiliar statuses instead of guessing.
- Process-local limits are per instance. Deployment must remain capped at one instance initially.
- Public anonymous endpoints can still be abused within the configured bounds. A later public launch may need gateway-level quotas or authentication after a separate review.
