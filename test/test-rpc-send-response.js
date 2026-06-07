#!/usr/bin/env node
/**
 * U5: send response includes guid, chat_guid, service, id (always
 * present, empty string when AppleScript path can't observe).
 *
 * We don't actually fire AppleScript here — we monkey-patch
 * MessageSender.prototype.sendViaAppleScript so the test runs without
 * Messages.app and without sending real iMessages.
 */
const assert = require('assert');

let passed = 0, failed = 0;
const ok  = n => { console.log(`  ✓ ${n}`); passed++; };
const bad = (n, e) => { console.log(`  ✗ ${n}\n    ${e}`); failed++; };

const MessageSender = require('../src/lib/sender');
const RPCServer = require('../src/lib/rpc-server');

// Replace AppleScript invocation with a no-op that returns the
// post-U5 sender shape.
MessageSender.prototype.sendViaAppleScript = function (options, chatTarget, useChat) {
  const serviceOut =
    options.service === 'sms' ? 'SMS' :
    options.service === 'imessage' ? 'iMessage' :
    options.service || '';
  return Promise.resolve({
    success: true,
    id: '',
    guid: '',
    chat_guid: useChat ? chatTarget : (options.chatGUID || ''),
    service: serviceOut
  });
};

async function runCase(name, params, expectedFields) {
  let captured = null;
  const server = new RPCServer({});
  server.sendResponse = (id, result) => { captured = result; };
  server.sendError = (id, err) => { throw new Error(`unexpected sendError: ${JSON.stringify(err)}`); };
  await server.handleSend(1, params);
  if (!captured) {
    bad(name, 'no response captured');
    return;
  }
  for (const [k, v] of Object.entries(expectedFields)) {
    if (captured[k] !== v) {
      bad(`${name}.${k}`, `expected ${JSON.stringify(v)}, got ${JSON.stringify(captured[k])}`);
      return;
    }
  }
  // Always-present field guarantee (R4)
  for (const k of ['id', 'guid', 'chat_guid', 'service', 'ok']) {
    if (!(k in captured)) {
      bad(`${name}.${k}`, `field missing — must be present (R4)`);
      return;
    }
  }
  ok(`${name}: ${Object.entries(expectedFields).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(', ')}`);
}

(async () => {
  console.log('=== U5: send response fields ===\n');

  await runCase(
    'iMessage to handle',
    { to: '+1234567890', text: 'hi', service: 'imessage' },
    { ok: true, service: 'iMessage', chat_guid: '' }
  );

  await runCase(
    'SMS to handle',
    { to: '+1234567890', text: 'hi', service: 'sms' },
    { ok: true, service: 'SMS', chat_guid: '' }
  );

  await runCase(
    'send via chat_guid',
    { chat_guid: 'iMessage;-;test@example.com', text: 'hi', service: 'imessage' },
    { ok: true, service: 'iMessage', chat_guid: 'iMessage;-;test@example.com' }
  );

  await runCase(
    'send via chat_identifier',
    { chat_identifier: 'iMessage;+;abc123', text: 'hi', service: 'imessage' },
    { ok: true, service: 'iMessage', chat_guid: 'iMessage;+;abc123' }
  );

  // Field-presence regression: all five fields must exist even when empty
  let captured = null;
  const server = new RPCServer({});
  server.sendResponse = (id, r) => { captured = r; };
  server.sendError = () => {};
  await server.handleSend(99, { to: '+15555550000', text: 'x', service: 'imessage' });
  const allFieldsPresent = ['ok','id','guid','chat_guid','service'].every(k => k in captured);
  if (allFieldsPresent) {
    ok('all five fields (ok,id,guid,chat_guid,service) present in response');
  } else {
    bad('fields present', `got keys: ${Object.keys(captured)}`);
  }

  // Error path: AppleScript failure does not pollute success response
  MessageSender.prototype.sendViaAppleScript = function () {
    return Promise.reject(new Error('AppleScript failed: simulated'));
  };
  let errCaptured = null;
  const server2 = new RPCServer({});
  server2.sendResponse = (id, r) => { throw new Error(`should not succeed; got ${JSON.stringify(r)}`); };
  server2.sendError = (id, err) => { errCaptured = err; };
  await server2.handleSend(2, { to: '+1', text: 'x' });
  if (errCaptured && /simulated/.test(errCaptured.data || '')) {
    ok('error path: sendError fires; success fields not polluted');
  } else {
    bad('error path', `errCaptured: ${JSON.stringify(errCaptured)}`);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
