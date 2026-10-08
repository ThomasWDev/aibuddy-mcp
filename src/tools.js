'use strict';

// MCP tool catalogue. Each handler receives validated-ish arguments and a
// context { api, files, sleep, now } and returns an MCP CallToolResult.
// Order is deterministic on purpose (2026-07-28 spec: stable tools/list order
// improves client-side caching).

const { ApiError } = require('./api');
const { ToolInputError } = require('./errors');

const MAX_WAIT_SECONDS = 600;
const POLL_INTERVAL_MS = 5000;

const TOOLS = [
  {
    name: 'generate_image',
    title: 'Generate image',
    description: 'Text to image. Returns the image inline and, when AIBUDDY_OUTPUT_DIR is set, the saved file path. Billed to your AIBuddy credits.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw.' },
        provider: { type: 'string', description: 'Optional provider id, e.g. "openai" or "gemini". Omit to let AIBuddy choose.' },
        model: { type: 'string', description: 'Optional model id from list_models.' },
        aspect_ratio: { type: 'string', description: 'Optional, e.g. "1:1", "16:9", "9:16".' },
        size: { type: 'string', description: 'Optional pixel size for providers that take one, e.g. "1024x1024".' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_image',
    title: 'Edit image',
    description: 'Image + prompt to a restyled variant (image-to-image). Send a JPEG of about 1024px; the encoded image is capped at 480 KB.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'How to change the image.' },
        image_path: { type: 'string', description: 'Local path to the source image.' },
        image_base64: { type: 'string', description: 'Source image as base64, if no path is available.' },
        image_mime_type: { type: 'string', description: 'Defaults to the file extension, else image/jpeg.' },
        aspect_ratio: { type: 'string' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_video',
    title: 'Generate video',
    description: 'Text or image to a short video clip. Starts an async job and returns a task_id; set wait_seconds to block until it finishes, or call get_task later.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The shot to film.' },
        model: { type: 'string', description: 'Optional video model id from list_models.' },
        image_path: { type: 'string', description: 'Optional local still to animate (image-to-video).' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: MAX_WAIT_SECONDS, description: 'Poll up to this long for the result. Default 0 (return the task_id at once).' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'generate_music',
    title: 'Generate music',
    description: 'Text to a full song or instrumental. Async: returns a task_id; set wait_seconds to block until the tracks are ready.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What the track should sound like, or the lyrics.' },
        style: { type: 'string', description: 'Genre/style tag, e.g. "lo-fi hip hop".' },
        title: { type: 'string' },
        instrumental: { type: 'boolean' },
        model: { type: 'string', description: 'Optional music model id from list_models.' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: MAX_WAIT_SECONDS },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    title: 'Get task status',
    description: 'Check an async video or music job. Returns status and, when complete, the result URL(s). Task ids expire after 24 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        wait_seconds: { type: 'integer', minimum: 0, maximum: MAX_WAIT_SECONDS },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_models',
    title: 'List media models',
    description: 'The image, video and music models available to you right now.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'video', 'music', 'all'], description: 'Default "all".' },
      },
      additionalProperties: false,
    },
  },
];

const TERMINAL = new Set(['completed', 'complete', 'succeeded', 'success', 'failed', 'error', 'cancelled']);

function text(t) {
  return { type: 'text', text: t };
}

function ok(content, structured) {
  return { content, structuredContent: structured, isError: false };
}

function fail(message, structured) {
  return { content: [text(message)], structuredContent: structured, isError: true };
}

function requireString(args, key) {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ToolInputError(`"${key}" is required.`);
  }
  return v.trim();
}

function clampWait(v) {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ToolInputError('"wait_seconds" must be a number from 0 to 600.');
  return Math.min(Math.floor(n), MAX_WAIT_SECONDS);
}

