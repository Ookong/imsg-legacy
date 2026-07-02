#!/usr/bin/env node
/**
 * U3 integration test: end-to-end assertion that group messages
 * carried only in `m.attributedBody` (canonical iOS @mention storage)
 * surface to OpenClaw with `text` containing the mention name —
 * specifically @如意, the symptom the user reported.
 *
 * Two layers exercised:
 *   (a) Direct MessageStore.parseMessage(): turns a raw DB row into a
 *       Message-shaped object. This is where the bug lived.
 *   (b) RPC handleMessagesHistory(): forwards the parsed message to
 *       the wire unchanged. Regression guard against the enrichment /
 *       formatter layer dropping the text.
 *
 * Reference: docs/plans/2026-07-03-003-fix-imsg-legacy-attributedbody-parser-plan.md
 */
const assert = require('assert');

const MessageStore = require('../src/lib/database');
const RPCServer = require('../src/lib/rpc-server');

let passed = 0;
let failed = 0;
const ok = (n) => { console.log(`  ✓ ${n}`); passed++; };
const bad = (n, e) => { console.log(`  ✗ ${n}\n    ${e}`); failed++; };

/* ------------------------------------------------------------------ */
/*  Build a typedstream `attributedBody` buffer that decodes to the   */
/*  expected mention name.                                            */
/* ------------------------------------------------------------------ */
function utf8BytesOf(s) {
  return Buffer.from(s, 'utf8');
}

/**
 * Apple private format segment: 0x01 0x2b … <body with BER prefix> … 0x86 0x84.
 * The BER prefix must equal `bodyBytes.length` (1-byte form) for the
 * structured-prefix bias to fire and avoid the printable-ASCII trap.
 */
function appleTypedStreamWithMention(mentionName) {
  const body = utf8BytesOf(mentionName);
  if (body.length >= 0x80) {
    throw new Error(`mention name too long for 1-byte BER prefix in this test`);
  }
  const prefix = Buffer.from([body.length]);
  return Buffer.concat([
    Buffer.from([0x01, 0x2b]),
    prefix,
    body,
    Buffer.from([0x86, 0x84])
  ]);
}

/**
 * Same shape but using the UTF-16 LE BOM path: 0xff 0xfe + UTF-16-LE bytes
 * of the mention name. Different code path in the parser, same outcome.
 */
function utf16LeTypedStreamWithMention(mentionName) {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(mentionName, 'utf16le')
  ]);
}

/**
 * Construct a `MessageStore` instance WITHOUT touching chat.db.
 * Sets hasAttributedBody=true so the parser path runs.
 */
function freshStore() {
  const store = new MessageStore();
  store.hasAttributedBody = true;
  return store;
}

/* ------------------------------------------------------------------ */
/*  Case A: direct parseMessage() with Apple typedstream body          */
/* ------------------------------------------------------------------ */
console.log('=== Case A: parseMessage() with Apple typedstream body ===');

{
  const store = freshStore();
  const mention = '如意';
  const typedBody = appleTypedStreamWithMention(mention);

  const row = {
    ROWID: 9001,
    chat_id: 42,
    guid: 'fake-guid-A',
    reply_to_guid: '',
    id: '+15555550100',                       // sender handle
    body: typedBody,
    text: '',                                 // m.text is NULL in this case
    date: 0,                                  // appleDateToDate tolerates 0 → now()
    is_from_me: 0
  };

  const msg = store.parseMessage(row);
  if (msg && typeof msg.text === 'string' && msg.text.includes(mention)) {
    ok(`parseMessage(text=NULL, body=<Apple typedstream "如意">) → text contains "${mention}"`);
  } else {
    bad('parseMessage Apple typedstream', `got ${JSON.stringify(msg)}`);
  }

  // Negative-side asserts
  if (msg.id === 9001) ok('parseMessage preserves ROWID');
  else bad('rowid preserved', `got id=${msg.id}`);

  if (msg.chat_id === 42) ok('parseMessage preserves chat_id');
  else bad('chat_id preserved', `got chat_id=${msg.chat_id}`);

  if (msg.sender === '+15555550100') ok('parseMessage preserves sender');
  else bad('sender preserved', `got sender=${msg.sender}`);

  if (msg.is_from_me === false) ok('parseMessage preserves is_from_me=false (database boolean)');
  else bad('is_from_me boolean', `got ${typeof msg.is_from_me}=${msg.is_from_me}`);

  // Legacy required-field regression (matches test-rpc-history-group-fields.js
  // Case 5). All 9 fields must still be present.
  const required = ['id','chat_id','guid','sender','text','created_at','is_from_me','attachments','reactions'];
  const missing = required.filter((f) => !(f in msg));
  if (missing.length === 0) ok('all 9 legacy required fields still present');
  else bad('legacy fields present', `missing: ${missing.join(', ')}`);
}

