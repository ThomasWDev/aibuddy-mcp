'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { createFiles, MAX_EDIT_IMAGE_B64_BYTES } = require('../src/files');
const { runCli, parseArgs, toToolCall } = require('../src/cli');
const { serve } = require('../src/stdio');
const { VERSION } = require('../src/version');
const { fakeFetch, makeCtx } = require('./helpers');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aibuddy-mcp-'));
}

test('files: saveBase64 writes decoded bytes under a sanitised name; no dir means no write', async () => {
  const dir = path.join(tmp(), 'nested');
  const p = await createFiles({ outputDir: dir }).saveBase64(Buffer.from('hi').toString('base64'), 'image/jpeg', '../../evil name');
  assert.equal(path.dirname(p), path.resolve(dir), 'stem cannot escape the output dir');
  assert.equal(path.basename(p), '..-..-evil-name.jpg');
  assert.equal(fs.readFileSync(p, 'utf8'), 'hi');
  assert.equal(await createFiles({}).saveBase64('aGk=', 'image/png', 'x'), null);
});

test('files: loadImage reads a path, infers mime from extension, strips data-URL prefixes', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.PNG');
  fs.writeFileSync(f, 'png!');
  const files = createFiles({});
  assert.deepEqual(await files.loadImage({ image_path: f }), { base64: Buffer.from('png!').toString('base64'), mimeType: 'image/png' });
  assert.deepEqual(await files.loadImage({ image_base64: 'data:image/webp;base64,QUJD', image_mime_type: 'image/webp' }), { base64: 'QUJD', mimeType: 'image/webp' });
  assert.equal((await files.loadImage({ image_base64: 'QUJD' })).mimeType, 'image/jpeg');
});

test('files: loadImage refuses oversize images, missing files and missing input with plain messages', async () => {
  const files = createFiles({});
  await assert.rejects(files.loadImage({ image_base64: 'A'.repeat(MAX_EDIT_IMAGE_B64_BYTES + 1) }), /limit is 480 KB/);
  assert.equal((await files.loadImage({ image_base64: 'A'.repeat(MAX_EDIT_IMAGE_B64_BYTES) })).base64.length, MAX_EDIT_IMAGE_B64_BYTES, 'exactly at the cap is accepted');
  await assert.rejects(files.loadImage({ image_path: '/definitely/not/here.jpg' }), /Could not read image_path/);
  await assert.rejects(files.loadImage({}), /Provide image_path or image_base64/);
});

test('files: image_path must be an image file type, so an agent cannot upload a key or .env', async () => {
  const dir = tmp();
  const files = createFiles({});
  for (const name of ['id_rsa', '.env', 'notes.txt', 'photo.jpg.pem']) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, 'secret');
    await assert.rejects(files.loadImage({ image_path: f }), /must be a \.png, \.jpg/, name);
  }
  const ok = path.join(dir, 'Photo.JPEG');
  fs.writeFileSync(ok, 'x');
  assert.equal((await files.loadImage({ image_path: ok })).mimeType, 'image/jpeg');
});

test('cli: argument parsing maps every command to its tool', () => {
  assert.deepEqual(toToolCall(parseArgs(['image', 'a', 'red', 'fox', '--aspect', '1:1'])), { tool: 'generate_image', args: { prompt: 'a red fox', aspect_ratio: '1:1' } });
  assert.deepEqual(toToolCall(parseArgs(['edit', 'room.jpg', 'add', 'sofa'])), { tool: 'edit_image', args: { image_path: 'room.jpg', prompt: 'add sofa' } });
  assert.deepEqual(toToolCall(parseArgs(['video', 'p', '--wait', '30', '--image', 's.jpg'])), { tool: 'generate_video', args: { prompt: 'p', wait_seconds: 30, image_path: 's.jpg' } });
  assert.deepEqual(toToolCall(parseArgs(['music', 'p', '--instrumental', '--style', 'jazz'])), { tool: 'generate_music', args: { prompt: 'p', instrumental: true, style: 'jazz' } });
  assert.deepEqual(toToolCall(parseArgs(['task', 'tid'])), { tool: 'get_task', args: { task_id: 'tid' } });
  assert.deepEqual(toToolCall(parseArgs(['models', 'video'])), { tool: 'list_models', args: { kind: 'video' } });
  assert.equal(parseArgs([]).command, 'serve');
});

