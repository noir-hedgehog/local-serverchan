import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import express from 'express';
import multer from 'multer';

import { serializeError } from './runtime-log.js';
import { normalizeSchedule, scheduleToCron, Scheduler } from './scheduler.js';
import { createId, JsonStore, publicJob } from './store.js';
import {
  assertWebhook,
  buildMessage,
  buildMessages,
  materializeMessages,
  normalizeMessages,
  sendWecomQueue,
  summarizePayload
} from './wecom.js';

export async function createApp({ rootDir, dataDir, logger = null, runtime = {} }) {
  const startedAt = runtime.startedAt || new Date().toISOString();
  const uploadDir = path.join(dataDir, 'uploads');
  const storePath = path.join(dataDir, 'store.json');
  const store = new JsonStore(storePath);

  await mkdir(uploadDir, { recursive: true });
  await store.load();

  const scheduler = new Scheduler(store);
  scheduler.start();
  logger?.info('app-ready', {
    mode: runtime.mode || 'server',
    rootDir,
    dataDir,
    storePath,
    enabledJobs: store.snapshot().jobs.filter((job) => job.enabled).length
  });

  const app = express();
  const upload = multer({
    dest: uploadDir,
    limits: {
      fileSize: 20 * 1024 * 1024,
      fieldSize: 30 * 1024 * 1024,
      fields: 100,
      files: 20
    }
  });

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));
  app.use(express.static(path.join(rootDir, 'public')));

  app.get('/api/health', (req, res) => {
    const state = store.snapshot();
    res.json({
      ok: true,
      pid: process.pid,
      mode: runtime.mode || 'server',
      startedAt,
      uptimeSeconds: Math.round((Date.now() - Date.parse(startedAt)) / 1000),
      port: runtime.port || null,
      dataDir,
      storePath,
      logPath: logger?.filePath || '',
      jobs: {
        total: state.jobs.length,
        enabled: state.jobs.filter((job) => job.enabled).length
      },
      lastLogAt: state.logs?.[0]?.at || ''
    });
  });

  app.get('/api/state', (req, res) => {
    const state = store.snapshot();
    res.json({
      settings: state.settings,
      jobs: state.jobs.map(publicJob),
      logs: state.logs
    });
  });

  app.put('/api/settings', async (req, res, next) => {
    try {
      const saved = await store.update((draft) => {
        const webhooks = normalizeWebhooks(req.body.webhooks || draft.settings.webhooks || []);
        draft.settings.webhooks = webhooks;
        draft.settings.defaultWebhookId = '';
        draft.settings.defaultWebhook = '';
        draft.settings.timezone = String(req.body.timezone || 'Asia/Shanghai').trim();
        return draft.settings;
      });
      scheduler.reload();
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/preview', upload.any(), async (req, res, next) => {
    try {
      const payloads = await buildMessages(parseFormJson(req.body.messages || req.body.message), '', req.files || []);
      res.json({ payloads: payloads.map(summarizePayload) });
    } catch (error) {
      next(error);
    } finally {
      await cleanupFiles(req.files);
    }
  });

  app.post('/api/send', upload.any(), async (req, res, next) => {
    try {
      const messages = parseFormJson(req.body.messages || req.body.message);
      const webhook = resolveWebhook(store.snapshot().settings, req.body);
      const payloads = await buildMessages(messages, webhook, req.files || {});
      const responses = await sendWecomQueue(webhook, payloads);
      await store.update((draft) => {
        draft.logs.unshift({
          id: createId('log'),
          jobId: '',
          jobName: '即时发送',
          trigger: 'manual',
          status: 'success',
          at: new Date().toISOString(),
          payloads: payloads.map(summarizePayload),
          response: responses
        });
        draft.logs = draft.logs.slice(0, 200);
      });
      res.json({ ok: true, payloads: payloads.map(summarizePayload), response: responses });
    } catch (error) {
      next(error);
    } finally {
      await cleanupFiles(req.files);
    }
  });

  app.post('/api/jobs', upload.any(), async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const input = parseJobInput(req.body);
      const job = await normalizeJob({
        ...input,
        id: createId('job'),
        createdAt: now,
        updatedAt: now
      }, store.snapshot().settings, req.files || []);

      await store.update((draft) => {
        draft.jobs.unshift(job);
        return job;
      });
      scheduler.reload();
      res.status(201).json(publicJob(job));
    } catch (error) {
      next(error);
    } finally {
      await cleanupFiles(req.files);
    }
  });

  app.put('/api/jobs/:id', upload.any(), async (req, res, next) => {
    try {
      let saved;
      await store.update((draft) => {
        return (async () => {
          const index = draft.jobs.findIndex((job) => job.id === req.params.id);
          if (index === -1) throw new Error('任务不存在');
          const input = parseJobInput(req.body);
          if (input.enabled !== undefined && !input.messages && !input.message && !input.name && !input.schedule) {
            draft.jobs[index].enabled = Boolean(input.enabled);
            draft.jobs[index].updatedAt = new Date().toISOString();
            saved = draft.jobs[index];
            return;
          }
          saved = await normalizeJob({
            ...draft.jobs[index],
            ...input,
            id: req.params.id,
            updatedAt: new Date().toISOString()
          }, draft.settings, req.files || []);
          draft.jobs[index] = saved;
        })();
      });
      scheduler.reload();
      res.json(publicJob(saved));
    } catch (error) {
      next(error);
    } finally {
      await cleanupFiles(req.files);
    }
  });

  app.delete('/api/jobs/:id', async (req, res, next) => {
    try {
      await store.update((draft) => {
        draft.jobs = draft.jobs.filter((job) => job.id !== req.params.id);
      });
      scheduler.reload();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jobs/:id/run', async (req, res, next) => {
    try {
      const response = await scheduler.runJob(req.params.id, 'manual');
      res.json({ ok: true, response });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    logger?.error('request-error', {
      method: req.method,
      path: req.path,
      ...serializeError(error)
    });
    res.status(400).json({ error: error.message || '请求失败' });
  });

  return { app, scheduler, store };
}

async function normalizeJob(input, settings, files = []) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('任务名称不能为空');
  const webhook = String(input.webhook || '').trim();
  const webhookId = String(input.webhookId || '').trim();
  if (!webhookId || !settings.webhooks?.some((item) => item.id === webhookId)) {
    throw new Error('任务必须选择一个已保存的 webhook');
  }
  const schedule = normalizeSchedule(input.schedule, settings);
  validateSchedule(schedule);
  const resolvedWebhook = resolveWebhook(settings, { webhookId, webhook });
  const messages = await materializeMessages(input.messages || input.message, resolvedWebhook, files);
  validateSchedulableMessages(messages);
  return {
    id: input.id,
    name,
    enabled: Boolean(input.enabled),
    webhook,
    webhookId,
    schedule,
    messages,
    message: messages[0],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastRunAt: input.lastRunAt || '',
    lastStatus: input.lastStatus || '',
    lastError: input.lastError || '',
    lastRunKey: input.lastRunKey || ''
  };
}

