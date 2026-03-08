#!/bin/bash

echo "=== OpenClaw Integration Simulation ==="
echo ""

# Simulate OpenClaw workflow:
# 1. List chats to find conversation
# 2. Get message history
# 3. Send a message
# 4. Subscribe to watch for replies

echo "Step 1: Listing chats..."
echo '{"jsonrpc":"2.0","method":"chats.list","params":{"limit":5},"id":1}' | imsg rpc | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
const response = JSON.parse(data);
console.log('Found', response.result.chats.length, 'chats');
console.log('Latest chat:', response.result.chats[0].identifier, '- Last message:', new Date(response.result.chats[0].last_message_at).toLocaleString());
"
echo ""

echo "Step 2: Getting message history for chat 7..."
echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":3},"id":2}' | imsg rpc | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
const response = JSON.parse(data);
console.log('Found', response.result.messages.length, 'messages');
response.result.messages.forEach(m => {
  const sender = m.is_from_me ? 'Me' : m.sender;
  console.log('  -', sender + ':', m.text.substring(0, 50));
});
"
echo ""

echo "Step 3: Sending a message..."
echo '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"OpenClaw integration test 🔗"},"id":3}' | imsg rpc | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
const response = JSON.parse(data);
console.log('Send result:', response.result.ok ? '✓ Success' : '✗ Failed');
"
echo ""

echo "Step 4: Verifying message in history..."
sleep 1
echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":1},"id":4}' | imsg rpc | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
const response = JSON.parse(data);
const msg = response.result.messages[0];
console.log('Latest message:', msg.text);
console.log('Timestamp:', new Date(msg.created_at).toLocaleString());
"
echo ""

echo "Step 5: Testing error handling (invalid chat_id)..."
echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":99999,"limit":1},"id":5}' | imsg rpc | node -e "
const data = require('fs').readFileSync(0, 'utf-8');
try {
  const response = JSON.parse(data);
  if (response.error) {
    console.log('✓ Error correctly returned:', response.error.message);
  } else {
    console.log('Result:', JSON.stringify(response.result, null, 2));
  }
} catch(e) {
  console.log('Parse error:', e.message);
}
"
echo ""

echo "=== OpenClaw simulation completed ==="
