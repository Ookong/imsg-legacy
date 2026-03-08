#!/bin/bash

echo "=== Advanced RPC Tests ==="
echo ""

# Test 1: chats.list with limit
echo "1. Testing chats.list with limit..."
echo '{"jsonrpc":"2.0","method":"chats.list","params":{"limit":3},"id":1}' | imsg rpc
echo ""
echo ""

# Test 2: messages.history with various parameters
echo "2. Testing messages.history with since parameter..."
echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":5,"since":365},"id":2}' | imsg rpc
echo ""
echo ""

# Test 3: send with different services
echo "3. Testing send with SMS service..."
echo '{"jsonrpc":"2.0","method":"send","params":{"to":"+1234567890","text":"RPC SMS test","service":"sms"},"id":3}' | imsg rpc
echo ""
echo ""

# Test 4: send with emoji and special characters
echo "4. Testing send with special characters..."
echo '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"Special chars: 🎉😊🚀 Unicode: 你好世界 \\nNew line"},"id":4}' | imsg rpc
echo ""
echo ""

# Test 5: Invalid JSON
echo "5. Testing invalid JSON..."
echo 'this is not valid json' | imsg rpc
echo ""
echo ""

# Test 6: Missing jsonrpc version
echo "6. Testing missing jsonrpc version..."
echo '{"method":"chats.list","params":{},"id":6}' | imsg rpc
echo ""
echo ""

# Test 7: Missing method
echo "7. Testing missing method..."
echo '{"jsonrpc":"2.0","params":{},"id":7}' | imsg rpc
echo ""
echo ""

# Test 8: Notification (should not return response)
echo "8. Testing notification (no id field)..."
RESPONSE=$(echo '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"Notification test 📢"}}' | imsg rpc)
if [ -z "$RESPONSE" ]; then
  echo "✓ Notification correctly returned no response"
else
  echo "✗ Notification returned: $RESPONSE"
fi
echo ""
echo ""

# Test 9: Multiple sequential requests
echo "9. Testing multiple sequential requests..."
(echo '{"jsonrpc":"2.0","method":"chats.list","params":{"limit":2},"id":9}'; \
 echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":2},"id":10}'; \
 sleep 1) | imsg rpc
echo ""
echo ""

# Test 10: Error recovery
echo "10. Testing error recovery (bad request followed by good request)..."
(echo '{"jsonrpc":"2.0","method":"invalid","params":{},"id":11}'; \
 sleep 0.5; \
 echo '{"jsonrpc":"2.0","method":"chats.list","params":{},"id":12}'; \
 sleep 1) | imsg rpc
echo ""
echo ""

echo "=== Advanced RPC tests completed ==="
