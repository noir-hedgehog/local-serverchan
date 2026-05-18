const state = {
  settings: {},
  webhooks: [],
  jobs: [],
  logs: []
};

const messageTypes = [
  ['text', '文本 text'],
  ['markdown', 'Markdown'],
  ['markdown_v2', 'Markdown V2'],
  ['image', '图片 image'],
  ['news', '图文 news'],
  ['file', '文件 file'],
  ['voice', '语音 voice'],
  ['template_card', '模板卡片 template_card']
];

const examples = {
  text: {
    type: 'text',
    content: '广州今日天气：29度，大部分多云，降雨概率：60%',
    mentionedList: 'wangqing,@all',
    mentionedMobileList: '13800001111,@all'
  },
  markdown: {
    type: 'markdown',
    content: '实时新增用户反馈<font color="warning">132例</font>，请相关同事注意。\\n>类型:<font color="comment">用户反馈</font>',
    mentionedList: 'wangqing'
  },
  markdown_v2: {
    type: 'markdown_v2',
    content: '# 一、标题\\n## 二级标题\\n\\n**加粗**\\n\\n[企微文档](https://developer.work.weixin.qq.com/)'
  },
  image: { type: 'image', imageUrl: '' },
  news: {
    type: 'news',
    articles: JSON.stringify([
      {
        title: '中秋节礼品领取',
        description: '今年中秋节公司有豪礼相送',
        url: 'https://www.qq.com',
        picurl: 'https://res.mail.qq.com/node/ww/wwopenmng/images/independent/doc/test_pic_msg1.png'
      }
    ], null, 2)
  },
  file: { type: 'file', mediaId: '' },
  voice: { type: 'voice', mediaId: '' },
  template_card: {
    type: 'template_card',
    templateCardJson: JSON.stringify({
      card_type: 'text_notice',
      source: {
        icon_url: 'https://wework.qpic.cn/wwpic/252813_jOfDHtcISzuodLa_1629280209/0',
        desc: '企业微信',
        desc_color: 0
      },
      main_title: {
        title: '欢迎使用企业微信',
        desc: '您的好友正在邀请您加入企业微信'
      },
      emphasis_content: {
        title: '100',
        desc: '数据含义'
      },
      horizontal_content_list: [
        { keyname: '邀请人', value: '张三' },
        { keyname: '企微官网', value: '点击访问', type: 1, url: 'https://work.weixin.qq.com/?from=openApi' }
      ],
      card_action: {
        type: 1,
        url: 'https://work.weixin.qq.com/?from=openApi'
      }
    }, null, 2)
  }
};

const $ = (selector) => document.querySelector(selector);

const els = {
  settingsForm: $('#settingsForm'),
  webhookName: $('#webhookName'),
  webhookUrl: $('#webhookUrl'),
  addWebhookBtn: $('#addWebhookBtn'),
  webhooksList: $('#webhooksList'),
  timezone: $('#timezone'),
  statusPill: $('#statusPill'),
  composerForm: $('#composerForm'),
  editingJobId: $('#editingJobId'),
  jobName: $('#jobName'),
  jobWebhookId: $('#jobWebhookId'),
  enabled: $('#enabled'),
  messagesList: $('#messagesList'),
  addMessageBtn: $('#addMessageBtn'),
  scheduleMode: $('#scheduleMode'),
  startAt: $('#startAt'),
  endAt: $('#endAt'),
  scheduleTime: $('#scheduleTime'),
  weekdayGroup: $('#weekdayGroup'),
  intervalMinutes: $('#intervalMinutes'),
  cronExpr: $('#cronExpr'),
  nextRuns: $('#nextRuns'),
  preview: $('#payloadPreview'),
  jobsList: $('#jobsList'),
  logsList: $('#logsList'),
  refreshBtn: $('#refreshBtn'),
  previewBtn: $('#previewBtn'),
  sendNowBtn: $('#sendNowBtn'),
  saveJobBtn: $('#saveJobBtn'),
  newJobBtn: $('#newJobBtn'),
  clearPreviewBtn: $('#clearPreviewBtn')
};

await loadState();
resetComposer();

els.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
});

