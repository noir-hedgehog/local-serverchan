import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createRuntimeLogger, serializeError } from './runtime-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const logDir = path.join(rootDir, 'logs');
const port = Number(process.env.PORT || 3077);
const startedAt = new Date().toISOString();
const logger = createRuntimeLogger({ logDir });

registerProcessLogging(logger, { startedAt, port });

const { app } = await createApp({
  rootDir,
  dataDir,
  logger,
  runtime: {
    mode: 'server',
    startedAt,
    port
  }
});

const server = app.listen(port, () => {
  const url = `http://localhost:${port}`;
  logger.info('server-listening', { url, port });
  console.log(`WeCom scheduled webhook server listening on ${url}`);
});

server.on('error', (error) => {
  logger.error('server-error', serializeError(error));
  process.exit(1);
});

function registerProcessLogging(runtimeLogger, context) {
  runtimeLogger.info('process-start', {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    ...context
  });

  process.on('uncaughtException', (error) => {
    runtimeLogger.error('uncaught-exception', serializeError(error));
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    runtimeLogger.error('unhandled-rejection', serializeError(reason));
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      runtimeLogger.warn('process-signal', { signal });
      process.exit(0);
    });
  }

  process.on('exit', (code) => {
    runtimeLogger.info('process-exit', { code, uptimeSeconds: Math.round(process.uptime()) });
  });
}
