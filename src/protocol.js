'use strict';

// Dual-era MCP dispatcher (spec 2026-07-28 § Versioning and Compatibility).
//
//   modern  — every request carries its version in _meta; no handshake;
//             `server/discover` is mandatory; results carry resultType.
//   legacy  — an `initialize` handshake picks the version for the whole
//             stdio process. Most installed clients still speak this, so
//             dropping it would break the setup a user just pasted.
//
// Pure: takes a parsed JSON-RPC message, returns the response object (or null
// for a notification). Transport lives in stdio.js.

const { TOOLS, callTool } = require('./tools');
const { VERSION } = require('./version');

const MODERN_VERSIONS = ['2026-07-28'];
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_VERSION: -32022,
};

const SERVER_INFO = { name: 'aibuddy', title: 'AIBuddy Media', version: VERSION };
const INSTRUCTIONS =
  'AIBuddy generates images, short videos and music from prompts, billed to the user\'s AIBuddy credits. '
  + 'Video and music are async: start them, then call get_task (or pass wait_seconds). '
  + 'Call list_models when the user asks for a specific model.';
const CAPABILITIES = { tools: { listChanged: false } };
const LIST_TTL_MS = 3600000;

function createSession() {
  return { era: null, legacyVersion: null };
}

function error(id, code, message, data) {
  const e = { code, message };
  if (data !== undefined) e.data = data;
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: e };
}

function result(id, body, era) {
  if (era === 'modern') {
    return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...body, _meta: { ...(body._meta || {}), [META_SERVER_INFO]: SERVER_INFO } } };
  }
  return { jsonrpc: '2.0', id, result: body };
}

// Decide which era serves this request, or return an error response.
function resolveEra(msg, session) {
  const meta = (msg.params && msg.params._meta) || {};
  const requested = meta[META_VERSION];
  if (requested !== undefined) {
    if (MODERN_VERSIONS.includes(requested)) return { era: 'modern' };
    return { response: error(msg.id, ERR.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: MODERN_VERSIONS, requested }) };
  }
  if (session.era === 'legacy') return { era: 'legacy' };
  return {
    response: error(msg.id, ERR.UNSUPPORTED_VERSION, 'Unsupported protocol version', { supported: MODERN_VERSIONS, requested: null }),
  };
}

async function handleMessage(msg, session, ctx) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && typeof msg === 'object' && msg.id !== undefined && msg.method === undefined) return null; // a response to us; we send no requests
    return error(msg && msg.id, ERR.INVALID_REQUEST, 'Invalid JSON-RPC request');
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized, cancelled, etc. — nothing to answer

  const { method } = msg;
  const params = msg.params || {};

  if (method === 'initialize') {
    const asked = params.protocolVersion;
    const version = LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0];
    session.era = 'legacy';
    session.legacyVersion = version;
    return result(msg.id, { protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }, 'legacy');
  }

  if (method === 'server/discover') {
    return result(msg.id, {
      supportedVersions: MODERN_VERSIONS,
      capabilities: CAPABILITIES,
      instructions: INSTRUCTIONS,
      ttlMs: LIST_TTL_MS,
      cacheScope: 'public',
    }, 'modern');
  }

  // `ping` was removed in 2026-07-28 but legacy clients still send it.
  if (method === 'ping' && session.era === 'legacy') return result(msg.id, {}, 'legacy');

  if (method !== 'tools/list' && method !== 'tools/call') {
    return error(msg.id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }

  const resolved = resolveEra(msg, session);
  if (resolved.response) return resolved.response;
  const { era } = resolved;

  if (method === 'tools/list') {
    const body = { tools: TOOLS };
    if (era === 'modern') Object.assign(body, { ttlMs: LIST_TTL_MS, cacheScope: 'public' });
    return result(msg.id, body, era);
  }

  // tools/call
  if (typeof params.name !== 'string') return error(msg.id, ERR.INVALID_PARAMS, 'tools/call needs a tool "name"');
  let out;
  try {
    out = await callTool(params.name, params.arguments, ctx);
  } catch (err) {
    // An unexpected bug must reach the agent as a readable tool error, not kill the server.
    ctx.log(`aibuddy-mcp: ${params.name} crashed: ${err && err.stack ? err.stack : err}`);
    out = { content: [{ type: 'text', text: `AIBuddy tool "${params.name}" failed unexpectedly: ${err && err.message}` }], isError: true };
  }
  if (out === null) return error(msg.id, ERR.INVALID_PARAMS, `Unknown tool: ${params.name}`);
  return result(msg.id, out, era);
}

module.exports = { handleMessage, createSession, MODERN_VERSIONS, LEGACY_VERSIONS, ERR, SERVER_INFO, META_VERSION };
