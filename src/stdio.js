'use strict';

// Newline-delimited JSON-RPC over stdin/stdout. stdout carries protocol bytes
// ONLY — every diagnostic goes to stderr via ctx.log.

const { handleMessage, createSession, ERR } = require('./protocol');

function serve({ input, output, ctx }) {
  const session = createSession();
  let buffer = '';
  const pending = new Set();

  function send(obj) {
    if (obj) output.write(`${JSON.stringify(obj)}\n`);
  }

  function dispatch(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: ERR.PARSE, message: 'Parse error' } });
      return;
    }
    // Requests run concurrently: a 2-minute video poll must not block tools/list.
    const p = handleMessage(msg, session, ctx)
      .then(send)
      .catch((err) => {
        ctx.log(`aibuddy-mcp: internal error: ${err && err.stack ? err.stack : err}`);
        send({ jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: ERR.INTERNAL, message: 'Internal error' } });
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  }

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line.trim()) dispatch(line);
    }
  });

  // Resolves once stdin closes and every in-flight request has answered.
  return new Promise((resolve) => {
    input.on('end', () => {
      if (buffer.trim()) dispatch(buffer.trim());
      buffer = '';
      Promise.allSettled([...pending]).then(() => resolve());
    });
  });
}

module.exports = { serve };