els.addWebhookBtn.addEventListener('click', async () => {
  const name = els.webhookName.value.trim() || `Webhook ${state.webhooks.length + 1}`;
  const url = els.webhookUrl.value.trim();
  if (!url) {
    toast('Webhook URL 不能为空', true);
    return;
  }
  state.webhooks.push({
    id: `wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    url,
    createdAt: new Date().toISOString()
  });
  els.webhookName.value = '';
  els.webhookUrl.value = '';
  renderWebhooks();
  try {
    await persistSettings('Webhook 已添加');
  } catch (error) {
    toast(error.message, true);
    await loadState();
  }
});

els.timezone.addEventListener('change', () => {
  void persistSettings('时区已保存');
  updateNextRuns();
});

els.composerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveJob();
});

els.addMessageBtn.addEventListener('click', () => {
  addMessageCard(examples.text);
});

els.scheduleMode.addEventListener('change', () => {
  renderScheduleControls();
  syncCronFromControls();
});

[els.startAt, els.endAt, els.scheduleTime, els.intervalMinutes].forEach((el) => {
  el.addEventListener('input', () => {
    syncCronFromControls();
    updateNextRuns();
  });
});

els.weekdayGroup.addEventListener('change', () => {
  syncCronFromControls();
  updateNextRuns();
});

els.cronExpr.addEventListener('input', () => {
  if (els.scheduleMode.value !== 'custom') els.scheduleMode.value = 'custom';
  renderScheduleControls();
  updateNextRuns();
});

els.refreshBtn.addEventListener('click', loadState);
els.previewBtn.addEventListener('click', previewMessages);
els.sendNowBtn.addEventListener('click', sendNow);
els.newJobBtn.addEventListener('click', resetComposer);
els.clearPreviewBtn.addEventListener('click', () => showPreview({}));

async function loadState() {
  const data = await api('/api/state');
  state.settings = data.settings || {};
  state.webhooks = [...(state.settings.webhooks || [])];
  state.jobs = data.jobs || [];
  state.logs = data.logs || [];
  els.timezone.value = state.settings.timezone || 'Asia/Shanghai';
  els.statusPill.textContent = state.webhooks.length ? `${state.webhooks.length} 个 webhook` : '未配置 webhook';
  els.statusPill.classList.toggle('warn', !state.webhooks.length);
  renderWebhooks();
  renderJobs();
  renderLogs();
}

function addMessageCard(message = examples.text) {
  const card = document.createElement('article');
  card.className = 'message-card';
  card.draggable = true;
  card.innerHTML = `
    <div class="message-card-head">
      <span class="message-title" data-title>消息</span>
      <label>
        <span>消息类型</span>
        <select data-type>
          ${messageTypes.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
        </select>
      </label>
      <div class="message-actions">
        <button class="icon-button drag-handle" data-drag type="button" title="拖动排序" aria-label="拖动排序">↕</button>
        <button class="icon-button" data-toggle type="button" title="折叠" aria-label="折叠">⌃</button>
        <button class="icon-button danger" data-remove type="button" title="移除" aria-label="移除">×</button>
      </div>
    </div>
    <div data-fields></div>
  `;
  els.messagesList.append(card);
  const typeSelect = card.querySelector('[data-type]');
  typeSelect.value = message.type || 'text';
  renderMessageFields(card, message);
  typeSelect.addEventListener('change', () => {
    renderMessageFields(card, examples[typeSelect.value]);
    updateMessageCardTitles();
  });
  card.querySelector('[data-toggle]').addEventListener('click', () => {
    card.classList.toggle('collapsed');
    const button = card.querySelector('[data-toggle]');
    button.textContent = card.classList.contains('collapsed') ? '⌄' : '⌃';
    button.title = card.classList.contains('collapsed') ? '展开' : '折叠';
    button.setAttribute('aria-label', button.title);
  });
  card.querySelector('[data-remove]').addEventListener('click', () => {
    if (els.messagesList.children.length <= 1) {
      toast('至少保留 1 条消息', true);
      return;
    }
    card.remove();
    updateMessageCardTitles();
  });
  card.addEventListener('dragstart', () => card.classList.add('dragging'));
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    updateMessageCardTitles();
  });
  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    const dragging = els.messagesList.querySelector('.dragging');
    if (!dragging || dragging === card) return;
    const rect = card.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    els.messagesList.insertBefore(dragging, after ? card.nextSibling : card);
  });
  updateMessageCardTitles();
}

function renderMessageFields(card, message = {}) {
  const type = card.querySelector('[data-type]').value;
  const current = { ...(examples[type] || {}), ...message, type };
  card.dataset.storedBase64 = current.base64 || '';
  card.dataset.storedMd5 = current.md5 || '';
  const base64Display = current.base64 ? '' : (current.base64 || '');
  const field = (name, label, attrs = '') => `
    <label class="full">
      <span>${label}</span>
      <textarea data-message="${name}" ${attrs}>${escapeHtml(current[name] || '')}</textarea>
    </label>`;
  const input = (name, label, attrs = '') => `
    <label>
      <span>${label}</span>
      <input data-message="${name}" value="${escapeAttr(current[name] || '')}" ${attrs}>
    </label>`;

  let html = '';
  if (type === 'text') {
    html = `
      <div class="field-grid">
        ${field('content', '文本内容')}
        ${input('mentionedList', '提及 userId 列表')}
        ${input('mentionedMobileList', '提及手机号列表')}
      </div>
      <p class="hint">多个 userId 或手机号用逗号/换行分隔，可填写 @all。</p>`;
  } else if (type === 'markdown') {
    html = `
      <div class="field-grid">
        ${field('content', 'Markdown 内容')}
        ${input('mentionedList', '提及 userId 列表')}
      </div>
      <p class="hint">Markdown 会把提及列表追加为 &lt;@userid&gt; 语法；多个 userId 用逗号/换行分隔。</p>`;
  } else if (type === 'markdown_v2') {
    html = `
      <div class="field-grid">
        ${field('content', 'Markdown V2 内容')}
      </div>
      <p class="hint">企微文档说明 markdown_v2 不支持 &lt;@userid&gt; 扩展语法。</p>`;
  } else if (type === 'image') {
    html = `
      <div class="field-grid">
        <label>
          <span>上传图片</span>
          <input data-file="image" type="file" accept="image/*">
        </label>
        ${input('imageUrl', '图片链接', 'type="url" placeholder="https://..."')}
        <label class="full">
          <span>Base64</span>
          <textarea data-message="base64" placeholder="${current.base64 ? '已保存图片 base64，留空则继续使用已保存图片' : '可选：直接粘贴 base64'}">${escapeHtml(base64Display)}</textarea>
        </label>
        ${input('md5', 'MD5', 'placeholder="可选：配合 base64 使用"')}
      </div>
      <p class="hint">定时任务推荐使用图片链接或 base64+md5；立即发送也可以上传本地图片。</p>`;
  } else if (type === 'news') {
    html = `
      <div class="field-grid">
        ${field('articles', 'Articles JSON')}
      </div>
      <p class="hint">articles 是数组，每项支持 title、description、url、picurl，最多保留前 8 条。</p>`;
  } else if (type === 'file' || type === 'voice') {
    html = `
      <div class="field-grid">
        <label>
          <span>${type === 'file' ? '上传文件' : '上传语音'}</span>
          <input data-file="media" type="file">
        </label>
        ${input('mediaId', 'Media ID', 'placeholder="定时任务建议使用已上传得到的 media_id"')}
      </div>
      <p class="hint">立即发送可上传素材；保存定时任务时请填写可复用的 media_id。</p>`;
  } else {
    html = `
      <div class="field-grid">
        ${field('templateCardJson', 'Template Card JSON')}
      </div>
      <p class="hint">支持 text_notice、news_notice 等模板卡片结构；这里直接编辑 template_card 对象。</p>`;
  }
  card.querySelector('[data-fields]').innerHTML = html;
}

function renderScheduleControls() {
  const mode = els.scheduleMode.value;
  $('[data-schedule="start"]').hidden = mode !== 'once' && mode !== 'interval';
  $('[data-schedule="end"]').hidden = mode !== 'interval';
  $('[data-schedule="time"]').hidden = mode === 'once' || mode === 'interval' || mode === 'custom';
  $('[data-schedule="weekday"]').hidden = mode !== 'weekly';
  $('[data-schedule="interval"]').hidden = mode !== 'interval';
  $('[data-schedule="cron"]').hidden = mode === 'once' || mode === 'interval';
}

function syncCronFromControls() {
  const mode = els.scheduleMode.value;
  const [hour, minute] = (els.scheduleTime.value || '09:00').split(':');
  if (mode === 'daily') els.cronExpr.value = `${Number(minute)} ${Number(hour)} * * *`;
  if (mode === 'weekly') els.cronExpr.value = `${Number(minute)} ${Number(hour)} * * ${selectedWeekdays().join(',') || '1'}`;
  if (mode === 'interval') els.cronExpr.value = `从 ${els.startAt.value || '未设置'} 起每 ${Number(els.intervalMinutes.value || 60)} 分钟`;
  if (mode === 'once') els.cronExpr.value = `仅在 ${els.startAt.value || '未设置'} 发送`;
  renderScheduleControls();
  updateNextRuns();
}

function selectedWeekdays() {
  return [...els.weekdayGroup.querySelectorAll('input:checked')].map((input) => Number(input.value));
}

function setWeekdays(days = [1]) {
  const values = new Set(days.map(Number));
  els.weekdayGroup.querySelectorAll('input').forEach((input) => {
    input.checked = values.has(Number(input.value));
  });
}

function renderWebhooks() {
  const selected = els.jobWebhookId.value;
  els.jobWebhookId.innerHTML = [
    '<option value="">请选择 webhook</option>',
    ...state.webhooks.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`)
  ].join('');
  els.jobWebhookId.value = state.webhooks.some((item) => item.id === selected) ? selected : '';

  els.webhooksList.innerHTML = '';
  if (!state.webhooks.length) {
    els.webhooksList.innerHTML = '<p class="hint">还没有保存 webhook。</p>';
    return;
  }
  state.webhooks.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'webhook-row';
    row.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <span class="webhook-url">${escapeHtml(maskWebhook(item.url))}</span>
      <button class="danger" type="button">删除</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      state.webhooks = state.webhooks.filter((webhook) => webhook.id !== item.id);
      renderWebhooks();
      try {
        await persistSettings('Webhook 已删除');
      } catch (error) {
        toast(error.message, true);
        await loadState();
      }
    });
    els.webhooksList.append(row);
  });
}

