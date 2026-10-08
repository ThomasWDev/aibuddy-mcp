'use strict';

// Test doubles for the only external boundaries: HTTP (fetch), the
// filesystem, and the clock. Production code is always imported, never copied.

const { createApiClient } = require('../src/api');

// routes: { 'POST /v2/image/generate': {status, body} | (req) => {status, body} | [ ...sequence ] }
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/production/, '');
    const key = `${init.method || 'GET'} ${path}`;
    const req = { url, path, method: init.method, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(req);
    let route = routes[key];
    if (Array.isArray(route)) route = route.length > 1 ? route.shift() : route[0];
    if (typeof route === 'function') route = route(req);
    if (!route) throw new Error(`fakeFetch: no route for ${key}`);
    if (route.throw) throw route.throw;
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {});
    return { ok: route.status >= 200 && route.status < 300, status: route.status, text: async () => text };
  };
  return { fetchImpl, calls };
}

function memoryFiles(seed = {}) {
  const written = {};
  return {
    written,
    outputDir: '/out',
    async saveBase64(b64, mime, stem) {
      const p = `/out/${stem}.${mime === 'image/png' ? 'png' : 'jpg'}`;
      written[p] = b64;
      return p;
    },
    async loadImage(args) {
      if (args.image_path && seed[args.image_path]) return seed[args.image_path];
      if (args.image_base64) return { base64: args.image_base64, mimeType: args.image_mime_type || 'image/jpeg' };
      const { ToolInputError } = require('../src/errors');
      throw new ToolInputError('Provide image_path or image_base64.');
    },
  };
}

function makeCtx(routes, { apiKey = 'ab_live_test', files = memoryFiles() } = {}) {
  const { fetchImpl, calls } = fakeFetch(routes);
  let clock = 1_000_000;
  const sleeps = [];
  const logs = [];
  return {
    calls,
    sleeps,
    logs,
    ctx: {
      api: createApiClient({ apiKey, fetchImpl }),
      files,
      sleep: async (ms) => { sleeps.push(ms); clock += ms; },
      now: () => clock,
      log: (l) => logs.push(l),
    },
  };
}

module.exports = { fakeFetch, memoryFiles, makeCtx };
