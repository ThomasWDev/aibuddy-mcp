'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { callTool, POLL_INTERVAL_MS, MAX_WAIT_SECONDS } = require('../src/tools');
const { makeCtx, memoryFiles } = require('./helpers');

const PNG_B64 = Buffer.from('fake-png').toString('base64');

test('generate_image maps snake_case args to the API body and returns the image inline + saved', async () => {
  const { ctx, calls } = makeCtx({
    'POST /v2/image/generate': { status: 200, body: { success: true, images: [{ base64: PNG_B64, mimeType: 'image/png' }], model: 'gemini-2.5-flash-image', provider: 'gemini', api_cost: 0.02, remaining_credits: 9.98, request_id: 'r1' } },
  });
  const res = await callTool('generate_image', { prompt: '  a red fox  ', provider: 'gemini', aspect_ratio: '16:9', size: '1024x1024', model: 'm' }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'a red fox', provider: 'gemini', model: 'm', aspectRatio: '16:9', size: '1024x1024' });
  assert.equal(res.isError, false);
  assert.deepEqual(res.content[1], { type: 'image', data: PNG_B64, mimeType: 'image/png' });
  assert.match(res.content[0].text, /1 image\(s\) from gemini-2\.5-flash-image \(cost \$0\.02, credits left \$9\.98\)/);
  assert.deepEqual(res.structuredContent.saved, ['/out/image-r1-1.png']);
  assert.equal(ctx.files.written['/out/image-r1-1.png'], PNG_B64);
});

test('generate_image omits optional fields the caller did not set', async () => {
  const { ctx, calls } = makeCtx({ 'POST /v2/image/generate': { status: 200, body: { images: [{ url: 'https://cdn/x.png' }] } } });
  const res = await callTool('generate_image', { prompt: 'p' }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'p' });
  assert.deepEqual(res.structuredContent.urls, ['https://cdn/x.png']);
  assert.deepEqual(res.structuredContent.saved, []);
});

test('generate_image with an empty images array is an error, not a silent success', async () => {
  const { ctx } = makeCtx({ 'POST /v2/image/generate': { status: 200, body: { images: [] } } });
  const res = await callTool('generate_image', { prompt: 'p' }, ctx);
  assert.equal(res.isError, true);
});

test('a missing or blank prompt is refused before any paid call', async () => {
  const { ctx, calls } = makeCtx({});
  for (const args of [{}, { prompt: '   ' }, { prompt: 42 }]) {
    const res = await callTool('generate_image', args, ctx);
    assert.equal(res.isError, true);
    assert.equal(res.structuredContent.code, 'INVALID_INPUT');
  }
  assert.equal(calls.length, 0);
});

test('edit_image sends the loaded image with the API field names', async () => {
  const files = memoryFiles({ '/in/room.jpg': { base64: 'AAAA', mimeType: 'image/jpeg' } });
  const { ctx, calls } = makeCtx({ 'POST /v2/image/edit': { status: 200, body: { images: [{ base64: PNG_B64, mimeType: 'image/png' }], request_id: 'e1' } } }, { files });
  const res = await callTool('edit_image', { prompt: 'furnish it', image_path: '/in/room.jpg', aspect_ratio: '4:3' }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'furnish it', image: 'AAAA', imageMimeType: 'image/jpeg', aspectRatio: '4:3' });
  assert.equal(res.isError, false);
  assert.deepEqual(res.structuredContent.saved, ['/out/edit-e1-1.png']);
});

test('edit_image with no source image is refused without calling the API', async () => {
  const { ctx, calls } = makeCtx({});
  const res = await callTool('edit_image', { prompt: 'x' }, ctx);
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test('generate_video without wait returns the task id at once and does not poll', async () => {
  const { ctx, calls, sleeps } = makeCtx({ 'POST /v2/video/generate': { status: 202, body: { success: true, task_id: 'task_video_1', status: 'processing' } } });
  const res = await callTool('generate_video', { prompt: 'drone over peaks', model: 'veo-3.1-fast-generate-preview' }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'drone over peaks', model: 'veo-3.1-fast-generate-preview' });
  assert.equal(res.structuredContent.task_id, 'task_video_1');
  assert.equal(res.structuredContent.status, 'processing');
  assert.match(res.content[0].text, /Still running/);
  assert.equal(calls.length, 1);
  assert.equal(sleeps.length, 0);
});

test('generate_video with an image sends imageBase64 + imageMimeType', async () => {
  const files = memoryFiles({ '/a.png': { base64: 'QQ==', mimeType: 'image/png' } });
  const { ctx, calls } = makeCtx({ 'POST /v2/video/generate': { status: 202, body: { task_id: 't' } } }, { files });
  await callTool('generate_video', { prompt: 'animate', image_path: '/a.png' }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'animate', imageBase64: 'QQ==', imageMimeType: 'image/png' });
});

