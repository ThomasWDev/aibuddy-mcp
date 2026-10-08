'use strict';

// The same six tools as shell commands, for agents that prefer a CLI
// (Claude Code, Codex) and for humans testing a key.

const { callTool } = require('./tools');
const { createContext } = require('./context');
const { VERSION } = require('./version');

const USAGE = `aibuddy-mcp ${VERSION} — AIBuddy images, video and music for AI agents

Usage:
  aibuddy-mcp [serve]                       Run the MCP server on stdio (what agents launch)
  aibuddy-mcp image "<prompt>" [--model m] [--provider p] [--aspect 16:9] [--size 1024x1024]
  aibuddy-mcp edit <image-file> "<prompt>" [--aspect 4:3]
  aibuddy-mcp video "<prompt>" [--model m] [--image still.jpg] [--wait 300]
  aibuddy-mcp music "<prompt>" [--style s] [--title t] [--instrumental] [--wait 300]
  aibuddy-mcp task <task_id> [--wait 300]
  aibuddy-mcp models [image|video|music]

Options:
  --out <dir>   Where images are saved (default: current directory; MCP mode uses AIBUDDY_OUTPUT_DIR)
  --json        Print the structured result as JSON
  -h, --help    Show this help
  -v, --version Show the version

Configuration:
  AIBUDDY_API_KEY   required for generation; get one at https://denvermobileappdeveloper.com/aibuddy-api
  AIBUDDY_API_URL   optional API root override
`;

const FLAG_TO_ARG = {
  '--model': 'model',
  '--provider': 'provider',
  '--aspect': 'aspect_ratio',
  '--size': 'size',
  '--image': 'image_path',
  '--wait': 'wait_seconds',
  '--style': 'style',
  '--title': 'title',
  '--out': 'out',
};
const BOOLEAN_FLAGS = { '--instrumental': 'instrumental', '--json': 'json' };
const NUMERIC_ARGS = new Set(['wait_seconds']);

class UsageError extends Error {}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { command: 'help' };
    if (a === '-v' || a === '--version') return { command: 'version' };
    if (BOOLEAN_FLAGS[a]) {
      opts[BOOLEAN_FLAGS[a]] = true;
    } else if (FLAG_TO_ARG[a]) {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value.`);
      const key = FLAG_TO_ARG[a];
      const raw = argv[i += 1];
      opts[key] = NUMERIC_ARGS.has(key) ? Number(raw) : raw;
    } else if (a.startsWith('--')) {
      throw new UsageError(`Unknown option ${a}.`);
    } else {
      positional.push(a);
    }
  }
  return { command: positional[0] || 'serve', positional: positional.slice(1), opts };
}

// Maps a parsed command line to { tool, args }.
function toToolCall({ command, positional, opts }) {
  const { out: _out, json: _json, ...rest } = opts;
  const need = (n, what) => {
    if (positional.length < n) throw new UsageError(`Missing ${what}. Run aibuddy-mcp --help.`);
  };
  switch (command) {
  case 'image':
    need(1, 'prompt');
    return { tool: 'generate_image', args: { prompt: positional.join(' '), ...rest } };
  case 'edit':
    need(2, 'image file and prompt');
    return { tool: 'edit_image', args: { image_path: positional[0], prompt: positional.slice(1).join(' '), ...rest } };
  case 'video':
    need(1, 'prompt');
    return { tool: 'generate_video', args: { prompt: positional.join(' '), ...rest } };
  case 'music':
    need(1, 'prompt');
    return { tool: 'generate_music', args: { prompt: positional.join(' '), ...rest } };
  case 'task':
    need(1, 'task id');
    return { tool: 'get_task', args: { task_id: positional[0], ...rest } };
  case 'models':
    return { tool: 'list_models', args: positional[0] ? { kind: positional[0] } : {} };
  default:
    throw new UsageError(`Unknown command "${command}". Run aibuddy-mcp --help.`);
  }
}

// Returns the process exit code. stdout gets results, stderr gets problems.
async function runCli(argv, { config = process.env, stdout = process.stdout, stderr = process.stderr, fetchImpl, cwd = process.cwd() } = {}) {
  let parsed;
  let call;
  try {
    parsed = parseArgs(argv);
    if (parsed.command === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    if (parsed.command === 'version') {
      stdout.write(`${VERSION}\n`);
      return 0;
    }
    call = toToolCall(parsed);
  } catch (err) {
    if (err instanceof UsageError) {
      stderr.write(`${err.message}\n`);
      return 2;
    }
    throw err;
  }
  // A terminal cannot show an inline image, so the CLI always saves them.
  const ctx = createContext({ ...config, AIBUDDY_OUTPUT_DIR: parsed.opts.out || config.AIBUDDY_OUTPUT_DIR || cwd }, { fetchImpl, log: (l) => stderr.write(`${l}\n`) });
  const res = await callTool(call.tool, call.args, ctx);
  if (parsed.opts.json) {
    stdout.write(`${JSON.stringify(res.structuredContent ?? null, null, 2)}\n`);
  } else {
    const lines = res.content.filter((c) => c.type === 'text').map((c) => c.text);
    (res.isError ? stderr : stdout).write(`${lines.join('\n')}\n`);
  }
  return res.isError ? 1 : 0;
}

module.exports = { runCli, parseArgs, toToolCall, UsageError, USAGE };
