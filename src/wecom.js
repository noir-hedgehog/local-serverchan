import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ALLOWED_TYPES = new Set([
  'text',
  'markdown',
  'markdown_v2',
  'image',
  'news',
  'file',
  'voice',
  'template_card'
]);

const UPLOAD_TYPES = new Set(['file', 'voice']);

export function assertWebhook(webhook) {
  if (!webhook || typeof webhook !== 'string') {
    throw new Error('Webhook 不能为空');
  }
  const url = new URL(webhook);
  if (url.protocol !== 'https:' || url.hostname !== 'qyapi.weixin.qq.com') {
    throw new Error('Webhook 必须是企业微信 qyapi.weixin.qq.com 的 HTTPS 地址');
  }
  if (!url.searchParams.get('key')) {
    throw new Error('Webhook 缺少 key 参数');
  }
}

export function buildMessage(message, files = {}) {
  const type = message?.type;
  if (!ALLOWED_TYPES.has(type)) throw new Error(`不支持的消息类型：${type || '(空)'}`);

  if (type === 'text') {
    return prune({
      msgtype: 'text',
      text: {
        content: required(message.content, '文本内容不能为空'),
        mentioned_list: splitList(message.mentionedList),
        mentioned_mobile_list: splitList(message.mentionedMobileList)
      }
    });
  }

  if (type === 'markdown' || type === 'markdown_v2') {
    return {
      msgtype: type,
      [type]: {
        content: type === 'markdown'
          ? appendMarkdownMentions(required(message.content, 'Markdown 内容不能为空'), message.mentionedList)
          : required(message.content, 'Markdown 内容不能为空')
      }
    };
  }

  if (type === 'image') {
    if (message.base64 && message.md5) {
      return {
        msgtype: 'image',
        image: {
          base64: cleanBase64(message.base64),
          md5: message.md5.trim()
        }
      };
    }
    if (files.image?.base64 && files.image?.md5) {
      return {
        msgtype: 'image',
        image: {
          base64: files.image.base64,
          md5: files.image.md5
        }
      };
    }
    throw new Error('图片消息需要上传图片、填写图片链接，或提供 base64+md5');
  }

  if (type === 'news') {
    const articles = normalizeArticles(message.articles);
    if (!articles.length) throw new Error('图文消息至少需要 1 篇文章');
    return {
      msgtype: 'news',
      news: {
        articles
      }
    };
  }

  if (type === 'file' || type === 'voice') {
    const mediaId = message.mediaId || files[type]?.mediaId;
    if (!mediaId) throw new Error(`${type === 'file' ? '文件' : '语音'}消息需要 media_id 或上传素材`);
    return {
      msgtype: type,
      [type]: {
        media_id: mediaId
      }
    };
  }

  if (type === 'template_card') {
    const card = parseJson(message.templateCardJson, '模板卡片 JSON 不是合法 JSON');
    if (!card.card_type) throw new Error('模板卡片缺少 card_type');
    return {
      msgtype: 'template_card',
      template_card: card
    };
  }
}

export async function enrichFilesForMessage(webhook, message, incomingFiles = {}) {
  const enriched = {};

  if (message.type === 'image') {
    const uploaded = incomingFiles.image?.[0];
    if (uploaded) {
      enriched.image = await imageInfoFromPath(uploaded.path);
    } else if (message.imageUrl) {
      enriched.image = await imageInfoFromUrl(message.imageUrl);
    }
  }

  if (UPLOAD_TYPES.has(message.type)) {
    const uploaded = incomingFiles.media?.[0];
    if (uploaded) {
      const result = await uploadMedia(webhook, message.type, uploaded);
      enriched[message.type] = { mediaId: result.media_id, uploadResult: result };
    }
  }

  return enriched;
}

export async function buildMessages(messages, webhook = '', incomingFiles = {}) {
  const list = normalizeMessages(messages);
  const payloads = [];
  const remainingFiles = normalizeIncomingFiles(incomingFiles);
  for (const [index, message] of list.entries()) {
    const files = takeFilesForMessage(message, remainingFiles, index);
    const enriched = await enrichFilesForMessage(webhook, message, files);
    payloads.push(buildMessage(message, enriched));
  }
  return payloads;
}

export async function materializeMessages(messages, webhook = '', incomingFiles = {}) {
  const list = normalizeMessages(messages);
  const remainingFiles = normalizeIncomingFiles(incomingFiles);
  const materialized = [];
  for (const [index, message] of list.entries()) {
    const next = { ...message };
    const files = takeFilesForMessage(next, remainingFiles, index);
    const enriched = await enrichFilesForMessage(webhook, next, files);
    if (next.type === 'image' && enriched.image) {
      next.base64 = enriched.image.base64;
      next.md5 = enriched.image.md5;
      next.imageUrl = '';
    }
    if ((next.type === 'file' || next.type === 'voice') && enriched[next.type]?.mediaId) {
      next.mediaId = enriched[next.type].mediaId;
    }
    materialized.push(next);
  }
  return materialized;
}