test('generate_video with wait polls until completed and returns the result url', async () => {
  const { ctx, calls, sleeps } = makeCtx({
    'POST /v2/video/generate': { status: 202, body: { task_id: 'tv' } },
    'GET /v2/tasks/tv': [
      { status: 200, body: { task_id: 'tv', type: 'video', status: 'processing' } },
      { status: 200, body: { task_id: 'tv', type: 'video', status: 'processing' } },
      { status: 200, body: { task_id: 'tv', type: 'video', status: 'completed', result_url: 'https://s3/v.mp4' } },
    ],
  });
  const res = await callTool('generate_video', { prompt: 'p', wait_seconds: 60 }, ctx);
  assert.equal(res.isError, false);
  assert.equal(res.structuredContent.result_url, 'https://s3/v.mp4');
  assert.match(res.content[0].text, /link valid 24h/);
  assert.equal(calls.filter((c) => c.path === '/v2/tasks/tv').length, 3);
  assert.deepEqual(sleeps, [POLL_INTERVAL_MS, POLL_INTERVAL_MS]);
});

test('polling stops at the wait budget and reports the job as still running', async () => {
  const { ctx, sleeps } = makeCtx({ 'GET /v2/tasks/slow': { status: 200, body: { task_id: 'slow', status: 'processing' } } });
  const res = await callTool('get_task', { task_id: 'slow', wait_seconds: 12 }, ctx);
  assert.equal(res.structuredContent.status, 'processing');
  assert.equal(sleeps.length, 2, '12s budget at a 5s interval allows exactly two sleeps');
});

test('wait_seconds above the ceiling is clamped, negative is refused', async () => {
  const { ctx, sleeps } = makeCtx({ 'GET /v2/tasks/x': { status: 200, body: { task_id: 'x', status: 'processing' } } });
  await callTool('get_task', { task_id: 'x', wait_seconds: 99999 }, ctx);
  assert.equal(sleeps.length, (MAX_WAIT_SECONDS * 1000) / POLL_INTERVAL_MS);
  const neg = await callTool('get_task', { task_id: 'x', wait_seconds: -1 }, ctx);
  assert.equal(neg.isError, true);
});

test('a failed task surfaces the safety-filter reasons as an error', async () => {
  const { ctx } = makeCtx({ 'GET /v2/tasks/f': { status: 200, body: { task_id: 'f', type: 'video', status: 'failed', error: 'Content filtered by safety system', filter_reasons: ['Violence detected'] } } });
  const res = await callTool('get_task', { task_id: 'f' }, ctx);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Content filtered by safety system \(Violence detected\)/);
});

test('generate_music passes only the fields set, keeps instrumental=false, and lists tracks when done', async () => {
  const { ctx, calls } = makeCtx({
    'POST /v2/music/generate': { status: 202, body: { task_id: 'tm', status: 'processing' } },
    'GET /v2/tasks/tm': { status: 200, body: { task_id: 'tm', type: 'music', status: 'completed', tracks: [{ title: 'Code Vibes', audioUrl: 'https://cdn/a.mp3', duration: 180 }] } },
  });
  const res = await callTool('generate_music', { prompt: 'upbeat', style: 'electronic', instrumental: false, wait_seconds: 30 }, ctx);
  assert.deepEqual(calls[0].body, { prompt: 'upbeat', style: 'electronic', instrumental: false });
  assert.deepEqual(res.structuredContent.tracks, [{ title: 'Code Vibes', audio_url: 'https://cdn/a.mp3', image_url: null, duration: 180 }]);
  assert.match(res.content[0].text, /Track "Code Vibes": https:\/\/cdn\/a\.mp3/);
});

test('an accepted async job with no task_id is reported, not treated as started', async () => {
  const { ctx } = makeCtx({ 'POST /v2/music/generate': { status: 202, body: { success: true } } });
  const res = await callTool('generate_music', { prompt: 'p' }, ctx);
  assert.equal(res.isError, true);
});

test('list_models filters to media kinds and survives a missing category', async () => {
  const { ctx } = makeCtx({ 'GET /v2/models': { status: 200, body: { models: { coding: [{ id: 'x' }], image: [{ id: 'gpt-image-1', provider: 'openai', best_for: 'hq' }], video: [{ id: 'veo' }] } } } });
  const res = await callTool('list_models', {}, ctx);
  assert.deepEqual(Object.keys(res.structuredContent.models), ['image', 'video', 'music']);
  assert.deepEqual(res.structuredContent.models.music, []);
  assert.match(res.content[0].text, /music: \(none available\)/);
  assert.ok(!res.content[0].text.includes('coding'));
  const bad = await callTool('list_models', { kind: 'coding' }, ctx);
  assert.equal(bad.isError, true);
});

test('API errors become actionable isError results carrying code and retryability', async () => {
  const { ctx } = makeCtx({ 'POST /v2/image/generate': { status: 402, body: { error: 'INSUFFICIENT_CREDITS', message: 'raw' } } });
  const res = await callTool('generate_image', { prompt: 'p' }, ctx);
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Top up at https:\/\/denvermobileappdeveloper\.com\/aibuddy-api/);
  assert.deepEqual(res.structuredContent, { code: 'INSUFFICIENT_CREDITS', status: 402, retryable: false });
});

test('unknown tool names return null so the protocol layer can answer -32602', async () => {
  assert.equal(await callTool('nope', {}, makeCtx({}).ctx), null);
});
