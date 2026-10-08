'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMessage, createSession, ERR, META_VERSION } = require('../src/protocol');
const { TOOLS } = require('../src/tools');
const { makeCtx } = require('./helpers');

const modernMeta = { _meta: { [META_VERSION]: '2026-07-28' } };

function call(msg, session = createSession(), ctx = makeCtx({}).ctx) {
  return handleMessage({ jsonrpc: '2.0', ...msg }, session, ctx);
}

test('server/discover answers statelessly with versions, capabilities, cache fields and serverInfo', async () => {
  const res = await call({ id: 'd1', method: 'server/discover', params: modernMeta });
  assert.equal(res.id, 'd1');
  assert.equal(res.result.resultType, 'complete');
  assert.deepEqual(res.result.supportedVersions, ['2026-07-28']);
  assert.deepEqual(res.result.capabilities, { tools: { listChanged: false } });
  assert.equal(res.result.ttlMs, 3600000);
  assert.equal(res.result.cacheScope, 'public');
  assert.equal(res.result._meta['io.modelcontextprotocol/serverInfo'].name, 'aibuddy');
});

test('modern tools/list needs no handshake and carries ttlMs + cacheScope', async () => {
  const res = await call({ id: 2, method: 'tools/list', params: modernMeta });
  assert.equal(res.result.resultType, 'complete');
  assert.equal(res.result.ttlMs, 3600000);
  assert.equal(res.result.cacheScope, 'public');
  assert.deepEqual(res.result.tools.map((t) => t.name), ['generate_image', 'edit_image', 'generate_video', 'generate_music', 'get_task', 'list_models']);
});

test('an unsupported _meta version gets -32022 listing what is supported', async () => {
  const res = await call({ id: 3, method: 'tools/list', params: { _meta: { [META_VERSION]: '1900-01-01' } } });
  assert.equal(res.error.code, -32022);
  assert.equal(ERR.UNSUPPORTED_VERSION, -32022);
  assert.deepEqual(res.error.data, { supported: ['2026-07-28'], requested: '1900-01-01' });
});

test('a request with neither _meta version nor a prior initialize is refused, not silently served', async () => {
  const res = await call({ id: 4, method: 'tools/list' });
  assert.equal(res.error.code, -32022);
  assert.equal(res.error.data.requested, null);
});

test('legacy initialize echoes a supported legacy version and then serves plain results', async () => {
  const session = createSession();
  const { ctx } = makeCtx({});
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }, session, ctx);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'aibuddy');
  assert.ok(init.result.instructions.includes('get_task'));
  assert.equal(init.result.resultType, undefined, 'legacy results stay in the legacy shape');

  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, session, ctx), null);
  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, session, ctx);
  assert.equal(list.result.tools.length, TOOLS.length);
  assert.equal(list.result.ttlMs, undefined);
  const ping = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, session, ctx);
  assert.deepEqual(ping.result, {});
});

test('legacy initialize with an unknown version falls back to the newest legacy version', async () => {
  const res = await call({ id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.equal(res.result.protocolVersion, '2025-11-25');
});

test('ping is not a modern method', async () => {
  const res = await call({ id: 9, method: 'ping', params: modernMeta });
  assert.equal(res.error.code, ERR.METHOD_NOT_FOUND);
});

test('unknown methods, unknown tools, missing tool name and malformed requests get JSON-RPC errors', async () => {
  assert.equal((await call({ id: 1, method: 'resources/list', params: modernMeta })).error.code, -32601);
  assert.equal((await call({ id: 2, method: 'tools/call', params: { ...modernMeta, name: 'nope' } })).error.code, -32602);
  assert.equal((await call({ id: 3, method: 'tools/call', params: { ...modernMeta } })).error.code, -32602);
  const bad = await handleMessage({ id: 4, method: 'tools/list' }, createSession(), makeCtx({}).ctx);
  assert.equal(bad.error.code, ERR.INVALID_REQUEST);
  assert.equal(await handleMessage({ jsonrpc: '2.0', id: 5, result: {} }, createSession(), makeCtx({}).ctx), null, 'responses to us are ignored');
});

test('modern tools/call routes to the tool and wraps the result', async () => {
  const { ctx, calls } = makeCtx({ 'GET /v2/models': { status: 200, body: { models: { image: [{ id: 'gpt-image-1' }], video: [], music: [] } } } });
  const res = await call({ id: 7, method: 'tools/call', params: { ...modernMeta, name: 'list_models', arguments: { kind: 'image' } } }, createSession(), ctx);
  assert.equal(res.result.resultType, 'complete');
  assert.equal(res.result.isError, false);
  assert.deepEqual(res.result.structuredContent.models.image.map((m) => m.id), ['gpt-image-1']);
  assert.equal(calls.length, 1);
});

test('a tool that throws unexpectedly becomes an isError result and is logged, never a crash', async () => {
  const { ctx, logs } = makeCtx({ 'GET /v2/models': { status: 200, body: { models: null } } });
  ctx.api.listModels = async () => { throw new TypeError('boom'); };
  const res = await call({ id: 8, method: 'tools/call', params: { ...modernMeta, name: 'list_models' } }, createSession(), ctx);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /boom/);
  assert.equal(logs.length, 1);
});