function validateSchedulableMessages(messages) {
  for (const message of messages) {
    if (message?.type === 'image' && message.imageUrl) continue;
    buildMessage(message);
  }
}

function validateSchedule(schedule) {
  if (schedule.mode === 'once' && !schedule.startAt) throw new Error('单次发送需要设置开始时间');
  if (schedule.mode === 'interval' && !schedule.startAt) throw new Error('间隔发送需要设置开始时间');
  if (schedule.mode === 'weekly' && !schedule.weekdays.length) throw new Error('每周发送至少选择一天');
  if (schedule.mode === 'custom' && !scheduleToCron(schedule)) throw new Error('自定义 cron 不能为空');
}

function parseFormJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  return JSON.parse(value);
}

async function cleanupFiles(files = {}) {
  const allFiles = Array.isArray(files) ? files : Object.values(files).flat();
  await Promise.all(allFiles.map((file) => rm(file.path, { force: true }).catch(() => {})));
}

function parseJobInput(body) {
  if (body.job) return parseFormJson(body.job);
  return {
    ...body,
    schedule: parseMaybeJson(body.schedule),
    messages: parseMaybeJson(body.messages),
    message: parseMaybeJson(body.message)
  };
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  return JSON.parse(trimmed);
}

function resolveWebhook(settings, source = {}) {
  const direct = String(source.webhook || '').trim();
  if (direct) return direct;
  const webhookId = String(source.webhookId || '').trim();
  const saved = settings.webhooks?.find((item) => item.id === webhookId);
  return saved?.url || '';
}

function normalizeWebhooks(webhooks) {
  return webhooks
    .map((item) => ({
      id: String(item.id || createId('wh')).trim(),
      name: String(item.name || '未命名 Webhook').trim(),
      url: String(item.url || '').trim(),
      createdAt: item.createdAt || new Date().toISOString()
    }))
    .filter((item) => item.url)
    .map((item) => {
      assertWebhook(item.url);
      return item;
    });
}