/* ------------------------------------------------------------------ */
/*  Case B: direct parseMessage() with UTF-16 LE BOM body              */
/* ------------------------------------------------------------------ */
console.log('\n=== Case B: parseMessage() with UTF-16 LE BOM body ===');

{
  const store = freshStore();
  const mention = '如意';
  const typedBody = utf16LeTypedStreamWithMention(mention);
  const row = {
    ROWID: 9002,
    chat_id: 42,
    guid: 'fake-guid-B',
    reply_to_guid: '',
    id: '+15555550101',
    body: typedBody,
    text: '',
    date: 0,
    is_from_me: 0
  };
  const msg = store.parseMessage(row);
  if (msg && typeof msg.text === 'string' && msg.text.includes(mention)) {
    ok(`parseMessage(UTF-16 LE BOM body) → text contains "${mention}"`);
  } else {
    bad('parseMessage UTF-16 BOM', `got text=${JSON.stringify(msg && msg.text)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Case C: regression — 1v1 path with m.text populated                */
/* ------------------------------------------------------------------ */
console.log('\n=== Case C: regression — 1v1 path, m.text populated ===');

{
  const store = freshStore();
  const row = {
    ROWID: 9003,
    chat_id: 1,
    guid: 'fake-guid-C',
    reply_to_guid: '',
    id: '+15555550102',
    body: null,
    text: 'hello',
    date: 0,
    is_from_me: 1
  };
  const msg = store.parseMessage(row);
  if (msg && msg.text === 'hello' && msg.is_from_me === true) {
    ok('1v1 path: text="hello" (m.text direct) unchanged, is_from_me=true');
  } else {
    bad('1v1 regression', `got ${JSON.stringify(msg)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Case D: regression — body null, text "" (post-IFNULL state)        */
/* ------------------------------------------------------------------ */
console.log('\n=== Case D: body null + text "" post-IFNULL → text="", no throw ===');

{
  const store = freshStore();
  // In production, the SELECT is "IFNULL(m.text, '') AS text" so the
  // SQL layer guarantees text is always a string. Here text='' models
  // the post-IFNULL state and exercises the fallback path.
  const row = {
    ROWID: 9004,
    chat_id: 1,
    guid: 'fake-guid-D',
    reply_to_guid: '',
    id: '+15555550103',
    body: null,
    text: '',
    date: 0,
    is_from_me: 0
  };
  let msg;
  try {
    msg = store.parseMessage(row);
  } catch (e) {
    bad('null/empty case threw', e.message);
  }
  if (msg && msg.text === '' && !('error' in msg)) {
    ok('body null + text="" → text="" (no throw, no error field)');
  } else {
    bad('null/empty case', `got ${JSON.stringify(msg)}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Case E: RPC routing — fake store returns parsed mention message    */
/*          and handleMessagesHistory forwards it without truncation. */
/* ------------------------------------------------------------------ */
console.log('\n=== Case E: RPC handleMessagesHistory forwards mention text ===');

function makeFakeStore({ chats, messages }) {
  return {
    async getMessages(_chatId, _limit, _opts) { return messages; },
    async getChatInfo(chatId) { return chats[chatId] || null; },
    async getParticipants(chatId) { return (chats[chatId] && chats[chatId].participants) || []; },
    async getMaxRowID() { return 0; }
  };
}

(async () => {
  const mention = '如意';
  const fake = makeFakeStore({
    chats: { 5: { id: 5, identifier: 'chatroom-guid-5', guid: 'iMessage;+;chatroom-guid-5', participants: ['alice@x.com', 'bob@y.com', '如意@z.com'] } },
    messages: [
      {
        id: 10001,
        chat_id: 5,
        guid: 'fake-mention-guid',
        sender: 'alice@x.com',
        text: `@${mention} 你看一下`,                       // what parseMessage would now produce
        created_at: new Date(),
        is_from_me: false
      }
    ]
  });

  let captured = null;
  const server = new RPCServer(fake);
  server.sendResponse = (id, r) => { captured = r; };
  server.sendError = (id, e) => { throw new Error('unexpected error: ' + JSON.stringify(e)); };

  await server.handleMessagesHistory(1, { chat_id: 5 });
  const m = captured && captured.messages && captured.messages[0];

  if (m && typeof m.text === 'string' && m.text.includes(mention)) {
    ok(`RPC forwards text containing "${mention}"`);
  } else {
    bad('RPC mention text', `got text=${JSON.stringify(m && m.text)}`);
  }

  if (m && m.is_group === true && m.chat_guid === 'iMessage;+;chatroom-guid-5' && Array.isArray(m.participants) && m.participants.length === 3) {
    ok('group metadata (is_group, chat_guid, participants) preserved');
  } else {
    bad('group metadata', JSON.stringify(m));
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