function sink() {
  let s = '';
  return { write: (c) => { s += c; }, get text() { return s; } };
}

test('cli: help, version, usage errors and exit codes', async () => {
  const out = sink();
  assert.equal(await runCli(['--help'], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text, /aibuddy-mcp image/);
  const v = sink();
  assert.equal(await runCli(['-v'], { stdout: v }), 0);
  assert.equal(v.text.trim(), VERSION);
  for (const argv of [['image'], ['bogus'], ['image', 'p', '--wait'], ['image', 'p', '--nope']]) {
    const err = sink();
    assert.equal(await runCli(argv, { stdout: sink(), stderr: err }), 2, argv.join(' '));
    assert.ok(err.text.length > 0);
  }
});

test('cli: image saves to --out, prints the path, exit 0; API error goes to stderr with exit 1', async () => {
  const dir = tmp();
  const ok = fakeFetch({ 'POST /v2/image/generate': { status: 200, body: { images: [{ base64: Buffer.from('img').toString('base64'), mimeType: 'image/png' }], request_id: 'c1' } } });
  const out = sink();
  const code = await runCli(['image', 'fox', '--out', dir], { config: { AIBUDDY_API_KEY: 'k' }, stdout: out, stderr: sink(), fetchImpl: ok.fetchImpl });
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(dir, 'image-c1-1.png')));
  assert.match(out.text, /Saved: /);

  const bad = fakeFetch({ 'POST /v2/image/generate': { status: 401, body: { error: 'INVALID_API_KEY' } } });
  const err = sink();
  assert.equal(await runCli(['image', 'fox', '--out', dir], { config: { AIBUDDY_API_KEY: 'k' }, stdout: sink(), stderr: err, fetchImpl: bad.fetchImpl }), 1);
  assert.match(err.text, /new key/);
});

test('cli: --json prints structuredContent', async () => {
  const f = fakeFetch({ 'GET /v2/models': { status: 200, body: { models: { image: [{ id: 'a' }] } } } });
  const out = sink();
  await runCli(['models', 'image', '--json'], { config: {}, stdout: out, stderr: sink(), fetchImpl: f.fetchImpl });
  assert.deepEqual(JSON.parse(out.text), { models: { image: [{ id: 'a', provider: null, best_for: null }] } });
});

test('stdio: newline framing, CRLF tolerance, parse errors, and in-flight requests finish before close', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (c) => { written += c; });
  const { ctx } = makeCtx({ 'GET /v2/models': { status: 200, body: { models: {} } } });
  const done = serve({ input, output, ctx });
  input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\r\n');
  input.write('not json\n\n');
  input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"meth');
  input.write('od":"tools/call","params":{"name":"list_models"}}');
  input.end();
  await done;
  const lines = written.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, 'one reply each for initialize, the parse error and the unterminated final request; none for the notification');
  assert.equal(lines.find((l) => l.id === 1).result.protocolVersion, '2025-06-18');
  assert.equal(lines.find((l) => l.error && l.error.code === -32700).id, null);
  assert.equal(lines.find((l) => l.id === 2).result.isError, false);
});

test('bin: the real executable speaks MCP on stdio with no key and logs only to stderr', async () => {
  const bin = path.join(__dirname, '..', 'bin', 'aibuddy-mcp.js');
  const child = spawn(process.execPath, [bin], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'l', method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } })}\n`);
  child.stdin.end();
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 0);
  const msgs = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(msgs.map((m) => m.id).sort(), ['d', 'l']);
  assert.equal(msgs.find((m) => m.id === 'l').result.tools.length, 6);
  assert.match(stderr, /AIBUDDY_API_KEY is not set/);
});

test('bin: a CLI subcommand runs through runCli and sets the exit code', async () => {
  const bin = path.join(__dirname, '..', 'bin', 'aibuddy-mcp.js');
  const run = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { env: { PATH: process.env.PATH } });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', (code) => resolve({ code, out }));
  });
  assert.deepEqual(await run(['--version']), { code: 0, out: `${VERSION}\n` });
  assert.equal((await run(['--bogus'])).code, 2);
});
