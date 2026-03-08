#!/bin/bash

echo "=== RPC Method Tests ==="
echo ""

# Test 1: chats.list
echo "1. Testing chats.list..."
echo '{"jsonrpc":"2.0","method":"chats.list","params":{},"id":1}' | imsg rpc
echo ""
echo ""

# Test 2: messages.history
echo "2. Testing messages.history..."
echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":3},"id":2}' | imsg rpc
echo ""
echo ""

# Test 3: send
echo "3. Testing send..."
echo '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"RPC test message"},"id":3}' | imsg rpc
echo ""
echo ""

# Test 4: watch.subscribe (this will hang, so we'll skip it for now)
echo "4. Testing watch.subscribe..."
echo '{"jsonrpc":"2.0","method":"watch.subscribe","params":{"chat_id":7},"id":4}' | imsg rpc &
RPC_PID=$!
sleep 2
kill $RPC_PID 2>/dev/null || true
echo "(subscription started and stopped)"
echo ""

# Test 5: Error handling - invalid method
echo "5. Testing error handling (invalid method)..."
echo '{"jsonrpc":"2.0","method":"invalid.method","params":{},"id":5}' | imsg rpc
echo ""
echo ""

# Test 6: Error handling - missing params
echo "6. Testing error handling (missing required params)..."
echo '{"jsonrpc":"2.0","method":"messages.history","params":{},"id":6}' | imsg rpc
echo ""
echo ""

# Test 7: Batch requests
echo "7. Testing batch requests..."
echo '[
  {"jsonrpc":"2.0","method":"chats.list","params":{},"id":7},
  {"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":2},"id":8}
]' | imsg rpc
echo ""
echo ""

# Test 8: Notification (no id)
echo "8. Testing notification (no response expected)..."
echo '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"Notification test"}}' | imsg rpc
echo ""
echo ""

echo "=== All RPC tests completed ==="
