#!/usr/bin/env node
/**
 * U4: watch.subscribe respects client-supplied debounce_ms.
 *
 * Tests the parameter plumbing at the unit level — we intercept
 * MessageWatcher.start() and inspect the options it receives. This
 * is more reliable than timing the actual chokidar polling.
 */
const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
const ok  = n => { console.log(`  ✓ ${n}`); passed++; };
const bad = (n, e) => { console.log(`  ✗ ${n}\n    ${e}`); failed++; };

// Load RPCServer + replace MessageWatcher with a fake that records calls
const watcherModule = require.resolve('../src/lib/watcher');
const calls = [];
require.cache[watcherModule] = {
  exports: class FakeWatcher {
    constructor() { this.on = () => {}; this.emit = () => {}; }
    async start(opts) { calls.push(opts); }
    stop() {}
  }
};
// Also make it look like an EventEmitter for the .on hooks the server attaches
const EventEmitter = require('events');
require.cache[watcherModule].exports = class FakeWatcher extends EventEmitter {
  async start(opts) { calls.push(opts); }
  stop() {}
};

const RPCServer = require('../src/lib/rpc-server');

async function runCase(name, params, expectedDebounce) {
  calls.length = 0;
  const server = new RPCServer({ getMaxRowID: async () => 0 });
  // Bypass sendResponse output — just exercise the handler
  server.sendResponse = () => {};
  server.sendError = (id, err) => { throw new Error(`unexpected sendError: ${JSON.stringify(err)}`); };
  await server.handleWatchSubscribe(1, params);
  const last = calls[calls.length - 1];
  if (!last) {
    bad(name, 'watcher.start not called');
    return;
  }
  if (last.debounceMs === expectedDebounce) {
    ok(`${name}: debounceMs=${last.debounceMs}`);
  } else {
    bad(name, `expected debounceMs=${expectedDebounce}, got ${last.debounceMs}`);
  }
}

(async () => {
  console.log('=== U4: watch.subscribe debounce_ms ===\n');

  await runCase('explicit 1000ms', { debounce_ms: 1000 }, 1000);
  await runCase('omitted → default 500', {}, 500);
  await runCase('debounce_ms=0 → clamped to 50', { debounce_ms: 0 }, 50);
  await runCase('debounce_ms=49 → clamped to 50', { debounce_ms: 49 }, 50);
  await runCase('debounce_ms=999999 → preserved (no upper clamp)', { debounce_ms: 999999 }, 999999);
  await runCase('non-number "500" → default 500 (not parsed)', { debounce_ms: '500' }, 500);

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
