'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient, ApiError, DEFAULT_BASE_URL, normaliseBaseUrl } = require('../src/api');
const { VERSION } = require('../src/version');
const { fakeFetch } = require('./helpers');

test('requests carry the key and the WAF allow-list headers', async () => {
  const { fetchImpl, calls } = fakeFetch({ 'POST /v2/image/generate': { status: 200, body: { images: [] } } });
  await createApiClient({ apiKey: 'k1', fetchImpl }).generateImage({ prompt: 'p' });
  const h = calls[0].headers;
  assert.equal(h['X-AIBuddy-API-Key'], 'k1');
  assert.equal(h['X-Requested-With'], 'AIBuddy-MCP');
  assert.equal(h['User-Agent'], `AIBuddy-MCP/${VERSION}`);
  assert.equal(h['Content-Type'], 'application/json');
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/v2/image/generate`);
});

test('list_models is public: no key needed and none sent', async () => {
  const { fetchImpl, calls } = fakeFetch({ 'GET /v2/models': { status: 200, body: { models: {} } } });
  await createApiClient({ fetchImpl }).listModels();
  assert.equal(calls[0].headers['X-AIBuddy-API-Key'], undefined);
  assert.equal(calls[0].headers['Content-Type'], undefined);
});

test('a missing key fails before the network with the signup hint', async () => {
  const { fetchImpl, calls } = fakeFetch({});
  await assert.rejects(createApiClient({ fetchImpl }).generateVideo({ prompt: 'p' }), (e) => e instanceof ApiError && e.code === 'MISSING_API_KEY' && /aibuddy-api/.test(e.message));
  assert.equal(calls.length, 0);
});

test('base URL is normalised: trailing slash and a stray /v2 are removed (KAN-259)', () => {
  assert.equal(normaliseBaseUrl('https://x.test/production/'), 'https://x.test/production');
  assert.equal(normaliseBaseUrl('https://x.test/production/v2'), 'https://x.test/production');
  assert.equal(normaliseBaseUrl(''), DEFAULT_BASE_URL);
});

test('task ids are URL-encoded into the path', async () => {
  const { fetchImpl, calls } = fakeFetch({ 'GET /v2/tasks/a%2Fb': { status: 200, body: { status: 'processing' } } });
  await createApiClient({ apiKey: 'k', fetchImpl }).getTask('a/b');
  assert.match(calls[0].url, /\/v2\/tasks\/a%2Fb$/);
});

test('HTTP errors map to ApiError with code, status and retryability', async () => {
  const cases = [
    [{ status: 401, body: { error: 'INVALID_API_KEY' } }, 'INVALID_API_KEY', false, /new key/],
    [{ status: 503, body: { error: 'VIDEO_NOT_CONFIGURED', message: 'Google AI key missing' } }, 'VIDEO_NOT_CONFIGURED', true, /Google AI key missing/],
    [{ status: 429, body: { error: 'TOO_MANY_REQUESTS', message: 'slow down' } }, 'TOO_MANY_REQUESTS', true, /slow down/],
    [{ status: 502, body: '<html>bad gateway</html>' }, 'HTTP_502', true, /bad gateway/],
    [{ status: 200, body: { success: false, error: 'ALL_PROVIDERS_FAILED', message: 'all down' } }, 'ALL_PROVIDERS_FAILED', false, /all down/],
  ];
  for (const [route, code, retryable, msg] of cases) {
    const { fetchImpl } = fakeFetch({ 'POST /v2/image/generate': route });
    await assert.rejects(
      createApiClient({ apiKey: 'k', fetchImpl }).generateImage({ prompt: 'p' }),
      (e) => e.code === code && e.retryable === retryable && msg.test(e.message),
      code,
    );
  }
});

test('network failure and timeout are retryable ApiErrors, not raw exceptions', async () => {
  const net = fakeFetch({ 'GET /v2/models': { throw: new Error('ECONNRESET') } });
  await assert.rejects(createApiClient({ fetchImpl: net.fetchImpl }).listModels(), (e) => e.code === 'NETWORK_ERROR' && e.retryable);

  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const slow = fakeFetch({ 'GET /v2/models': { throw: abort } });
  await assert.rejects(createApiClient({ fetchImpl: slow.fetchImpl, timeoutMs: 1000 }).listModels(), (e) => e.code === 'TIMEOUT' && /1s/.test(e.message));
});

test('the timeout actually aborts a hung request', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(createApiClient({ fetchImpl, timeoutMs: 20 }).listModels(), (e) => e.code === 'TIMEOUT');
});