async function persistSettings(message) {
  const saved = await api('/api/settings', {
    method: 'PUT',
    body: {
      webhooks: state.webhooks,
      timezone: els.timezone.value.trim()
    }
  });
  state.settings = saved;
  state.webhooks = [...(saved.webhooks || [])];
  renderWebhooks();
  renderJobs();
  toast(message);
}

function updateMessageCardTitles() {
  [...els.messagesList.querySelectorAll('.message-card')].forEach((card, index) => {
    const type = card.querySelector('[data-type]')?.value || 'text';
    const label = messageTypes.find(([value]) => value === type)?.[1] || type;
    card.querySelector('[data-title]').textContent = `${index + 1}. ${label}`;
  });
}

function collectMessages() {
  return [...els.messagesList.querySelectorAll('.message-card')].map((card) => {
    const message = { type: card.querySelector('[data-type]').value };
    card.querySelectorAll('[data-message]').forEach((field) => {
      message[field.dataset.message] = field.value;
    });
    if (message.type === 'image') {
      if (!message.base64 && card.dataset.storedBase64) message.base64 = card.dataset.storedBase64;
      if (!message.md5 && card.dataset.storedMd5) message.md5 = card.dataset.storedMd5;
    }
    return message;
  });
}

function appendMessageFiles(formData) {
  [...els.messagesList.querySelectorAll('.message-card')].forEach((card, index) => {
    card.querySelectorAll('[data-file]').forEach((input) => {
      if (input.files[0]) formData.append(`${input.dataset.file}_${index}`, input.files[0]);
    });
  });
}

