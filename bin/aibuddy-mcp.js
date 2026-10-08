#!/usr/bin/env node
'use strict';

const { parseArgs, runCli } = require('../src/cli');
const { serve } = require('../src/stdio');
const { createContext } = require('../src/context');

async function main() {
  const argv = process.argv.slice(2);
  let command;
  try {
    ({ command } = parseArgs(argv));
  } catch {
    command = 'cli'; // let runCli print the usage error
  }
  if (command === 'serve') {
    if (!process.env.AIBUDDY_API_KEY) {
      process.stderr.write('aibuddy-mcp: AIBUDDY_API_KEY is not set; generation tools will ask for it. list_models still works.\n');
    }
    await serve({ input: process.stdin, output: process.stdout, ctx: createContext(process.env) });
    return 0;
  }
  return runCli(argv);
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`aibuddy-mcp: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
  },
);
