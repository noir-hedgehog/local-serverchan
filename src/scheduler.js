import cron from 'node-cron';

import { buildMessages, sendWecomQueue, summarizePayload } from './wecom.js';

export class Scheduler {
  constructor(store) {
    this.store = store;
    this.tasks = new Map();
  }

  start() {
    this.reload();
  }

  reload() {
    for (const task of this.tasks.values()) {
      if (typeof task.stop === 'function') task.stop();
      if (typeof task.close === 'function') task.close();
      if (task.timer) clearInterval(task.timer);
      if (task.timeout) clearTimeout(task.timeout);
    }
    this.tasks.clear();

    const { jobs, settings } = this.store.snapshot();
    for (const job of jobs) {
      if (!job.enabled || !job.schedule) continue;
      const schedule = normalizeSchedule(job.schedule, settings);
      if (schedule.mode === 'once') this.scheduleOnce(job, schedule);
      else if (schedule.mode === 'interval') this.scheduleInterval(job, schedule);
      else this.scheduleCron(job, schedule);
    }
  }

  scheduleOnce(job, schedule) {
    const runAt = parseDateTime(schedule.startAt);
    if (!runAt) return;
    const delay = runAt.getTime() - Date.now();
    if (delay < 0) return;
    const timeout = setTimeout(() => {
      void this.runJob(job.id, 'schedule');
    }, delay);
    this.tasks.set(job.id, { timeout, stop: () => clearTimeout(timeout) });
  }

  scheduleInterval(job, schedule) {
    const tick = () => {
      if (!isIntervalDue(job, schedule, new Date())) return;
      void this.runJob(job.id, 'schedule');
    };
    tick();
    const timer = setInterval(tick, 30 * 1000);
    this.tasks.set(job.id, { timer, stop: () => clearInterval(timer) });
  }

  scheduleCron(job, schedule) {
    const cronExpr = scheduleToCron(schedule);
    if (!cronExpr || !cron.validate(cronExpr)) return;
    const task = cron.schedule(
      cronExpr,
      () => {
        if (!isInsideDateRange(schedule, new Date())) return;
        void this.runJob(job.id, 'schedule');
      },
      { timezone: schedule.timezone }
    );
    this.tasks.set(job.id, task);
  }

  async runJob(jobId, trigger = 'manual') {
    const state = this.store.snapshot();
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error('任务不存在');
    if (trigger === 'schedule' && !job.enabled) return;

    const webhook = resolveWebhook(state.settings, job);
    const payloads = await buildMessages(job.messages || job.message, webhook);
    const startedAt = new Date().toISOString();
    const responses = [];

    try {
      responses.push(...await sendWecomQueue(webhook, payloads));
      await this.store.update((draft) => {
        const current = draft.jobs.find((item) => item.id === jobId);
        if (current) {
          current.lastRunAt = startedAt;
          current.lastStatus = 'success';
          current.lastError = '';
          current.lastRunKey = scheduledKey(new Date(startedAt));
        }
        draft.logs.unshift({
          id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          jobId,
          jobName: job.name,
          trigger,
          status: 'success',
          at: startedAt,
          payloads: payloads.map(summarizePayload),
          response: responses
        });
        draft.logs = draft.logs.slice(0, 200);
      });
      return responses;
    } catch (error) {
      await this.store.update((draft) => {
        const current = draft.jobs.find((item) => item.id === jobId);
        if (current) {
          current.lastRunAt = startedAt;
          current.lastStatus = 'failed';
          current.lastError = error.message;
          current.lastRunKey = scheduledKey(new Date(startedAt));
        }
        draft.logs.unshift({
          id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          jobId,
          jobName: job.name,
          trigger,
          status: 'failed',
          at: startedAt,
          error: error.message,
          payloads: payloads.map(summarizePayload)
        });
        draft.logs = draft.logs.slice(0, 200);
      });
      throw error;
    }
  }
}

export function normalizeSchedule(schedule = {}, settings = {}) {
  const mode = schedule.mode || (schedule.cron ? 'custom' : 'daily');
  const timezone = String(schedule.timezone || settings.timezone || 'Asia/Shanghai').trim();
  return {
    mode,
    timezone,
    time: schedule.time || '09:00',
    weekdays: normalizeWeekdays(schedule.weekdays || schedule.weekday),
    intervalMinutes: Math.max(1, Number(schedule.intervalMinutes || 60)),
    startAt: schedule.startAt || '',
    endAt: schedule.endAt || '',
    cron: schedule.cron || ''
  };
}

export function scheduleToCron(schedule) {
  const mode = schedule.mode || 'daily';
  if (mode === 'custom') return schedule.cron;
  const { hour, minute } = splitTime(schedule.time || '09:00');
  if (mode === 'daily') return `${minute} ${hour} * * *`;
  if (mode === 'weekly') {
    const weekdays = normalizeWeekdays(schedule.weekdays).join(',');
    return `${minute} ${hour} * * ${weekdays || '1'}`;
  }
  return '';
}

function isIntervalDue(job, schedule, now) {
  const startAt = parseDateTime(schedule.startAt);
  if (!startAt || now < startAt) return false;
  const endAt = parseDateTime(schedule.endAt);
  if (endAt && now > endAt) return false;
  const elapsedMs = now.getTime() - startAt.getTime();
  const intervalMs = Number(schedule.intervalMinutes || 60) * 60 * 1000;
  const offsetMs = elapsedMs % intervalMs;
  const isDue = offsetMs < 30 * 1000 || intervalMs - offsetMs < 30 * 1000;
  if (!isDue) return false;
  const key = scheduledKey(now);
  return job.lastRunKey !== key;
}

function isInsideDateRange(schedule, now) {
  const startAt = parseDateTime(schedule.startAt);
  if (startAt && now < startAt) return false;
  const endAt = parseDateTime(schedule.endAt);
  if (endAt && now > endAt) return false;
  return true;
}

function splitTime(value) {
  const [hour = '9', minute = '0'] = String(value).split(':');
  return {
    hour: Number(hour),
    minute: Number(minute)
  };
}

function normalizeWeekdays(value) {
  const source = Array.isArray(value) ? value : String(value || '1').split(',');
  return [...new Set(source.map(Number).filter((day) => day >= 0 && day <= 6))];
}

function parseDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function scheduledKey(date) {
  return date.toISOString().slice(0, 16);
}

function resolveWebhook(settings, job) {
  if (job.webhook) return job.webhook;
  const webhookId = job.webhookId;
  const saved = settings.webhooks?.find((item) => item.id === webhookId);
  return saved?.url || '';
}