export function normalizeIncomingFiles(incomingFiles = {}) {
  const grouped = {};
  if (Array.isArray(incomingFiles)) {
    for (const file of incomingFiles) {
      const name = file.fieldname || 'media';
      grouped[name] ||= [];
      grouped[name].push(file);
    }
  } else {
    for (const [key, value] of Object.entries(incomingFiles)) {
      grouped[key] = [...(Array.isArray(value) ? value : [value]).filter(Boolean)];
    }
  }
  return grouped;
}

function takeFilesForMessage(message, remainingFiles, index) {
  if (message?.type === 'image' && !message.base64 && !message.md5 && !message.imageUrl) {
    const image = shiftFirst(remainingFiles, [`image_${index}`, 'image']);
    return image ? { image: [image] } : {};
  }
  if (UPLOAD_TYPES.has(message?.type) && !message.mediaId) {
    const media = shiftFirst(remainingFiles, [`media_${index}`, 'media']);
    return media ? { media: [media] } : {};
  }
  return {};
}

export function normalizeMessages(input) {
  const messages = Array.isArray(input) ? input : [input].filter(Boolean);
  if (!messages.length) throw new Error('至少需要配置 1 条消息');
  if (messages.length > 20) throw new Error('单个任务最多支持 20 条消息');
  return messages;
}

export async function sendWecomMessage(webhook, payload) {
  assertWebhook(webhook);
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  const data = safeJson(text);
  if (!response.ok) {
    throw new Error(`企业微信 HTTP ${response.status}: ${text}`);
  }
  if (data && data.errcode !== 0) {
    throw new Error(`企业微信返回错误 ${data.errcode}: ${data.errmsg || text}`);
  }
  return data || { raw: text };
}

export async function sendWecomQueue(webhook, payloads, delayMs = 5000) {
  const responses = [];
  for (const [index, payload] of payloads.entries()) {
    if (index > 0) await sleep(delayMs);
    responses.push(await sendWecomMessage(webhook, payload));
  }
  return responses;
}

export async function uploadMedia(webhook, type, file) {
  assertWebhook(webhook);
  if (!UPLOAD_TYPES.has(type)) throw new Error('upload_media 仅支持 file 或 voice');

  const url = new URL(webhook);
  url.pathname = '/cgi-bin/webhook/upload_media';
  url.searchParams.set('type', type);

  const bytes = await readFile(file.path);
  const form = new FormData();
  form.append('media', new Blob([bytes], { type: file.mimetype || 'application/octet-stream' }), file.originalname || path.basename(file.path));

  const response = await fetch(url, {
    method: 'POST',
    body: form
  });
  const text = await response.text();
  const data = safeJson(text);
  if (!response.ok) throw new Error(`素材上传 HTTP ${response.status}: ${text}`);
  if (data && data.errcode !== 0) throw new Error(`素材上传失败 ${data.errcode}: ${data.errmsg || text}`);
  return data;
}

export function summarizePayload(payload) {
  const clone = structuredClone(payload);
  if (clone.image?.base64) clone.image.base64 = `${clone.image.base64.slice(0, 24)}...(${clone.image.base64.length} chars)`;
  return clone;
}

async function imageInfoFromPath(filePath) {
  const bytes = await readFile(filePath);
  return imageInfoFromBytes(bytes);
}

async function imageInfoFromUrl(rawUrl) {
  const url = new URL(required(rawUrl, '图片链接不能为空'));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片链接必须是 HTTP/HTTPS');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return imageInfoFromBytes(bytes);
}

function imageInfoFromBytes(bytes) {
  return {
    base64: Buffer.from(bytes).toString('base64'),
    md5: createHash('md5').update(bytes).digest('hex')
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (!value || typeof value !== 'string') return undefined;
  const items = value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function shiftFirst(groupedFiles, keys) {
  for (const key of keys) {
    if (groupedFiles[key]?.length) return groupedFiles[key].shift();
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendMarkdownMentions(content, mentionedList) {
  const users = splitList(mentionedList);
  if (!users?.length) return content;
  return `${content}\n\n${users.map(formatMarkdownMention).join(' ')}`;
}

function formatMarkdownMention(user) {
  if (user.startsWith('<@') && user.endsWith('>')) return user;
  return `<@${user.replace(/^@/, '')}>`;
}

function normalizeArticles(value) {
  const articles = typeof value === 'string' ? parseJson(value, '图文 articles 不是合法 JSON') : value;
  if (!Array.isArray(articles)) throw new Error('图文 articles 必须是数组');
  return articles
    .map((article) => prune({
      title: required(article.title, '图文标题不能为空'),
      description: article.description || '',
      url: required(article.url, '图文链接不能为空'),
      picurl: article.picurl || article.picUrl || ''
    }))
    .slice(0, 8);
}

function parseJson(value, errorMessage) {
  if (typeof value === 'object' && value !== null) return value;
  try {
    return JSON.parse(value || '{}');
  } catch {
    throw new Error(errorMessage);
  }
}

function required(value, message) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message);
  return value.trim();
}

function prune(value) {
  if (Array.isArray(value)) return value.map(prune).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, val]) => [key, prune(val)])
      .filter(([, val]) => val !== undefined && val !== null && val !== '')
  );
}

function cleanBase64(value) {
  return value.trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
