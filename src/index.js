import { createApp } from './app.js';
import { listen } from './http-server.js';

const port = parsePort(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '127.0.0.1';
const server = createApp();

await listen(server, { port, host });
console.log(`lichess-review-mcp listening on http://${host}:${port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  return port;
}
