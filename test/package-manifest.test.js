'use strict';

// The package ships to users through `npx -y aibuddy-mcp`; these pin the
// manifest fields that decide whether that install works at all.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');

test('manifest is publishable under the name the install docs use', () => {
  assert.equal(pkg.name, 'aibuddy-mcp');
  assert.notEqual(pkg.private, true, 'npm refuses to publish a private package');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('the bin entry exists, has a node shebang and is executable', () => {
  assert.deepEqual(Object.keys(pkg.bin), ['aibuddy-mcp']);
  const bin = path.join(root, pkg.bin['aibuddy-mcp']);
  assert.ok(fs.readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node\n'));
  assert.ok(fs.statSync(bin).mode & 0o111, 'bin must be executable');
});

test('only runtime files ship: no tests, no dependencies to install', () => {
  assert.deepEqual([...pkg.files].sort(), ['README.md', 'bin', 'src']);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.prepublishOnly, 'npm test', 'a publish must run the suite first');
});