function costLine(data) {
  const parts = [];
  if (typeof data.api_cost === 'number') parts.push(`cost $${data.api_cost.toFixed(2)}`);
  if (typeof data.remaining_credits === 'number') parts.push(`credits left $${data.remaining_credits.toFixed(2)}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

async function imageResult(data, ctx, label) {
  const images = Array.isArray(data.images) ? data.images : [];
  if (!images.length) return fail('The API answered but returned no image.', { request_id: data.request_id || null });
  const content = [];
  const saved = [];
  const urls = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i] || {};
    if (img.base64) {
      const mimeType = img.mimeType || 'image/png';
      content.push({ type: 'image', data: img.base64, mimeType });
      const path = await ctx.files.saveBase64(img.base64, mimeType, `${label}-${data.request_id || ctx.now()}-${i + 1}`);
      if (path) saved.push(path);
    } else if (img.url) {
      urls.push(img.url);
    }
  }
  const lines = [`${images.length} image(s) from ${data.model || data.provider || 'AIBuddy'}${costLine(data)}.`];
  if (saved.length) lines.push(`Saved: ${saved.join(', ')}`);
  if (urls.length) lines.push(`URLs: ${urls.join(' ')}`);
  content.unshift(text(lines.join('\n')));
  return ok(content, { model: data.model || null, provider: data.provider || null, saved, urls, api_cost: data.api_cost ?? null, request_id: data.request_id || null });
}

function taskResult(task) {
  const status = String(task.status || 'unknown');
  const structured = {
    task_id: task.task_id || null,
    type: task.type || null,
    status,
    result_url: task.result_url || null,
    tracks: Array.isArray(task.tracks) ? task.tracks.map((t) => ({ title: t.title || null, audio_url: t.audioUrl || null, image_url: t.imageUrl || null, duration: t.duration ?? null })) : [],
    error: task.error || null,
  };
  if (status === 'failed' || status === 'error') {
    const reasons = Array.isArray(task.filter_reasons) && task.filter_reasons.length ? ` (${task.filter_reasons.join(', ')})` : '';
    return fail(`Task ${structured.task_id} failed: ${task.error || 'no reason given'}${reasons}.`, structured);
  }
  const lines = [`Task ${structured.task_id}: ${status}.`];
  if (structured.result_url) lines.push(`Video (link valid 24h): ${structured.result_url}`);
  for (const t of structured.tracks) if (t.audio_url) lines.push(`Track${t.title ? ` "${t.title}"` : ''}: ${t.audio_url}`);
  if (!TERMINAL.has(status)) lines.push('Still running. Call get_task again with this task_id, or pass wait_seconds.');
  return ok([text(lines.join('\n'))], structured);
}

async function pollTask(taskId, waitSeconds, ctx) {
  let task = await ctx.api.getTask(taskId);
  const deadline = ctx.now() + waitSeconds * 1000;
  while (!TERMINAL.has(String(task.status)) && ctx.now() + POLL_INTERVAL_MS <= deadline) {
    await ctx.sleep(POLL_INTERVAL_MS);
    task = await ctx.api.getTask(taskId);
  }
  return task;
}

const HANDLERS = {
  async generate_image(args, ctx) {
    const body = { prompt: requireString(args, 'prompt') };
    if (args.provider) body.provider = args.provider;
    if (args.model) body.model = args.model;
    if (args.aspect_ratio) body.aspectRatio = args.aspect_ratio;
    if (args.size) body.size = args.size;
    return imageResult(await ctx.api.generateImage(body), ctx, 'image');
  },

  async edit_image(args, ctx) {
    const prompt = requireString(args, 'prompt');
    const src = await ctx.files.loadImage(args);
    const body = { prompt, image: src.base64, imageMimeType: src.mimeType };
    if (args.aspect_ratio) body.aspectRatio = args.aspect_ratio;
    return imageResult(await ctx.api.editImage(body), ctx, 'edit');
  },

  async generate_video(args, ctx) {
    const body = { prompt: requireString(args, 'prompt') };
    const wait = clampWait(args.wait_seconds);
    if (args.model) body.model = args.model;
    if (args.image_path) {
      const src = await ctx.files.loadImage({ image_path: args.image_path });
      body.imageBase64 = src.base64;
      body.imageMimeType = src.mimeType;
    }
    const started = await ctx.api.generateVideo(body);
    if (!started.task_id) return fail('The API accepted the request but returned no task_id.', { request_id: started.request_id || null });
    if (!wait) return taskResult({ ...started, type: 'video', status: started.status || 'processing' });
    return taskResult(await pollTask(started.task_id, wait, ctx));
  },

  async generate_music(args, ctx) {
    const body = { prompt: requireString(args, 'prompt') };
    const wait = clampWait(args.wait_seconds);
    for (const k of ['style', 'title', 'model']) if (args[k]) body[k] = args[k];
    if (typeof args.instrumental === 'boolean') body.instrumental = args.instrumental;
    const started = await ctx.api.generateMusic(body);
    if (!started.task_id) return fail('The API accepted the request but returned no task_id.', { request_id: started.request_id || null });
    if (!wait) return taskResult({ ...started, type: 'music', status: started.status || 'processing' });
    return taskResult(await pollTask(String(started.task_id), wait, ctx));
  },

  async get_task(args, ctx) {
    const taskId = requireString(args, 'task_id');
    return taskResult(await pollTask(taskId, clampWait(args.wait_seconds), ctx));
  },

  async list_models(args, ctx) {
    const kind = args.kind || 'all';
    if (!['image', 'video', 'music', 'all'].includes(kind)) throw new ToolInputError('"kind" must be image, video, music or all.');
    const data = await ctx.api.listModels();
    const all = (data && data.models) || {};
    const kinds = kind === 'all' ? ['image', 'video', 'music'] : [kind];
    const models = {};
    const lines = [];
    for (const k of kinds) {
      const list = Array.isArray(all[k]) ? all[k] : [];
      models[k] = list.map((m) => ({ id: m.id, provider: m.provider || null, best_for: m.best_for || null }));
      lines.push(`${k}: ${list.length ? list.map((m) => m.id).join(', ') : '(none available)'}`);
    }
    return ok([text(lines.join('\n'))], { models });
  },
};

async function callTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return null;
  try {
    return await handler(args || {}, ctx);
  } catch (err) {
    if (err instanceof ToolInputError) return fail(err.message, { code: 'INVALID_INPUT' });
    if (err instanceof ApiError) return fail(err.message, { code: err.code || null, status: err.status ?? null, retryable: err.retryable });
    throw err;
  }
}

module.exports = { TOOLS, callTool, ToolInputError, POLL_INTERVAL_MS, MAX_WAIT_SECONDS };
