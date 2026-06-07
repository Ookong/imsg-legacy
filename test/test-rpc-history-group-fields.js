#!/usr/bin/env node
/**
 * U6: messages.history responses include chat_identifier / chat_guid /
 * is_group / participants. Watch subscription's 'message' notification
 * carries the same fields.
 *
 * Test uses a fake store so it doesn't depend on chat.db; the unit
 * we're testing is the enrich + format step, not SQLite.
 */
const assert = require('assert');

let passed = 0, failed = 0;
const ok  = n => { console.log(`  ✓ ${n}`); passed++; };
const bad = (n, e) => { console.log(`  ✗ ${n}\n    ${e}`); failed++; };

const RPCServer = require('../src/lib/rpc-server');

function makeFakeStore({ chats, messages }) {
  let chatInfoCalls = 0;
  let participantsCalls = 0;
  return {
    chatInfoCalls: () => chatInfoCalls,
    participantsCalls: () => participantsCalls,
    async getMessages(chatId) {
      return messages.filter(m => chatId === null || m.chat_id === chatId);
    },
    async getChatInfo(chatId) {
      chatInfoCalls++;
      return chats[chatId] || null;
    },
    async getParticipants(chatId) {
      participantsCalls++;
      return (chats[chatId] && chats[chatId].participants) || [];
    },
    async getMaxRowID() { return 0; }
  };
}

(async () => {
  console.log('=== U6: history/watch chat metadata enrichment ===\n');

  // -- Case 1: 1:1 chat ---------------------------------------------------
  {
    const fake = makeFakeStore({
      chats: { 1: { id: 1, identifier: 'a@b.com', guid: 'iMessage;-;a@b.com', participants: ['a@b.com'] } },
      messages: [
        { id: 100, chat_id: 1, guid: 'g1', sender: 'a@b.com', text: 'hi', created_at: new Date(), is_from_me: false }
      ]
    });
    let captured = null;
    const server = new RPCServer(fake);
    server.sendResponse = (id, r) => { captured = r; };
    server.sendError = (id, e) => { throw new Error('unexpected error: ' + JSON.stringify(e)); };
    await server.handleMessagesHistory(1, { chat_id: 1 });
    const m = captured.messages[0];
    if (m.is_group === false && m.chat_identifier === 'a@b.com' && m.chat_guid === 'iMessage;-;a@b.com'
        && Array.isArray(m.participants) && m.participants.length === 1) {
      ok('1:1 chat: is_group=false, single participant, chat_guid populated');
    } else {
      bad('1:1 chat', JSON.stringify(m));
    }
  }

  // -- Case 2: group chat (via ;+; prefix + multiple participants) -------
  {
    const fake = makeFakeStore({
      chats: { 5: { id: 5, identifier: 'chat123', guid: 'iMessage;+;chat123', participants: ['a@b.com', 'c@d.com', 'e@f.com'] } },
      messages: [
        { id: 200, chat_id: 5, guid: 'g2', sender: 'a@b.com', text: 'group hi', created_at: new Date(), is_from_me: false }
      ]
    });
    let captured = null;
    const server = new RPCServer(fake);
    server.sendResponse = (id, r) => { captured = r; };
    server.sendError = () => {};
    await server.handleMessagesHistory(1, { chat_id: 5 });
    const m = captured.messages[0];
    if (m.is_group === true && m.participants.length === 3 && /;\+;/.test(m.chat_guid)) {
      ok('group chat: is_group=true, multiple participants, ;+; in chat_guid');
    } else {
      bad('group chat', JSON.stringify(m));
    }
  }

  // -- Case 3: 100 messages same chat — getChatInfo cached, called once --
  {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: i, chat_id: 7, guid: `g${i}`, sender: 'x@y.com', text: 'm', created_at: new Date(), is_from_me: false
    }));
    const fake = makeFakeStore({
      chats: { 7: { id: 7, identifier: 'x@y.com', guid: 'iMessage;-;x@y.com', participants: ['x@y.com'] } },
      messages
    });
    let captured = null;
    const server = new RPCServer(fake);
    server.sendResponse = (id, r) => { captured = r; };
    server.sendError = () => {};
    await server.handleMessagesHistory(1, { chat_id: 7, limit: 100 });
    if (captured.messages.length === 100 && fake.chatInfoCalls() === 1 && fake.participantsCalls() === 1) {
      ok('cache works: 100 messages from same chat → 1 getChatInfo + 1 getParticipants call');
    } else {
      bad('cache', `messages=${captured.messages.length}, chatInfoCalls=${fake.chatInfoCalls()}, participantsCalls=${fake.participantsCalls()}`);
    }
  }

  // -- Case 4: chat not found — empty enrichment, no throw ---------------
  {
    const fake = makeFakeStore({
      chats: {},
      messages: [{ id: 300, chat_id: 999, guid: 'g3', sender: 'x', text: 't', created_at: new Date(), is_from_me: false }]
    });
    let captured = null;
    const server = new RPCServer(fake);
    server.sendResponse = (id, r) => { captured = r; };
    server.sendError = () => {};
    await server.handleMessagesHistory(1, { chat_id: 999 });
    const m = captured.messages[0];
    if (m.chat_guid === '' && m.chat_identifier === '' && m.is_group === false && Array.isArray(m.participants)) {
      ok('missing chatInfo: empty strings, is_group=false, no throw');
    } else {
      bad('missing chatInfo', JSON.stringify(m));
    }
  }

  // -- Case 5: original 9 required fields still present (test-suite.js regression) --
  {
    const fake = makeFakeStore({
      chats: { 1: { id: 1, identifier: 'a@b.com', guid: 'iMessage;-;a@b.com', participants: ['a@b.com'] } },
      messages: [
        { id: 100, chat_id: 1, guid: 'g1', sender: 'a@b.com', text: 'hi', created_at: new Date(), is_from_me: false }
      ]
    });
    let captured = null;
    const server = new RPCServer(fake);
    server.sendResponse = (id, r) => { captured = r; };
    server.sendError = () => {};
    await server.handleMessagesHistory(1, { chat_id: 1 });
    const m = captured.messages[0];
    const required = ['id','chat_id','guid','sender','text','created_at','is_from_me','attachments','reactions'];
    const missing = required.filter(f => !(f in m));
    if (missing.length === 0) {
      ok('all 9 legacy required fields still present (regression guard)');
    } else {
      bad('legacy fields', `missing: ${missing.join(',')}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