function collectSchedule() {
  return {
    mode: els.scheduleMode.value,
    timezone: els.timezone.value.trim() || 'Asia/Shanghai',
    time: els.scheduleTime.value || '09:00',
    weekdays: selectedWeekdays(),
    intervalMinutes: Number(els.intervalMinutes.value || 60),
    startAt: els.startAt.value,
    endAt: els.endAt.value,
    cron: els.scheduleMode.value === 'custom' ? els.cronExpr.value.trim() : ''
  };
}

function collectJob() {
  if (!els.jobWebhookId.value) throw new Error('请先选择任务 webhook');
  return {
    name: els.jobName.value.trim(),
    enabled: els.enabled.value === 'true',
    webhookId: els.jobWebhookId.value,
    webhook: '',
    schedule: collectSchedule(),
    messages: collectMessages()
  };
}

async function previewMessages() {
  const formData = new FormData();
  formData.append('messages', JSON.stringify(collectMessages()));
  appendMessageFiles(formData);
  const result = await api('/api/preview', {
    method: 'POST',
    formData
  });
  showPreview(result.payloads);
}

async function sendNow() {
  if (!els.jobWebhookId.value) {
    toast('请先选择任务 webhook', true);
    return;
  }
  const formData = new FormData();
  formData.append('webhookId', els.jobWebhookId.value);
  formData.append('messages', JSON.stringify(collectMessages()));
  appendMessageFiles(formData);
  const result = await api('/api/send', {
    method: 'POST',
    formData
  });
  showPreview(result.payloads);
  toast('消息已发送');
  await loadState();
}

