import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const initialState = {
  settings: {
    defaultWebhook: '',
    defaultWebhookId: '',
    webhooks: [],
    timezone: 'Asia/Shanghai'
  },
  jobs: [],
  logs: []
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = structuredClone(initialState);
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const settings = normalizeSettings({ ...initialState.settings, ...(parsed.settings || {}) });
      this.state = {
        ...structuredClone(initialState),
        ...parsed,
        settings,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
    this.loaded = true;
    return this.state;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async save() {
    const tmpPath = `${this.filePath}.tmp`;
    const data = JSON.stringify(this.state, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(tmpPath, data);
      await rename(tmpPath, this.filePath);
    });
    return this.writeQueue;
  }

  async update(mutator) {
    const result = await mutator(this.state);
    await this.save();
    return result ?? this.snapshot();
  }
}

export function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function publicJob(job) {
  return structuredClone(job);
}

export function maskWebhook(webhook = '') {
  const keyIndex = webhook.indexOf('key=');
  if (keyIndex === -1) return webhook ? `${webhook.slice(0, 28)}...` : '';
  const prefix = webhook.slice(0, keyIndex + 4);
  const key = webhook.slice(keyIndex + 4);
  if (key.length <= 8) return `${prefix}****`;
  return `${prefix}${key.slice(0, 4)}...${key.slice(-4)}`;
}

function normalizeSettings(settings) {
  const webhooks = Array.isArray(settings.webhooks) ? settings.webhooks : [];
  if (!webhooks.length && settings.defaultWebhook) {
    webhooks.push({
      id: createId('wh'),
      name: '默认 Webhook',
      url: settings.defaultWebhook,
      createdAt: new Date().toISOString()
    });
  }
  return {
    ...settings,
    defaultWebhook: '',
    defaultWebhookId: '',
    webhooks
  };
}
