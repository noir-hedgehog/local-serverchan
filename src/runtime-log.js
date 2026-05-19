import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function createRuntimeLogger({ logDir, fileName = 'server.log', service = 'wecom-scheduled-webhook-server' }) {
  mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, fileName);

  function write(level, event, details = {}) {
    const entry = {
      at: new Date().toISOString(),
      level,
      service,
      event,
      pid: process.pid,
      ...sanitize(details)
    };
    appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
  }

  return {
    filePath,
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details)
  };
}

export function serializeError(error) {
  if (!error) return {};
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || ''
  };
}

function sanitize(value) {
  if (!value || typeof value !== 'object') return {};
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/webhook|token|secret|password|authorization/i.test(key)) return '[redacted]';
    return item;
  }));
}