async function saveJob() {
  try {
    const id = els.editingJobId.value;
    const payload = collectJob();
    const formData = new FormData();
    formData.append('job', JSON.stringify(payload));
    appendMessageFiles(formData);
    const url = id ? `/api/jobs/${id}` : '/api/jobs';
    await api(url, {
      method: id ? 'PUT' : 'POST',
      formData
    });
    toast(id ? '任务已更新' : '任务已创建');
    resetComposer();
    await loadState();
  } catch (error) {
    toast(error.message, true);
  }
}

function renderJobs() {
  const template = $('#jobItemTemplate');
  els.jobsList.innerHTML = '';
  if (!state.jobs.length) {
    els.jobsList.textContent = '暂无任务';
    els.jobsList.classList.add('empty');
    return;
  }
  els.jobsList.classList.remove('empty');
  state.jobs.forEach((job) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const messages = job.messages || [job.message].filter(Boolean);
    node.querySelector('[data-name]').textContent = job.name;
    node.querySelector('[data-meta]').innerHTML = `${job.enabled ? '<span class="status-dot on"></span>启用' : '<span class="status-dot off"></span>暂停'} · ${messages.length} 条消息 · ${escapeHtml(messages.map((item) => item.type).join(' / '))}`;
    node.querySelector('[data-schedule-meta]').textContent = `${scheduleLabel(job.schedule)} · ${job.lastRunAt || '未发送'}`;
    const error = node.querySelector('[data-error]');
    if (job.lastError) {
      error.hidden = false;
      error.textContent = job.lastError;
    }
    node.querySelector('[data-run]').addEventListener('click', () => runJob(job.id));
    node.querySelector('[data-edit]').addEventListener('click', () => editJob(job));
    const toggleButton = node.querySelector('[data-toggle-enabled]');
    toggleButton.textContent = job.enabled ? '⏸ 暂停' : '▶ 启用';
    toggleButton.title = job.enabled ? '暂停任务' : '启用任务';
    node.querySelector('[data-toggle-enabled]').addEventListener('click', () => toggleJobEnabled(job));
    node.querySelector('[data-delete]').addEventListener('click', () => deleteJob(job.id));
    els.jobsList.append(node);
  });
}

