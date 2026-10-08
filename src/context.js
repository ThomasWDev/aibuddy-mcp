'use strict';

const { createApiClient } = require('./api');
const { createFiles } = require('./files');

// Builds the dependency bag every tool handler receives, from configuration.
function createContext(config = process.env, { fetchImpl, log } = {}) {
  return {
    api: createApiClient({ apiKey: config.AIBUDDY_API_KEY, baseUrl: config.AIBUDDY_API_URL, fetchImpl }),
    files: createFiles({ outputDir: config.AIBUDDY_OUTPUT_DIR }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: log || ((line) => process.stderr.write(`${line}\n`)),
  };
}

module.exports = { createContext };
