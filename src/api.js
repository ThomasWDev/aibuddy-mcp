'use strict';

// Thin client over the public AIBuddy v2 API. Every call is billed to the
// caller's own AIBUDDY_API_KEY, exactly as the desktop and mobile apps are.
//
// `fetchImpl` is injected so tests never touch the network.

const { VERSION } = require('./version');

// Custom domain, stage root (no trailing /v2) — API_V2_DOCUMENTATION.md § Base URLs.
const DEFAULT_BASE_URL = 'https://api.denvermobileappdeveloper.com/production';

class ApiError extends Error {
  constructor(message, { status, code, retryable } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

// What the user should do next, keyed on the gateway's documented error codes.
const HINTS = {
  MISSING_API_KEY: 'Set AIBUDDY_API_KEY in the MCP server config. Get a key at https://denvermobileappdeveloper.com/aibuddy-api',
  INVALID_API_KEY: 'The AIBUDDY_API_KEY was not recognised. Generate a new key at https://denvermobileappdeveloper.com/aibuddy-api',
  INSUFFICIENT_CREDITS: 'No credits left on this key. Top up at https://denvermobileappdeveloper.com/aibuddy-api',
  TASK_NOT_FOUND: 'Task ids expire after 24 hours. Start a new generation.',
};

function normaliseBaseUrl(raw) {
  const base = String(raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  // KAN-259: a base ending in /v2 produces /v2/v2/... paths.
  return base.replace(/\/v2$/, '');
}

function createApiClient({ apiKey, baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 180000 } = {}) {
  const root = normaliseBaseUrl(baseUrl);

  async function request(method, path, body, { auth = true } = {}) {
    if (auth && !apiKey) {
      throw new ApiError(HINTS.MISSING_API_KEY, { status: 401, code: 'MISSING_API_KEY' });
    }
    const headers = {
      Accept: 'application/json',
      // WAF allow-rule matches X-Requested-With containing "AIBuddy"; the WAF also
      // blocks requests with no User-Agent (API_V2_DOCUMENTATION.md § WAF).
      'X-Requested-With': 'AIBuddy-MCP',
      'User-Agent': `AIBuddy-MCP/${VERSION}`,
      // Lets the gateway count this client's traffic (aibuddyapi#3686).
      'x-client-surface': 'mcp',
    };
    if (auth) headers['X-AIBuddy-API-Key'] = apiKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${root}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const timedOut = err && err.name === 'AbortError';
      throw new ApiError(
        timedOut ? `AIBuddy API did not answer within ${Math.round(timeoutMs / 1000)}s.` : `Could not reach the AIBuddy API (${err && err.message}).`,
        { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 300) };
    }
    if (!res.ok || data.success === false) {
      const code = data.error || data.code || `HTTP_${res.status}`;
      const message = HINTS[code] || data.message || data.error_message || `AIBuddy API returned HTTP ${res.status}.`;
      throw new ApiError(message, { status: res.status, code, retryable: res.status >= 500 || res.status === 429 });
    }
    return data;
  }

  return {
    baseUrl: root,
    generateImage: (body) => request('POST', '/v2/image/generate', body),
    editImage: (body) => request('POST', '/v2/image/edit', body),
    generateVideo: (body) => request('POST', '/v2/video/generate', body),
    generateMusic: (body) => request('POST', '/v2/music/generate', body),
    getTask: (taskId) => request('GET', `/v2/tasks/${encodeURIComponent(taskId)}`),
    // /v2/models is public; sending a key would be harmless but is unnecessary.
    listModels: () => request('GET', '/v2/models', undefined, { auth: false }),
  };
}

module.exports = { createApiClient, ApiError, DEFAULT_BASE_URL, normaliseBaseUrl };
