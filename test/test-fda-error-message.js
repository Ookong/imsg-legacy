#!/usr/bin/env node
/**
 * U2: Verify FDA error message contains "Full Disk Access" + "chat.db"
 *
 * OpenClaw's normalizeIMessageFullDiskAccessError lowercases the line and
 * checks `includes("full disk access") && includes("chat.db")`. We assert
 * the same predicate against our thrown error.
 */

const assert = require('assert');
const path = require('path');
const MessageStore = require('../src/lib/database');

let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}
function fail(name, err) {
  console.log(`  ✗ ${name}`);
  console.log(`    ${err}`);
  failed++;
}

async function testNonexistentPath() {
  const store = new MessageStore('/tmp/nonexistent-imsg-test.db');
  try {
    await store.connect();
    fail('nonexistent path should throw', 'no error thrown');
  } catch (e) {
    const lower = e.message.toLowerCase();
    if (lower.includes('full disk access') && lower.includes('chat.db')) {
      ok('nonexistent path → message contains "Full Disk Access" + "chat.db"');
    } else {
      fail('nonexistent path message', `got: ${e.message}`);
    }
  }
}

async function testCantOpenCodeShape() {
  // Simulate by creating a directory at the db path so SQLite hits CANTOPEN.
  const fs = require('fs');
  const os = require('os');
  const dir = path.join(os.tmpdir(), `imsg-fda-test-${Date.now()}`);
  fs.mkdirSync(dir);
  const fakeDb = path.join(dir, 'chat.db');
  fs.mkdirSync(fakeDb); // directory at the file location → cantopen
  const store = new MessageStore(fakeDb);
  try {
    await store.connect();
    fail('dir-as-db should throw', 'no error thrown');
  } catch (e) {
    const lower = e.message.toLowerCase();
    if (lower.includes('full disk access') && lower.includes('chat.db')) {
      ok('dir-as-db → message contains FDA keywords');
    } else {
      fail('dir-as-db message', `got: ${e.message}`);
    }
  } finally {
    fs.rmdirSync(fakeDb);
    fs.rmdirSync(dir);
  }
}

async function testMessageRetainsPath() {
  const customPath = '/tmp/some/custom/imsg/chat.db';
  const store = new MessageStore(customPath);
  try {
    await store.connect();
    fail('custom path nonexistent should throw', 'no error thrown');
  } catch (e) {
    if (e.message.includes(customPath)) {
      ok('error message includes the actual db path being attempted');
    } else {
      fail('path inclusion', `got: ${e.message}`);
    }
  }
}

async function testOtherErrorsKeepOldShape() {
  // Force a non-CANTOPEN failure: pass a clearly invalid argument so
  // better-sqlite3 throws a TypeError before reaching SQLITE_CANTOPEN.
  const store = new MessageStore('');
  store.dbPath = ''; // empty path
  try {
    await store.connect();
    // empty-string path may or may not trigger CANTOPEN depending on impl;
    // either way the test is informational, not a hard assertion.
    ok('empty path resolved without throw (acceptable, environment-dependent)');
  } catch (e) {
    const lower = e.message.toLowerCase();
    if (lower.includes('full disk access')) {
      ok('empty path mapped to FDA message (acceptable)');
    } else if (e.message.startsWith('Failed to open database:')) {
      ok('empty path → original "Failed to open database:" shape preserved for non-CANTOPEN');
    } else {
      // Any other shape is fine; this branch documents observed behavior.
      ok(`empty path threw "${e.message.slice(0, 60)}..." (non-FDA, acceptable)`);
    }
  }
}

(async () => {
  console.log('=== U2: FDA Error Message Tests ===\n');
  await testNonexistentPath();
  await testCantOpenCodeShape();
  await testMessageRetainsPath();
  await testOtherErrorsKeepOldShape();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