function renderLogs() {
  els.logsList.innerHTML = '';
  if (!state.logs.length) {
    els.logsList.textContent = '暂无日志';
    els.logsList.classList.add('empty');
    return;
  }
  els.logsList.classList.remove('empty');
  state.logs.slice(0, 20).forEach((log) => {
    const item = document.createElement('article');
    item.className = 'list-item';
    const count = log.payloads?.length || (log.payload ? 1 : 0);
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(log.status === 'success' ? '发送成功' : '发送失败')}</strong>
        <p>${escapeHtml(log.at)} · ${escapeHtml(log.jobName || '即时发送')} · ${count} 条 · ${escapeHtml(log.trigger || '')}</p>
        ${log.error ? `<p class="error-text">${escapeHtml(log.error)}</p>` : ''}
      </div>`;
    item.addEventListener('click', () => showPreview(log.payloads || log.payload || log.response || log));
    els.logsList.append(item);
  });
}

async function runJob(id) {
  const result = await api(`/api/jobs/${id}/run`, { method: 'POST', body: {} });
  toast('任务已手动发送');
  showPreview(result.response || {});
  await loadState();
}

async function toggleJobEnabled(job) {
  await api(`/api/jobs/${job.id}`, {
    method: 'PUT',
    body: { enabled: !job.enabled }
  });
  toast(!job.enabled ? '任务已启用' : '任务已暂停');
  await loadState();
}

async function deleteJob(id) {
  if (!confirm('确认删除这个任务？')) return;
  await api(`/api/jobs/${id}`, { method: 'DELETE' });
  toast('任务已删除');
  await loadState();
}

function editJob(job) {
  els.editingJobId.value = job.id;
  els.jobName.value = job.name || '';
  els.jobWebhookId.value = job.webhookId || '';
  els.enabled.value = String(Boolean(job.enabled));
  const schedule = job.schedule || {};
  els.scheduleMode.value = schedule.mode || 'daily';
  els.startAt.value = toLocalInputValue(schedule.startAt);
  els.endAt.value = toLocalInputValue(schedule.endAt);
  els.scheduleTime.value = schedule.time || '09:00';
  els.intervalMinutes.value = schedule.intervalMinutes || 60;
  els.cronExpr.value = schedule.cron || '0 9 * * *';
  setWeekdays(schedule.weekdays || [1]);
  els.messagesList.innerHTML = '';
  (job.messages || [job.message].filter(Boolean)).forEach(addMessageCard);
  if (!els.messagesList.children.length) addMessageCard(examples.text);
  syncCronFromControls();
  showPreview(job.messages || job.message || {});
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetComposer() {
  els.editingJobId.value = '';
  els.jobName.value = '';
  els.jobWebhookId.value = '';
  els.enabled.value = 'true';
  els.scheduleMode.value = 'daily';
  els.startAt.value = '';
  els.endAt.value = '';
  els.scheduleTime.value = '09:00';
  els.intervalMinutes.value = '60';
  els.cronExpr.value = '0 9 * * *';
  setWeekdays([1]);
  els.messagesList.innerHTML = '';
  addMessageCard(examples.text);
  syncCronFromControls();
  showPreview({});
}

function updateNextRuns() {
  const runs = calculateNextRuns(collectSchedule());
  if (!runs.length) {
    els.nextRuns.innerHTML = '<strong>最近预计推送</strong><p class="hint">当前配置还不能计算预计时间。</p>';
    return;
  }
  els.nextRuns.innerHTML = `
    <strong>最近预计推送</strong>
    <ol>${runs.map((date) => `<li>${escapeHtml(formatRunDate(date))}</li>`).join('')}</ol>
  `;
}

function calculateNextRuns(schedule) {
  const now = new Date();
  if (schedule.mode === 'once') {
    const date = parseLocalDateTime(schedule.startAt);
    return date && date >= now ? [date] : [];
  }
  if (schedule.mode === 'daily') return nextDailyRuns(schedule.time, now);
  if (schedule.mode === 'weekly') return nextWeeklyRuns(schedule.time, schedule.weekdays, now);
  if (schedule.mode === 'interval') return nextIntervalRuns(schedule, now);
  if (schedule.mode === 'custom') return nextCronRuns(schedule.cron, now);
  return [];
}

function nextDailyRuns(time, now) {
  const runs = [];
  const { hour, minute } = parseTime(time);
  for (let offset = 0; runs.length < 5 && offset < 10; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    if (date >= now) runs.push(date);
  }
  return runs;
}

function nextWeeklyRuns(time, weekdays, now) {
  const runs = [];
  const selected = new Set((weekdays || []).map(Number));
  const { hour, minute } = parseTime(time);
  for (let offset = 0; runs.length < 5 && offset < 60; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    date.setHours(hour, minute, 0, 0);
    if (date >= now && selected.has(date.getDay())) runs.push(date);
  }
  return runs;
}

function nextIntervalRuns(schedule, now) {
  const start = parseLocalDateTime(schedule.startAt);
  if (!start) return [];
  const end = parseLocalDateTime(schedule.endAt);
  const intervalMs = Math.max(1, Number(schedule.intervalMinutes || 60)) * 60 * 1000;
  let cursor = new Date(start);
  if (cursor < now) {
    const steps = Math.ceil((now.getTime() - cursor.getTime()) / intervalMs);
    cursor = new Date(cursor.getTime() + steps * intervalMs);
  }
  const runs = [];
  while (runs.length < 5 && (!end || cursor <= end)) {
    runs.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + intervalMs);
  }
  return runs;
}

function nextCronRuns(expr, now) {
  const parsed = parseCron(expr);
  if (!parsed) return [];
  const runs = [];
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (runs.length < 5 && cursor < limit) {
    if (
      parsed.minutes.has(cursor.getMinutes()) &&
      parsed.hours.has(cursor.getHours()) &&
      parsed.days.has(cursor.getDate()) &&
      parsed.months.has(cursor.getMonth() + 1) &&
      parsed.weekdays.has(cursor.getDay())
    ) {
      runs.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return runs;
}

function parseCron(expr = '') {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, day, month, weekday] = parts;
  return {
    minutes: parseCronPart(minute, 0, 59),
    hours: parseCronPart(hour, 0, 23),
    days: parseCronPart(day, 1, 31),
    months: parseCronPart(month, 1, 12),
    weekdays: parseCronPart(weekday, 0, 6)
  };
}

function parseCronPart(part, min, max) {
  const values = new Set();
  for (const piece of String(part || '').split(',')) {
    const [rangePart, stepPart] = piece.split('/');
    const step = Math.max(1, Number(stepPart || 1));
    let start = min;
    let end = max;
    if (rangePart !== '*') {
      const [rawStart, rawEnd] = rangePart.split('-').map(Number);
      start = rawStart;
      end = Number.isFinite(rawEnd) ? rawEnd : rawStart;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return new Set();
    for (let value = start; value <= end; value += step) {
      if (value >= min && value <= max) values.add(value);
    }
  }
  return values;
}

function parseTime(value = '09:00') {
  const [hour = '9', minute = '0'] = value.split(':');
  return { hour: Number(hour), minute: Number(minute) };
}

function parseLocalDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRunDate(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false
  }).format(date);
}

function scheduleLabel(schedule = {}) {
  const mode = schedule.mode || 'custom';
  if (mode === 'once') return `单次 ${formatDateTime(schedule.startAt)}`;
  if (mode === 'daily') return `每天 ${schedule.time || '09:00'}`;
  if (mode === 'weekly') return `每周 ${weekdayText(schedule.weekdays)} ${schedule.time || '09:00'}`;
  if (mode === 'interval') return `${formatDateTime(schedule.startAt)} 起每 ${schedule.intervalMinutes || 60} 分钟，至 ${formatDateTime(schedule.endAt) || '不限'}`;
  return `cron ${schedule.cron || ''}`;
}

function weekdayText(days = []) {
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days.map((day) => labels[Number(day)]).filter(Boolean).join('、') || '未选择';
}

function toLocalInputValue(value) {
  if (!value) return '';
  return String(value).slice(0, 16);
}

function formatDateTime(value) {
  return value ? String(value).replace('T', ' ') : '';
}

function maskWebhook(webhook = '') {
  const index = webhook.indexOf('key=');
  if (index === -1) return webhook ? `${webhook.slice(0, 32)}...` : '';
  const prefix = webhook.slice(0, index + 4);
  const key = webhook.slice(index + 4);
  return `${prefix}${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function api(url, options = {}) {
  const init = { method: options.method || 'GET' };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(data.error || '请求失败', true);
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function showPreview(value) {
  els.preview.textContent = JSON.stringify(value, null, 2);
}

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.style.background = isError ? '#8f2f2f' : '#17212b';
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 3200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', '&#10;');
}
